/**
 * Operaciones REMOTAS de `services.formats` (las demas son puras y viven en el backend):
 *  - renderTemplate: motor Liquid existente (src/lib/liquid.ts) con sus limites. Si el render falla => error tipado,
 *    NUNCA se devuelve la plantilla cruda. Salida de texto (sin autoescape); variables solo escalares.
 *  - sanitizeHtml: MISMA configuracion y hooks del sanitizer existente (src/lib/sanitizeHtml.ts: PURIFY_CONFIG), ejecutada en
 *    servidor con isomorphic-dompurify (jsdom) para conservar el formato seguro (sin scripts, formularios ni URI peligrosas).
 *    Si jsdom no se puede cargar, degrada a texto escapado sin etiquetas (seguro, pierde formato).
 */
import { z } from 'zod';
import { renderTemplate as renderLiquidTemplate } from '@/lib/liquid';
import { installSanitizeHooks, PURIFY_CONFIG, sanitizeHtml } from '@/lib/sanitizeHtml';
import { BridgeError, op } from './bridge-route';

const scalar = z.union([z.string().max(5000), z.number().finite(), z.boolean(), z.null()]);

export const formatsRequest = z.discriminatedUnion('op', [
    op('renderTemplate', z.strictObject({
        template: z.string().max(20_000),
        variables: z.record(z.string().min(1).max(64).regex(/^[A-Za-z_][A-Za-z0-9_]*$/), scalar)
            .refine((v) => Object.keys(v).length <= 50 && !Object.keys(v).some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype'), 'invalid variables'),
    })),
    op('sanitizeHtml', z.strictObject({ html: z.string().max(200_000) })),
]);
export type FormatsRequest = z.infer<typeof formatsRequest>;

export interface FormatsDeps {
    render: (template: string, data: Record<string, unknown>) => string;
    sanitize: (html: string) => string | Promise<string>;
}

let serverPurify: Promise<any> | null = null;

/** DOMPurify con DOM en servidor (carga perezosa: jsdom es pesado), con la config y hooks del sanitizer del cliente. */
export async function sanitizeHtmlOnServer(html: string): Promise<string> {
    try {
        serverPurify ??= import('isomorphic-dompurify').then((mod: any) => {
            const purify = mod.default ?? mod;
            installSanitizeHooks(purify);
            return purify;
        });
        const purify = await serverPurify;
        return String(purify.sanitize(html, PURIFY_CONFIG));
    } catch {
        serverPurify = null;
        return sanitizeHtml(html); // sin DOM: texto escapado sin etiquetas
    }
}

export const defaultFormatsDeps: FormatsDeps = {
    render: (template, data) => renderLiquidTemplate(template, data, { strictVariables: false }),
    sanitize: sanitizeHtmlOnServer,
};

export async function handleFormats(deps: FormatsDeps, req: FormatsRequest): Promise<unknown> {
    switch (req.op) {
        case 'renderTemplate': {
            let text: string;
            try {
                const data: Record<string, unknown> = { ...req.args.variables };
                text = deps.render(req.args.template, data);
            } catch {
                // Error de sintaxis/limite/tiempo de la plantilla: error del llamador, sin reflejar la plantilla.
                throw new BridgeError('invalid_args');
            }
            return { text };
        }
        case 'sanitizeHtml':
            return { html: await deps.sanitize(req.args.html) };
    }
}
