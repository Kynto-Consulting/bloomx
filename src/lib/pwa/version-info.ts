import { CLIENT_API_VERSION } from '@/lib/expansions/client/capabilities';

/** Identidad del build actual (inyectada por next.config.js en el build). */
export const BUILD_ID: string = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
export const BUILT_AT: string = process.env.NEXT_PUBLIC_BUILT_AT || '';

export function parseMinClientApiEnv(raw: string | undefined): number {
    const n = Number((raw ?? '').trim());
    return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function buildVersionPayload(env: Record<string, string | undefined> = process.env) {
    return {
        buildId: env.NEXT_PUBLIC_BUILD_ID || BUILD_ID,
        clientApi: CLIENT_API_VERSION,
        minClientApi: parseMinClientApiEnv(env.BLOOMX_MIN_CLIENT_API),
        builtAt: env.NEXT_PUBLIC_BUILT_AT || BUILT_AT,
    };
}
