/** Esquemas zod y utilidades de respuesta de las APIs de plantillas/campanas de Elixir. */
import { z } from 'zod';
import { NextResponse } from 'next/server';

export const senderConfigSchema = z.object({
    fromName: z.string().max(300).optional(),
    fromEmail: z.string().max(500).optional(),
    cc: z.string().max(2_000).optional(),
    bcc: z.string().max(2_000).optional(),
}).partial();

export const templateInputSchema = z.object({
    name: z.string().trim().min(1, 'El nombre es obligatorio').max(120, 'Nombre demasiado largo'),
    subject: z.string().max(2_000).default(''),
    body: z.string().max(500_000).default(''),
    senderConfig: senderConfigSchema.default({}),
});

export const campaignCreateSchema = z.object({
    name: z.string().trim().max(160).default(''),
    subject: z.string().min(1, 'El asunto está vacío').max(2_000),
    template: z.string().min(1, 'La plantilla está vacía').max(500_000),
    recipientColumn: z.string().min(1, 'Columna de destinatario no especificada').max(200),
    senderConfig: senderConfigSchema.default({}),
    systemVars: z.record(z.string().max(100), z.string().max(2_000)).optional().refine(v => !v || Object.keys(v).length <= 50, 'Demasiadas variables'),
    timezone: z.string().max(64).optional(),
    autoescape: z.boolean().optional(),
    strictVariables: z.boolean().optional(),
    unsubscribeFooter: z.boolean().optional(),
});

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const rowsChunkSchema = z.object({
    items: z.array(z.object({
        index: z.number().int().min(0).max(1_000_000),
        row: z.record(z.string().max(200), cell),
    })).min(1).max(500),
});

export const campaignActionSchema = z.object({
    action: z.enum(['start', 'pause', 'resume', 'cancel', 'retry_errors']),
});

export function firstIssue(err: z.ZodError): string {
    const i = err.issues[0];
    return `${i?.path.join('.') || 'payload'}: ${i?.message ?? 'inválido'}`;
}

export function tablesMissing() {
    return NextResponse.json({ error: 'Las tablas de Elixir no existen todavía; ejecute db:ensure', code: 'elixir_tables_missing' }, { status: 503 });
}
