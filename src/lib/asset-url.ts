import { createHmac, timingSafeEqual } from "crypto";

// URLs firmadas (HMAC-SHA256 + caducidad) para /api/assets/<key>.
// NIST 800-53 AC-3 / SC-8, CIS v8 3.3, ISO 27001:2022 A.5.15 / A.8.3.
//
//   /api/assets/<key>?filename=<f>&exp=<epoch s>&sig=<base64url HMAC>
//   sig = HMAC-SHA256(secret, "asset:v1\n" + key + "\n" + exp)
//
// Secreto: ASSET_SIGNING_KEY, o derivado por HMAC de NEXTAUTH_SECRET (separacion de dominio; nunca se usa el secreto crudo).
// Vigencia:
//   - adjuntos recibidos (emails/...):  ASSET_URL_TTL_SECONDS            (por defecto 3600 = 1 h; se regenera en cada lectura del correo)
//   - subidas del usuario (attachments/...), que se incrustan en correos salientes:
//                                       ASSET_UPLOAD_URL_TTL_SECONDS     (por defecto 30 dias)
// Compatibilidad con enlaces sin firma (correos ya enviados) por prefijo, ver resolveUnsignedPolicy():
//   ASSET_UNSIGNED_INBOUND  = allow | owner | deny   (por defecto owner)
//   ASSET_UNSIGNED_UPLOADS  = allow | owner | deny   (por defecto allow, mientras convivan enlaces antiguos)
//   owner = solo si hay sesion del propietario del objeto.

const DOMAIN = "asset:v1";
const DEV_SECRET = "dev-asset-signing-secret";

function signingSecret(): Buffer {
    const explicit = process.env.ASSET_SIGNING_KEY;
    if (explicit) return Buffer.from(explicit);
    const base = process.env.NEXTAUTH_SECRET;
    if (!base) {
        if (process.env.NODE_ENV === "production") throw new Error("ASSET_SIGNING_KEY (or NEXTAUTH_SECRET) is required in production");
        return Buffer.from(DEV_SECRET);
    }
    return createHmac("sha256", base).update("bloomx:asset-signing:v1").digest();
}

function intEnv(name: string, def: number): number {
    const n = Number.parseInt(String(process.env[name] ?? ""), 10);
    return Number.isFinite(n) && n > 0 ? n : def;
}

export function isUploadKey(key: string): boolean {
    return key.startsWith("attachments/");
}
export function isInboundAttachmentKey(key: string): boolean {
    return /^emails\/[^/]+\/[^/]+\/attachments\/[^/]+$/.test(key);
}

export function ttlSecondsForKey(key: string): number {
    return isUploadKey(key)
        ? intEnv("ASSET_UPLOAD_URL_TTL_SECONDS", 30 * 24 * 3600)
        : intEnv("ASSET_URL_TTL_SECONDS", 3600);
}

export function computeAssetSignature(key: string, exp: number): string {
    return createHmac("sha256", signingSecret()).update(`${DOMAIN}\n${key}\n${exp}`).digest("base64url");
}

export type AssetSigResult = "ok" | "expired" | "invalid" | "missing";

export function verifyAssetSignature(
    key: string,
    expRaw: string | null | undefined,
    sigRaw: string | null | undefined,
    nowMs: number = Date.now()
): AssetSigResult {
    if (!expRaw && !sigRaw) return "missing";
    if (!expRaw || !sigRaw) return "invalid";
    if (!/^\d{1,12}$/.test(expRaw) || sigRaw.length > 128) return "invalid";
    const exp = Number(expRaw);
    const expected = Buffer.from(computeAssetSignature(key, exp));
    const given = Buffer.from(sigRaw);
    // Firma primero (tiempo constante); caducidad despues, para no revelar nada sobre claves invalidas
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid";
    if (exp * 1000 < nowMs) return "expired";
    return "ok";
}

export function encodeKeyPath(key: string): string {
    return key.split("/").map(encodeURIComponent).join("/");
}

export function normalizeDownloadName(filename: string): string {
    return filename.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

/** URL firmada absoluta (o relativa si baseUrl esta vacio). */
export function buildSignedAssetUrl(
    key: string,
    opts: { baseUrl?: string; filename?: string; ttlSeconds?: number; nowMs?: number } = {}
): string {
    const nowMs = opts.nowMs ?? Date.now();
    const ttl = opts.ttlSeconds ?? ttlSecondsForKey(key);
    const exp = Math.floor(nowMs / 1000) + ttl;
    const params = new URLSearchParams();
    if (opts.filename) params.set("filename", normalizeDownloadName(opts.filename));
    params.set("exp", String(exp));
    params.set("sig", computeAssetSignature(key, exp));
    const base = (opts.baseUrl || "").replace(/\/$/, "");
    return `${base}/api/assets/${encodeKeyPath(key)}?${params.toString()}`;
}

export type UnsignedPolicy = "allow" | "owner" | "deny";

export function resolveUnsignedPolicy(key: string): UnsignedPolicy {
    const raw = String(process.env[isUploadKey(key) ? "ASSET_UNSIGNED_UPLOADS" : "ASSET_UNSIGNED_INBOUND"] || "").toLowerCase();
    if (raw === "allow" || raw === "owner" || raw === "deny") return raw;
    return isUploadKey(key) ? "allow" : "owner";
}

/**
 * Decision de acceso (pura, testeable).
 *  - firma valida            -> permitir
 *  - firma presente pero caducada/invalida -> solo el propietario autenticado
 *  - sin firma               -> segun politica del prefijo
 */
export function decideAssetAccess(input: {
    sig: AssetSigResult;
    isOwner: boolean;
    policy: UnsignedPolicy;
}): { allow: boolean; reason: string } {
    if (input.sig === "ok") return { allow: true, reason: "signature" };
    if (input.isOwner) return { allow: true, reason: "owner" };
    if (input.sig === "missing") {
        if (input.policy === "allow") return { allow: true, reason: "legacy_unsigned" };
        return { allow: false, reason: "unsigned_denied" };
    }
    return { allow: false, reason: input.sig === "expired" ? "expired" : "bad_signature" };
}
