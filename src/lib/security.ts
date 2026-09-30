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
// Auditoria con datos redactados (nunca registrar contrasenas/tokens/emails completos)
// ---------------------------------------------------------------------------
export function maskEmail(email: unknown): string {
    const s = String(email ?? "");
    const at = s.indexOf("@");
    if (at < 1) return "***";
    return `${s[0]}***${s.slice(at)}`;
}

export function auditLog(event: string, data: Record<string, unknown> = {}) {
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
        if (/pass|token|secret|authorization|cookie|key/i.test(k)) continue;
        safe[k] = k.toLowerCase().includes("email") ? maskEmail(v) : v;
    }
    console.log(JSON.stringify({ type: "audit", event, ts: new Date().toISOString(), ...safe }));
}

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
