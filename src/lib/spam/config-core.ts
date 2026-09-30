/**
 * Configuracion del filtro de spam del dominio (pura): tipos, presets, saneado y decision por banda.
 * Se guarda en AdminSetting key 'spamConfig' como JSON versionado; `sanitizeSpamConfig` es la UNICA puerta de entrada
 * (lo guardado, lo importado y lo que llega por la API pasan por ella).
 */
import { TUNABLE_FAMILIES, type BandAction, type Band, type Decision, type TunableFamily } from './types';

export const SPAM_CONFIG_KEY = 'spamConfig';
export const SPAM_CONFIG_SCHEMA = 1;

export const LEVELS = ['off', 'low', 'balanced', 'strict', 'max', 'custom'] as const;
export type Level = (typeof LEVELS)[number];
export const PRESET_THRESHOLDS: Record<Exclude<Level, 'off' | 'custom'>, number> = { low: 80, balanced: 65, strict: 50, max: 35 };
export const DEFAULT_LEVEL: Level = 'balanced';
export const SUSPICIOUS_MARGIN = 15;
export const USER_SENSITIVITY_STEP = 10;

export interface ExternalConfig {
    enabled: boolean;
    style: 'info' | 'warning';
    /** Texto del aviso por idioma (plano, saneado). Vacio = texto por defecto. */
    text: { es: string; en: string };
    /** Etiqueta [EXTERNO] SOLO de visualizacion en el asunto de la lista. */
    subjectTag: boolean;
    colleagueSpoof: boolean;
    firstTime: boolean;
    hardenLinks: boolean;
    hardenAttachments: boolean;
    /** Dominios internos adicionales (ademas de ownDomains()). */
    internalDomains: string[];
}

export interface SpamConfig {
    schema: number;
    /** Revision (sube en cada guardado): sirve para invalidar caches entre instancias. */
    rev: number;
    level: Level;
    threshold: number;
    actions: { clean: 'deliver'; suspicious: BandAction; spam: BandAction };
    familyWeights: Record<TunableFamily, number>;
    engine: { content: boolean; links: boolean; learning: boolean; context: boolean };
    allowUserSensitivity: boolean;
    external: ExternalConfig;
    /** Retencion del registro de decisiones (dias). */
    logRetentionDays: number;
    /** Registrar tambien los correos entregados sin problema (si no, solo advertencias, spam y bloqueados). */
    logDelivered: boolean;
}

export const MAX_LOG_RETENTION = 365;
export const MAX_EXTERNAL_TEXT = 300;
export const MAX_INTERNAL_DOMAINS = 50;

export const DEFAULT_EXTERNAL: ExternalConfig = {
    enabled: false,
    style: 'warning',
    text: { es: '', en: '' },
    subjectTag: false,
    colleagueSpoof: true,
    firstTime: true,
    hardenLinks: false,
    hardenAttachments: true,
    internalDomains: [],
};

export function defaultSpamConfig(env: Record<string, string | undefined> = process.env): SpamConfig {
    const envThr = Number.parseFloat(String(env.SPAM_SCORE_THRESHOLD ?? ''));
    const off = String(env.ENABLE_AUTO_SPAM_DETECTION ?? 'true').toLowerCase() === 'false';
    const hasEnvThr = Number.isFinite(envThr) && envThr > 0 && envThr <= 100;
    const level: Level = off ? 'off' : hasEnvThr ? 'custom' : DEFAULT_LEVEL;
    return {
        schema: SPAM_CONFIG_SCHEMA,
        rev: 0,
        level,
        threshold: hasEnvThr ? Math.round(envThr) : PRESET_THRESHOLDS.balanced,
        actions: { clean: 'deliver', suspicious: 'warn', spam: 'spam' },
        familyWeights: { auth: 1, headers: 1, content: 1, links: 1, attachments: 1, impersonation: 1 },
        engine: { content: true, links: true, learning: true, context: true },
        allowUserSensitivity: true,
        external: { ...DEFAULT_EXTERNAL, text: { ...DEFAULT_EXTERNAL.text }, internalDomains: [] },
        logRetentionDays: 30,
        logDelivered: false,
    };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const clampNum = (v: unknown, min: number, max: number, fb: number): number => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
};
const bool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb);

/** Texto plano: sin etiquetas, sin caracteres de control ni de direccion, colapsado y acotado. */
export function sanitizePlainText(v: unknown, max = MAX_EXTERNAL_TEXT): string {
    if (typeof v !== 'string') return '';
    return v
        .replace(/<[^>]*>?/g, ' ')
        .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
export function normalizeDomain(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    let d = v.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '');
    if (d.startsWith('*.')) d = d.slice(2);
    return DOMAIN_RE.test(d) ? d : null;
}

