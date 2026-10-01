/**
 * Compatibilidad cliente <-> version de extension (PURO, sin React ni fetch). El backend resuelve por peticion la version mas alta
 * que ESTE cliente entiende y anuncia, si la hay, una mas nueva (`upgrade`) que exige capacidades/clientApi que el cliente no tiene.
 * Aqui se sanea (lista blanca) lo que viene del backend y se generan los textos es/en del aviso y del bloqueo.
 */
import { describeCapability } from '@/lib/expansions/client/capabilities';

export type CompatLocale = 'es' | 'en';

const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]{1,40})?$/;
const CAP_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const CLIENT_API_RE = /^[0-9A-Za-z.<>=^~ -]{1,20}$/;
const MAX_CAPS = 32;

export interface VersionUpgrade {
    latestVersion: string | null;
    requires: { clientApi: string | null; capabilities: string[] };
    missingCaps: string[];
    clientApiNeeded: string | null;
}

export interface VersionInfo {
    resolvedVersion: string | null;
    latestVersion: string | null;
    pinnedVersion: string | null;
    deprecated: boolean;
    incompatible: boolean;
    upgrade: VersionUpgrade | null;
}

const version = (v: unknown) => (typeof v === 'string' && v.length <= 60 && VERSION_RE.test(v) ? v : null);
const clientApi = (v: unknown) => {
    const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : v;
    return typeof s === 'string' && CLIENT_API_RE.test(s) ? s : null;
};
const caps = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string' && CAP_RE.test(c)).slice(0, MAX_CAPS) : [];

/** `upgrade` del backend -> forma acotada; null si no hay (o no es un objeto). */
export function sanitizeUpgrade(raw: unknown): VersionUpgrade | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as any;
    return {
        latestVersion: version(r.latestVersion),
        requires: { clientApi: clientApi(r.requires?.clientApi), capabilities: caps(r.requires?.capabilities) },
        missingCaps: caps(r.missingCaps),
        clientApiNeeded: clientApi(r.clientApiNeeded),
    };
}

/** `versionInfo` de una instalacion -> forma acotada; null si no viene. */
export function sanitizeVersionInfo(raw: unknown): VersionInfo | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as any;
    return {
        resolvedVersion: version(r.resolvedVersion),
        latestVersion: version(r.latestVersion),
        pinnedVersion: version(r.pinnedVersion),
        deprecated: r.deprecated === true,
        incompatible: r.incompatible === true,
        upgrade: sanitizeUpgrade(r.upgrade),
    };
}

const api = (n: string) => `clientApi ${/^\d/.test(n) ? '>=' : ''}${n}`;

const TEXTS = {
    es: {
        newer: (v: string | null) => `Hay una versión más nueva${v ? ` (${v})` : ''} que requiere actualizar el cliente`,
        missing: (list: string) => `falta ${list}`,
        needsApi: (n: string) => `requiere ${api(n)}`,
        incompatible: 'Ninguna versión de esta extensión es compatible con este cliente',
        blockInstall: 'No se puede instalar: ninguna versión es compatible con este cliente.',
        blockEnable: 'No se puede activar: ninguna versión es compatible con este cliente.',
        blockUpdate: 'No se puede actualizar: la versión disponible no es compatible con este cliente.',
        nothing: 'Sin requisitos especiales',
    },
    en: {
        newer: (v: string | null) => `A newer version${v ? ` (${v})` : ''} requires updating the client`,
        missing: (list: string) => `missing ${list}`,
        needsApi: (n: string) => `requires ${api(n)}`,
        incompatible: 'No version of this extension is compatible with this client',
        blockInstall: 'Cannot install: no version is compatible with this client.',
        blockEnable: 'Cannot enable: no version is compatible with this client.',
        blockUpdate: 'Cannot update: the available version is not compatible with this client.',
        nothing: 'No special requirements',
    },
} as const;
const tx = (locale: CompatLocale) => TEXTS[locale] ?? TEXTS.es;

/** Aviso "hay una version mas nueva que requiere actualizar el cliente: falta X" (null si no hay upgrade). */
export function describeUpgrade(upgrade: VersionUpgrade | null | undefined, locale: CompatLocale = 'es'): string | null {
    if (!upgrade) return null;
    const x = tx(locale);
    const reasons: string[] = [];
    if (upgrade.missingCaps.length) reasons.push(x.missing(upgrade.missingCaps.map((c) => describeCapability(c, locale)).join(', ')));
    if (upgrade.clientApiNeeded) reasons.push(x.needsApi(upgrade.clientApiNeeded));
    return `${x.newer(upgrade.latestVersion)}${reasons.length ? `: ${reasons.join('; ')}` : ''}.`;
}

/** "Requiere" de una version: clientApi y capacidades legibles. */
export function describeRequires(requires: VersionUpgrade['requires'] | null | undefined, locale: CompatLocale = 'es'): string {
    const parts: string[] = [];
    if (requires?.clientApi) parts.push(api(requires.clientApi));
    for (const c of requires?.capabilities ?? []) parts.push(describeCapability(c, locale));
    return parts.length ? parts.join(', ') : tx(locale).nothing;
}

export interface CompatEntry { incompatible?: boolean; upgrade?: VersionUpgrade | null }

/** Texto de la tarjeta cuando ninguna version es compatible (+ el motivo del upgrade si lo hay). */
export function describeIncompatible(entry: CompatEntry, locale: CompatLocale = 'es'): string | null {
    if (!entry.incompatible) return null;
    const why = describeUpgrade(entry.upgrade, locale);
    return `${tx(locale).incompatible}.${why ? ` ${why}` : ''}`;
}

/** Instalar/activar/actualizar solo si hay una version compatible con este cliente. */
export const canActivate = (entry: CompatEntry) => entry.incompatible !== true;
export const canInstall = canActivate;
export const canUpdate = canActivate;

export type BlockedAction = 'install' | 'enable' | 'update';
/** Motivo (title/aria-describedby) por el que una accion esta bloqueada por incompatibilidad, o null si se puede. */
export function blockReason(entry: CompatEntry, action: BlockedAction, locale: CompatLocale = 'es'): string | null {
    if (canActivate(entry)) return null;
    const x = tx(locale);
    const base = action === 'install' ? x.blockInstall : action === 'enable' ? x.blockEnable : x.blockUpdate;
    const why = describeUpgrade(entry.upgrade, locale);
    return why ? `${base} ${why}` : base;
}

/** `requires` del manifest (clientApi + capacidades) -> forma acotada; null si no declara nada. */
export function sanitizeRequires(raw: unknown): VersionUpgrade['requires'] | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as any;
    const out = { clientApi: clientApi(r.clientApi), capabilities: caps(r.capabilities) };
    return out.clientApi || out.capabilities.length ? out : null;
}
