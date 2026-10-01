import type { FieldErrorCode, RunLogEntry, SettingIssue, SettingSource } from '@/lib/expansions/settings-schema';

/**
 * Reconstruccion con LISTA BLANCA de las respuestas del backend /api/extension/config. Se usa en el proxy admin: aunque el
 * backend enviara un secreto o el valor del entorno global, no llega al navegador.
 */

const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SOURCES: readonly SettingSource[] = ['domain', 'legacy', 'server-env', 'default', 'unset'];
const SECRET_SOURCES = ['domain', 'legacy', 'server-env', 'missing'] as const;
const MAX_VALUES_BYTES = 65536;

export interface ActionResult { status: 'ok' | 'failed'; code?: number; latencyMs?: number; message?: string; report?: string[] }

const SECRET_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*\.[a-z0-9-]+\.[A-Za-z][A-Za-z0-9_]*$/;
const LOG_STATUS = ['ok', 'failed', 'skipped', 'retry'] as const;
const clean = (v: unknown, max: number): string => String(v).replace(/[\u0000-\u001f]+/g, ' ').slice(0, max);
const int = (v: unknown, max: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : undefined);

export function shapeRunLog(value: unknown): RunLogEntry[] {
    if (!Array.isArray(value)) return [];
    const out: RunLogEntry[] = [];
    for (const raw of value.slice(0, 100)) {
        if (!isObject(raw) || typeof raw.event !== 'string' || !raw.event || typeof raw.ts !== 'string') continue;
        const entry: RunLogEntry = { ts: clean(raw.ts, 40), event: clean(raw.event, 60), status: (LOG_STATUS as readonly string[]).includes(raw.status) ? raw.status : 'ok' };
        if (typeof raw.target === 'string' && raw.target) entry.target = clean(raw.target, 64);
        const code = int(raw.code, 999); if (code !== undefined) entry.code = code;
        const attempts = int(raw.attempts, 20); if (attempts !== undefined) entry.attempts = attempts;
        const latencyMs = int(raw.latencyMs, 600000); if (latencyMs !== undefined) entry.latencyMs = latencyMs;
        if (typeof raw.message === 'string' && raw.message) entry.message = clean(raw.message, 200);
        out.push(entry);
    }
    return out;
}

export function shapeActionResult(raw: unknown): ActionResult | undefined {
    if (!isObject(raw)) return undefined;
    const out: ActionResult = { status: raw.status === 'ok' ? 'ok' : 'failed' };
    const code = int(raw.code, 999); if (code !== undefined) out.code = code;
    const latencyMs = int(raw.latencyMs, 600000); if (latencyMs !== undefined) out.latencyMs = latencyMs;
    if (typeof raw.message === 'string' && raw.message) out.message = clean(raw.message, 200);
    if (Array.isArray(raw.report)) out.report = raw.report.filter((x: unknown): x is string => typeof x === 'string').slice(0, 20).map((x: string) => clean(x, 200));
    return out;
}

export interface ConfigResponse {
    success?: true;
    values: Record<string, unknown>;
    sources: Record<string, SettingSource>;
    envLegacy: string[];
    importable: string[];
    imported?: string[];
    /** Nombres (`campo.id.sub`) de los secretos por elemento que estan establecidos. Nunca valores. */
    secretsSet: string[];
    runLog: RunLogEntry[];
    ok?: boolean;
    result?: ActionResult;
    secrets: { name: string; configured: boolean; source: (typeof SECRET_SOURCES)[number] }[];
    checklist: { done: number; total: number; items: { key: string; secret: boolean; ok: boolean }[] };
    meta: { updatedAt: string | null; updatedBy: string | null };
    limits: { maxConfigBytes: number | null };
}

const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: unknown): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)).slice(0, 100) : []);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null);
const count = (v: unknown): number => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1000 ? (v as number) : 0);

export function shapeConfigResponse(data: any): ConfigResponse {
    const values: Record<string, unknown> = {};
    if (isObject(data?.values)) {
        for (const [k, v] of Object.entries(data.values)) if (KEY_RE.test(k)) values[k] = v;
        let size = Infinity;
        try { size = JSON.stringify(values).length; } catch { /* circular imposible en JSON */ }
        if (size > MAX_VALUES_BYTES) for (const k of Object.keys(values)) delete values[k];
    }
    const sources: Record<string, SettingSource> = {};
    if (isObject(data?.sources)) {
        for (const [k, v] of Object.entries(data.sources)) if (KEY_RE.test(k) && SOURCES.includes(v as SettingSource)) sources[k] = v as SettingSource;
    }
    const secrets = Array.isArray(data?.secrets)
        ? data.secrets
            .filter((s: any) => isObject(s) && typeof s.name === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(s.name))
            .slice(0, 100)
            .map((s: any) => ({
                name: String(s.name),
                configured: s.configured === true,
                source: SECRET_SOURCES.includes(s.source) ? s.source : s.configured === true ? 'domain' : 'missing',
            }))
        : [];
    const items = Array.isArray(data?.checklist?.items)
        ? data.checklist.items
            .filter((i: any) => isObject(i) && typeof i.key === 'string' && KEY_RE.test(i.key))
            .slice(0, 100)
            .map((i: any) => ({ key: String(i.key), secret: i.secret === true, ok: i.ok === true }))
        : [];
    const maxBytes = data?.limits?.maxConfigBytes;
    return {
        ...(data?.success === true ? { success: true as const } : {}),
        values,
        sources,
        secretsSet: Array.isArray(data?.secretsSet) ? data.secretsSet.filter((n: unknown): n is string => typeof n === 'string' && SECRET_NAME_RE.test(n)).slice(0, 500) : [],
        runLog: shapeRunLog(data?.runLog),
        ...(typeof data?.ok === 'boolean' ? { ok: data.ok } : {}),
        ...(shapeActionResult(data?.result) ? { result: shapeActionResult(data.result) } : {}),
        envLegacy: keys(data?.envLegacy),
        importable: keys(data?.importable),
        ...(Array.isArray(data?.imported) ? { imported: keys(data.imported) } : {}),
        secrets,
        checklist: { done: count(data?.checklist?.done), total: count(data?.checklist?.total), items },
        meta: { updatedAt: text(data?.meta?.updatedAt, 40), updatedBy: text(data?.meta?.updatedBy, 120) },
        limits: { maxConfigBytes: Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= 10_000_000 ? maxBytes : null },
    };
}

export function shapeConfigError(data: any): { error: string; errors?: SettingIssue[] } {
    const error = typeof data?.error === 'string' ? data.error.slice(0, 200) : 'Request failed';
    const errors: SettingIssue[] = Array.isArray(data?.errors)
        ? data.errors
            .filter((e: any) => isObject(e) && typeof e.path === 'string' && typeof e.message === 'string')
            .slice(0, 100)
            .map((e: any) => ({
                path: String(e.path).slice(0, 200),
                message: String(e.message).slice(0, 200),
                ...(typeof e.code === 'string' && /^[A-Za-z]{2,30}$/.test(e.code) ? { code: e.code as FieldErrorCode } : {}),
                ...(shapeParams(e.params) ? { params: shapeParams(e.params) } : {}),
            }))
        : [];
    return errors.length ? { error, errors } : { error };
}

function shapeParams(raw: unknown): Record<string, string | number> | undefined {
    if (!isObject(raw)) return undefined;
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(raw).slice(0, 10)) {
        if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k)) continue;
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
        else if (typeof v === 'string') out[k] = v.slice(0, 200);
    }
    return Object.keys(out).length ? out : undefined;
}
