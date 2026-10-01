/**
 * Identidad de build del cliente (PWA). Funciones PURAS: sin DOM ni red, se prueban en __tests__.
 * El concepto de version de API es CLIENT_API_VERSION (src/lib/expansions/client/capabilities.ts); aqui no se duplica.
 */
export const CHECK_INTERVAL_MS = 10 * 60 * 1000;
export const JITTER_RATIO = 0.2;

export interface RemoteVersion {
    buildId: string;
    clientApi: number;
    minClientApi: number;
    builtAt?: string;
}

export type BuildComparison = 'same' | 'newer';

/** 'newer' si el servidor sirve otro build distinto del que corre en el cliente. Datos ausentes -> 'same' (no molestar). */
export function compareBuild(current: string | null | undefined, remote: string | null | undefined): BuildComparison {
    if (!current || !remote) return 'same';
    return current === remote ? 'same' : 'newer';
}

/** Actualizacion obligatoria: el cliente (o el build que corre) implementa una API anterior al minimo exigido. */
export function needsMandatoryUpdate(clientApi: number, minClientApi: number): boolean {
    if (!Number.isFinite(clientApi) || !Number.isFinite(minClientApi)) return false;
    return clientApi < minClientApi;
}

export interface UpdateState {
    newBuild: boolean;
    mandatory: boolean;
    hasUnsavedWork: boolean;
    userAccepted: boolean;
}

/**
 * Recarga automatica solo si es obligatoria (tras guardar los borradores: el flush ocurre en pagehide/beforeunload y
 * la cola offline persiste), o si el usuario ya pulso "Actualizar" y no queda trabajo sin guardar.
 * Una actualizacion opcional NUNCA recarga sola.
 */
export function shouldAutoReload(state: UpdateState): boolean {
    if (state.mandatory) return true;
    return state.newBuild && state.userAccepted && !state.hasUnsavedWork;
}

/** Siguiente espera (ms) con jitter +-20%. `random` en [0,1) inyectable para tests. */
export function nextCheckDelay(random: number = Math.random(), base: number = CHECK_INTERVAL_MS): number {
    const r = Math.min(Math.max(random, 0), 1);
    return Math.round(base * (1 - JITTER_RATIO + r * 2 * JITTER_RATIO));
}

export function parseMinClientApi(value: string | null | undefined): number | null {
    if (value == null) return null;
    const n = Number(value.trim());
    return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Nombre del SW para un build: la URL cambia con el build y por tanto el navegador lo reinstala. */
export function serviceWorkerUrl(buildId: string): string {
    return `/sw.js?v=${encodeURIComponent(buildId)}`;
}

export function parseRemoteVersion(data: unknown): RemoteVersion | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    if (typeof d.buildId !== 'string' || !d.buildId) return null;
    const clientApi = Number(d.clientApi);
    const minClientApi = Number(d.minClientApi);
    return {
        buildId: d.buildId,
        clientApi: Number.isFinite(clientApi) ? clientApi : 0,
        minClientApi: Number.isFinite(minClientApi) ? minClientApi : 1,
        builtAt: typeof d.builtAt === 'string' ? d.builtAt : undefined,
    };
}
