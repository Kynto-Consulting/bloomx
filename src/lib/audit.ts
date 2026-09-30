import { randomUUID } from 'crypto';

// Auditoria persistente (NIST 800-53 AU-2/AU-3/AU-6/AU-9, CIS v8 8.2/8.5, ISO 27001:2022 A.8.15).
// - SIEMPRE se escribe una linea JSON a stdout (recolectable por el proveedor / SIEM).
// - Ademas se persiste en la tabla "AuditEvent" (best-effort, asincrono, nunca bloquea ni rompe la peticion).
// - Si la BD/tabla no existe o falla, se degrada a stdout con un "circuit breaker" (no reintenta en cada evento).
// Variables: AUDIT_DB=off desactiva la persistencia; AUDIT_RETENTION_DAYS (ver retention.ts).

export function maskEmail(email: unknown): string {
    const s = String(email ?? '');
    const at = s.indexOf('@');
    if (at < 1) return '***';
    return `${s[0]}***${s.slice(at)}`;
}

const SENSITIVE_KEY = /pass|token|secret|authorization|cookie|key|otp|code|recovery/i;
// Excepciones seguras (identificadores que contienen "key" o "code" pero no son secretos)
const SAFE_KEYS = new Set(['keyId', 'statusCode', 'errorCode']);

/** Redacta claves sensibles y enmascara emails. Pura y testeable. */
export function redactAuditData(data: Record<string, unknown>): Record<string, unknown> {
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
        if (SENSITIVE_KEY.test(k) && !SAFE_KEYS.has(k)) continue;
        if (k.toLowerCase().includes('email')) safe[k] = maskEmail(v);
        else if (typeof v === 'string') safe[k] = v.length > 500 ? `${v.slice(0, 500)}...` : v;
        else safe[k] = v;
    }
    return safe;
}

export interface AuditRecord {
    id: string;
    ts: string;
    event: string;
    userId: string | null;
    ip: string | null;
    data: Record<string, unknown>;
}

// --- circuit breaker de persistencia ---
let failures = 0;
let disabledUntil = 0;
const MAX_FAILURES = 5;
const COOLDOWN_MS = 60_000;

type Sink = (rec: AuditRecord) => Promise<void>;
let sinkOverride: Sink | null = null;
/** Solo para tests. */
export function __setAuditSink(sink: Sink | null) {
    sinkOverride = sink;
    failures = 0;
    disabledUntil = 0;
}

async function defaultSink(rec: AuditRecord): Promise<void> {
    const { prisma } = await import('./prisma');
    await prisma.$executeRaw`
        INSERT INTO "AuditEvent" ("id", "ts", "event", "userId", "ip", "data")
        VALUES (${rec.id}, ${new Date(rec.ts)}, ${rec.event}, ${rec.userId}, ${rec.ip}, ${JSON.stringify(rec.data)}::jsonb)
    `;
}

async function persist(rec: AuditRecord) {
    if (process.env.AUDIT_DB === 'off') return;
    // Las pruebas nunca deben escribir en la BD del .env: solo persisten con un sumidero inyectado (__setAuditSink)
    if (!sinkOverride && (process.env.NODE_ENV === 'test' || process.env.VITEST)) return;
    if (Date.now() < disabledUntil) return;
    try {
        await (sinkOverride ?? defaultSink)(rec);
        failures = 0;
    } catch (err: any) {
        failures += 1;
        if (failures >= MAX_FAILURES) {
            disabledUntil = Date.now() + COOLDOWN_MS;
            failures = 0;
            // Un unico aviso por ciclo, sin datos del evento
            console.warn('[AUDIT] Persistencia en BD no disponible; se continua solo con stdout.', err?.code || err?.name || '');
        }
    }
}

export function auditLog(event: string, data: Record<string, unknown> = {}) {
    const safe = redactAuditData(data);
    const rec: AuditRecord = {
        id: randomUUID(),
        ts: new Date().toISOString(),
        event,
        userId: typeof data.userId === 'string' ? data.userId : null,
        ip: typeof data.ip === 'string' ? data.ip : null,
        data: safe,
    };
    console.log(JSON.stringify({ type: 'audit', event, ts: rec.ts, ...safe }));
    // Fire-and-forget: nunca propaga errores al flujo de negocio
    void persist(rec).catch(() => undefined);
}