export function sanitizeSpamConfig(raw: unknown, base: SpamConfig = defaultSpamConfig()): SpamConfig {
    const o = isObj(raw) ? raw : {};
    const level: Level = (LEVELS as readonly string[]).includes(o.level as string) ? (o.level as Level) : base.level;
    let threshold = Math.round(clampNum(o.threshold, 1, 100, base.threshold));
    if (level !== 'off' && level !== 'custom') threshold = PRESET_THRESHOLDS[level];
    const actionsIn = isObj(o.actions) ? o.actions : {};
    const act = (v: unknown, fb: BandAction): BandAction => (v === 'deliver' || v === 'warn' || v === 'spam' ? v : fb);
    const fwIn = isObj(o.familyWeights) ? o.familyWeights : {};
    const familyWeights = {} as Record<TunableFamily, number>;
    for (const f of TUNABLE_FAMILIES) familyWeights[f] = Math.round(clampNum(fwIn[f], 0, 2, base.familyWeights[f]) * 20) / 20;
    const eng = isObj(o.engine) ? o.engine : {};
    const ext = isObj(o.external) ? o.external : {};
    const txt = isObj(ext.text) ? ext.text : {};
    const internal = Array.isArray(ext.internalDomains)
        ? Array.from(new Set(ext.internalDomains.map(normalizeDomain).filter((x): x is string => !!x))).slice(0, MAX_INTERNAL_DOMAINS)
        : base.external.internalDomains;
    return {
        schema: SPAM_CONFIG_SCHEMA,
        rev: Math.max(0, Math.floor(clampNum(o.rev, 0, 2 ** 31, base.rev))),
        level,
        threshold,
        actions: { clean: 'deliver', suspicious: act(actionsIn.suspicious, base.actions.suspicious), spam: act(actionsIn.spam, base.actions.spam) },
        familyWeights,
        engine: {
            content: bool(eng.content, base.engine.content),
            links: bool(eng.links, base.engine.links),
            learning: bool(eng.learning, base.engine.learning),
            context: bool(eng.context, base.engine.context),
        },
        allowUserSensitivity: bool(o.allowUserSensitivity, base.allowUserSensitivity),
        external: {
            enabled: bool(ext.enabled, base.external.enabled),
            style: ext.style === 'info' || ext.style === 'warning' ? ext.style : base.external.style,
            text: {
                es: 'es' in txt ? sanitizePlainText(txt.es) : base.external.text.es,
                en: 'en' in txt ? sanitizePlainText(txt.en) : base.external.text.en,
            },
            subjectTag: bool(ext.subjectTag, base.external.subjectTag),
            colleagueSpoof: bool(ext.colleagueSpoof, base.external.colleagueSpoof),
            firstTime: bool(ext.firstTime, base.external.firstTime),
            hardenLinks: bool(ext.hardenLinks, base.external.hardenLinks),
            hardenAttachments: bool(ext.hardenAttachments, base.external.hardenAttachments),
            internalDomains: internal,
        },
        logRetentionDays: Math.round(clampNum(o.logRetentionDays, 1, MAX_LOG_RETENTION, base.logRetentionDays)),
        logDelivered: bool(o.logDelivered, base.logDelivered),
    };
}

// ---------------------------------------------------------------------------
// Decision por banda
// ---------------------------------------------------------------------------
export function effectiveThreshold(cfg: SpamConfig, sensitivity = 0): number | null {
    if (cfg.level === 'off') return null;
    const s = cfg.allowUserSensitivity ? Math.max(-1, Math.min(1, Math.round(sensitivity))) : 0;
    return Math.max(20, Math.min(95, cfg.threshold - s * USER_SENSITIVITY_STEP));
}

export function bandOf(score: number, cfg: SpamConfig, sensitivity = 0): Band {
    const thr = effectiveThreshold(cfg, sensitivity);
    if (thr === null) return 'clean';
    if (score >= thr) return 'spam';
    if (score >= thr - SUSPICIOUS_MARGIN) return 'suspicious';
    return 'clean';
}

export function decisionFor(band: Band, cfg: SpamConfig): { decision: Exclude<Decision, 'blocked'>; folder: 'inbox' | 'spam' } {
    const action: BandAction = band === 'clean' ? 'deliver' : band === 'suspicious' ? cfg.actions.suspicious : cfg.actions.spam;
    if (action === 'spam') return { decision: 'spam', folder: 'spam' };
    if (action === 'warn') return { decision: 'warned', folder: 'inbox' };
    return { decision: 'delivered', folder: 'inbox' };
}
