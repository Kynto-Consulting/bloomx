/**
 * Espejo EN EL FRONTEND de bloomx-backend/src/lib/extensions/token-access.ts: a que extensiones se les inyecta `context.auth` (tokens de las cuentas
 * vinculadas). El BACKEND es quien decide (descarta `auth` para el resto); aqui solo se evita ENVIARLO de mas (minimo privilegio).
 * Regla: el manifest de la version que se ejecuta declara `OAUTH_READ`, o la extension+version esta en la lista CERRADA de versiones legadas.
 * DEPRECADO: la lista no crece y se retira cuando ninguna version servida de estas extensiones la necesite (v2 de google-* usa el intermediario).
 */
export const LEGACY_TOKEN_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
    'core-google-meet': '1.4.0',
    'core-calendar': '1.6.0',
    'core-google-drive': '1.0.1',
    'core-google-sync': '1.0.0',
    'core-zoom': '1.4.0',
    'core-hubspot': '1.2.0',
});

const parse = (v: unknown): [number, number, number] | null => {
    const m = typeof v === 'string' ? /^(\d+)\.(\d+)\.(\d+)/.exec(v) : null;
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

export function mayReceiveProviderTokens(manifest: { permissions?: unknown; version?: unknown } | null | undefined, extensionId: string): boolean {
    if (Array.isArray(manifest?.permissions) && manifest!.permissions.includes('OAUTH_READ')) return true;
    const last = parse(LEGACY_TOKEN_VERSIONS[extensionId]);
    const v = parse(manifest?.version);
    if (!last || !v) return false;
    const d = v[0] - last[0] || v[1] - last[1] || v[2] - last[2];
    return d <= 0;
}
