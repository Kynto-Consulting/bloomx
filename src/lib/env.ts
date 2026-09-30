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
});

export const env = envSchema.parse(process.env);
