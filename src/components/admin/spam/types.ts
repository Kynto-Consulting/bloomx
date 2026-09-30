/** Tipos y constantes de la seccion "Spam y remitentes" (espejo del contrato de /api/admin/spam/**). */

export const SPAM_TABS = ['level', 'block', 'allow', 'external', 'log', 'test', 'stats'] as const;
export type SpamTabId = (typeof SPAM_TABS)[number];

export const LEVELS = ['off', 'low', 'balanced', 'strict', 'max', 'custom'] as const;
export type Level = (typeof LEVELS)[number];
export type BandAction = 'deliver' | 'warn' | 'spam';
export const FAMILIES = ['auth', 'headers', 'content', 'links', 'attachments', 'impersonation'] as const;
export type Family = (typeof FAMILIES)[number];
export const ENGINE_KEYS = ['content', 'links', 'learning', 'context'] as const;
export type EngineKey = (typeof ENGINE_KEYS)[number];
export const SUSPICIOUS_MARGIN = 15;

export interface ExternalCfg {
    enabled: boolean;
    style: 'info' | 'warning';
    text: { es: string; en: string };
    subjectTag: boolean;
    colleagueSpoof: boolean;
    firstTime: boolean;
    hardenLinks: boolean;
    hardenAttachments: boolean;
    internalDomains: string[];
}

export interface SpamCfg {
    rev: number;
    level: Level;
    threshold: number;
    actions: { clean: 'deliver'; suspicious: BandAction; spam: BandAction };
    familyWeights: Record<Family, number>;
    engine: Record<EngineKey, boolean>;
    allowUserSensitivity: boolean;
    external: ExternalCfg;
    logRetentionDays: number;
    logDelivered: boolean;
}

export interface ConfigResponse {
    config: SpamCfg;
    source: string;
    updatedAt: string | null;
    updatedBy: string | null;
    presets: Record<'low' | 'balanced' | 'strict' | 'max', number>;
    ownDomains: string[];
}

export interface SimulationResponse {
    analyzed: number;
    skipped: number;
    current: { spam: number; warned: number; delivered: number };
    proposed: { spam: number; warned: number; delivered: number };
    changed: { toSpam: number; fromSpam: number; toWarned: number; fromWarned: number };
    scope: 'mine' | 'domain';
}

export interface SignalRow {
    id: string;
    family: string;
    weight: number;
    critical: boolean;
    params: Record<string, string | number> | null;
    es: string;
    en: string;
}

export interface ProbeResponse {
    score: number;
    threshold: number | null;
    band: 'clean' | 'suspicious' | 'spam';
    decision: 'delivered' | 'warned' | 'spam' | 'blocked';
    blockedByList: boolean;
    allowedByList: boolean;
    authFailed: boolean;
    category: string;
    signals: SignalRow[];
}

export interface EventReason { id: string; weight: number; es: string; en: string }
export interface EventRow {
    id: string;
    ts: string | null;
    recipient: string | null;
    sender: string;
    senderDomain: string | null;
    decision: string;
    score: number | null;
    ruleLabel: string | null;
    reasons: EventReason[];
    external: boolean;
}
export interface EventsResponse { total: number; rows: EventRow[] }

export interface StatsResponse {
    days: number;
    perDay: Array<{ day: string; spam: number; blocked: number; warned: number; external: number; notspam: number }>;
    topDomains: Array<{ domain: string; count: number }>;
    totals: { spam: number; blocked: number; warned: number; external: number; notspam: number; markspam: number };
}

export const CONFIG_URL = '/api/admin/spam/config';
export const LISTS_BASE = '/api/admin/spam/lists';
