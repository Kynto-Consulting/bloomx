import { z } from 'zod';

const envSchema = z.object({
    // Core
    DATABASE_URL: z.string().min(1, "Database URL is required"),
    NEXT_PUBLIC_APP_URL: z.string().url().default("https://bloomx.arubik.dev"),
    // En produccion el registro se deshabilita si se deja el valor por defecto (ver /api/register).
    REGISTRATION_KEY: z.string().default("dev-secret"),

    // Email Service (Resend)
    RESEND_API_KEY: z.string().min(1, "Resend API Key is required"),

    // Storage (S3 Compatible - Generic)
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_BUCKET: z.string().optional(),

    // Backblaze B2 (Legacy Support)
    B2_ENDPOINT: z.string().optional(),
    B2_REGION: z.string().optional(),
    B2_ACCESS_KEY: z.string().optional(),
    B2_SECRET_KEY: z.string().optional(),
    B2_BUCKET: z.string().optional(),

    // AI
    AI_PROVIDER: z.enum(['openai', 'gemini', 'anthropic', 'cohere', 'grok']).default('openai'),
    AI_KEY: z.string().optional(), // Optional if using local/mock, but usually required
    AI_MODEL: z.string().default('gpt-3.5-turbo'),

    // Auth Providers (Optional)
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // --- Seguridad (todas opcionales; los modulos las leen de process.env en tiempo de uso) ---
    // Claves: DATA_ENCRYPTION_KEY (+ _ID, DATA_ENCRYPTION_KEYS_PREVIOUS) para cifrado en reposo (lib/encryption.ts);
    // ASSET_SIGNING_KEY para URLs firmadas (lib/asset-url.ts); MOLT_SIGNING_KEY para tokens molt.
    DATA_ENCRYPTION_KEY: z.string().optional(),
    DATA_ENCRYPTION_KEY_ID: z.string().optional(),
    DATA_ENCRYPTION_KEYS_PREVIOUS: z.string().optional(),
    ASSET_SIGNING_KEY: z.string().optional(),
    // Sesion: SESSION_TTL_SECONDS (24h por defecto, inactividad) y SESSION_ABSOLUTE_MAX_SECONDS (14d).
    SESSION_TTL_SECONDS: z.string().optional(),
    SESSION_ABSOLUTE_MAX_SECONDS: z.string().optional(),
    // Administradores (lista de emails separada por comas): MFA obligatorio (lib/mfa.ts, lib/admin-auth.ts).
    ADMIN_EMAILS: z.string().optional(),
    // Antivirus opcional (lib/av-hook.ts) y retencion (lib/retention.ts).
    AV_SCAN_URL: z.string().optional(),
    CRON_SECRET: z.string().optional(),
});

export const env = envSchema.parse(process.env);
