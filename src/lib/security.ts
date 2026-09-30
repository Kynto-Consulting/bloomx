import { timingSafeEqual, createHash } from "crypto";
import type { NextRequest } from "next/server";

/**
 * Utilidades de seguridad compartidas (auth, rate limiting, auditoria, politica de contrasenas).
 * CIS 5/6/8, NIST 800-53 AC-7 / AU-2 / AU-3 / IA-5, NIST 800-63B 5.1.1, ISO 27001 A.8.5 / A.8.15.
 */

// ---------------------------------------------------------------------------
// Comparacion en tiempo constante (secretos compartidos)
// ---------------------------------------------------------------------------
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
    if (typeof a !== "string" || typeof b !== "string") return false;
    const ha = createHash("sha256").update(a).digest();
    const hb = createHash("sha256").update(b).digest();
    return timingSafeEqual(ha, hb);
}

// ---------------------------------------------------------------------------
// IP del cliente
// ---------------------------------------------------------------------------
export function getClientIp(req: NextRequest | Request): string {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim().slice(0, 64);
    return (req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

// ---------------------------------------------------------------------------
// Rate limiting en memoria (ventana fija). Best-effort por instancia serverless:
// para garantia global usar un almacen compartido (Upstash/Redis). Ver informe.
// ---------------------------------------------------------------------------
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
    const now = Date.now();
    if (buckets.size > MAX_BUCKETS) {
        for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
        if (buckets.size > MAX_BUCKETS) buckets.clear();
    }
    const b = buckets.get(key);
    if (!b || b.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, retryAfter: 0 };
    }
    b.count += 1;
    if (b.count > limit) {
        return { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
    }
    return { ok: true, retryAfter: 0 };
}

export function rateLimitReset(key: string) {
    buckets.delete(key);
}

// ---------------------------------------------------------------------------
// Rate limiting distribuido (Upstash Redis REST) con fallback a memoria.
//
// Ventana fija atomica: POST {URL}/multi-exec con [INCR k] [PEXPIRE k ms NX] [PTTL k] (una transaccion MULTI/EXEC).
// PEXPIRE ... NX solo fija el TTL si la clave aun no lo tiene: la ventana no se "estira" con cada intento y una clave
// sin TTL (fallo entre comandos) se autorrepara. Las claves se guardan como sha256 (sin emails/IP en claro).
//
// Configuracion (todo por entorno, leido en cada llamada):
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   sin ellas => solo memoria (por instancia)
//   RATE_LIMIT_ON_ERROR = "memory" (defecto) | "open"    que hacer si Redis falla: contar en memoria o dejar pasar
//   RATE_LIMIT_REDIS_TIMEOUT_MS (defecto 800)            timeout por peticion a Redis
// Circuit breaker: 3 fallos seguidos abren el circuito 30 s (no se llama a Redis; se aplica RATE_LIMIT_ON_ERROR).
// Nunca se devuelve ok:false por un fallo de Redis: una caida del almacen no bloquea a todos los usuarios.
// ---------------------------------------------------------------------------
export type RateLimitResult = { ok: boolean; retryAfter: number; backend: "redis" | "memory" | "open" };

const BREAKER_THRESHOLD = 3;
const BREAKER_OPEN_MS = 30_000;
const breaker = { failures: 0, openUntil: 0 };

/** Solo para pruebas. */
export function __resetRateLimitState() {
    buckets.clear();
    breaker.failures = 0;
    breaker.openUntil = 0;
}

function redisConfig(): { url: string; token: string } | null {
    const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
    const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
    if (!url || !token || !/^https?:\/\//i.test(url)) return null;
    return { url, token };
}

function redisKey(key: string) {
    return "bloomx:rl:" + createHash("sha256").update(key).digest("hex").slice(0, 40);
}

async function redisCall(cfg: { url: string; token: string }, path: string, commands: unknown[][]): Promise<any[]> {
    const timeoutMs = Math.min(Math.max(Number(process.env.RATE_LIMIT_REDIS_TIMEOUT_MS) || 800, 100), 5000);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(cfg.url + path, {
            method: "POST",
            headers: { Authorization: "Bearer " + cfg.token, "Content-Type": "application/json" },
            body: JSON.stringify(commands),
            signal: ctrl.signal,
            cache: "no-store",
        });
        if (!res.ok) throw new Error("redis http " + res.status);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("redis bad response");
        for (const item of data) if (item && item.error) throw new Error("redis command error");
        return data.map((item: any) => item?.result);
    } finally {
        clearTimeout(timer);
    }
}

function onRedisError(): void {
    breaker.failures += 1;
    if (breaker.failures >= BREAKER_THRESHOLD) {
        breaker.openUntil = Date.now() + BREAKER_OPEN_MS;
        breaker.failures = 0;
        console.error("[RATE_LIMIT] Redis no disponible: circuito abierto " + BREAKER_OPEN_MS / 1000 + " s");
    }
}

function degraded(key: string, limit: number, windowMs: number): RateLimitResult {
    if ((process.env.RATE_LIMIT_ON_ERROR || "memory").toLowerCase() === "open") {
        return { ok: true, retryAfter: 0, backend: "open" };
    }
    return { ...rateLimit(key, limit, windowMs), backend: "memory" };
}

export async function rateLimitAsync(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const cfg = redisConfig();
    if (!cfg) return { ...rateLimit(key, limit, windowMs), backend: "memory" };
    if (Date.now() < breaker.openUntil) return degraded(key, limit, windowMs);

    try {
        const k = redisKey(key);
        const [count, , pttl] = await redisCall(cfg, "/multi-exec", [
            ["INCR", k],
            ["PEXPIRE", k, String(Math.ceil(windowMs)), "NX"],
            ["PTTL", k],
        ]);
        const n = Number(count);
        if (!Number.isFinite(n)) throw new Error("redis bad count");
        breaker.failures = 0;
        if (n > limit) {
            const ttl = Number(pttl) > 0 ? Number(pttl) : windowMs;
            return { ok: false, retryAfter: Math.max(1, Math.ceil(ttl / 1000)), backend: "redis" };
        }
        return { ok: true, retryAfter: 0, backend: "redis" };
    } catch {
        onRedisError();
        return degraded(key, limit, windowMs);
    }
}

/** Reinicia el contador (p.ej. tras un login correcto). Best-effort: un fallo de Redis no propaga error. */
export async function rateLimitResetAsync(key: string): Promise<void> {
    buckets.delete(key);
    const cfg = redisConfig();
    if (!cfg || Date.now() < breaker.openUntil) return;
    try {
        await redisCall(cfg, "/pipeline", [["DEL", redisKey(key)]]);
    } catch {
        onRedisError();
    }
}

// ---------------------------------------------------------------------------
// Auditoria con datos redactados (nunca registrar contrasenas/tokens/emails completos)
// ---------------------------------------------------------------------------
// La implementacion (redaccion + persistencia en "AuditEvent" con fallback a stdout) vive en ./audit.
export { maskEmail, auditLog } from "./audit";

// ---------------------------------------------------------------------------
// Politica de contrasenas (NIST 800-63B: longitud sobre complejidad, sin reglas de composicion)
// bcrypt trunca a 72 bytes, por eso se limita el maximo.
// ---------------------------------------------------------------------------
const COMMON_PASSWORDS = new Set([
    "password", "password1", "password123", "123456789012", "qwertyuiopas", "qwerty123456",
    "administrator", "letmein12345", "iloveyou1234", "welcome12345", "changeme1234", "bloomx123456",
]);

export const BCRYPT_COST = 12;

export function validateNewPassword(password: unknown, email?: string): string | null {
    if (typeof password !== "string") return "Invalid password";
    if (password.length < 12) return "Password must be at least 12 characters";
    if (Buffer.byteLength(password, "utf8") > 72) return "Password must be at most 72 bytes";
    const lower = password.toLowerCase();
    if (COMMON_PASSWORDS.has(lower)) return "Password is too common";
    if (/^(.)\1+$/.test(password)) return "Password is too weak";
    if (email && lower.includes(String(email).split("@")[0].toLowerCase()) && String(email).split("@")[0].length >= 4) {
        return "Password must not contain your email name";
    }
    return null;
}

// Hash bcrypt generado perezosamente para igualar tiempos cuando el usuario no existe
// (mitiga enumeracion por temporizacion, NIST 800-63B 5.2.2 / OWASP ASVS 2.2).
let dummyHashPromise: Promise<string> | null = null;
export function getDummyBcryptHash(): Promise<string> {
    if (!dummyHashPromise) {
        dummyHashPromise = import("bcryptjs").then((m) => (m.default ?? m).hash("dummy-password-for-timing", BCRYPT_COST));
    }
    return dummyHashPromise;
}

export function isProduction() {
    return process.env.NODE_ENV === "production";
}

// Solo rutas relativas internas (evita open redirect via //host o \host)
export function isSafeRelativePath(p: unknown): p is string {
    return typeof p === "string" && p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") && !/[\r\n]/.test(p);
}
