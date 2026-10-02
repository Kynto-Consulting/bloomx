import type { CommandDef } from '../types';
import { data, def, kv, L, table } from './_h';

/**
 * Facturacion y portal de desarrollador (lectura). Los proxies /api/admin/billing/** y /api/admin/developer/** exigen nivel 4, step-up reciente
 * y firma de dominio; aqui solo se EXPONEN LECTURAS. Lo que mueve dinero o necesita al navegador (crear pedido, aprobar en PayPal, cancelar,
 * vincular cuenta, enviar a revision, publicar) se hace en /admin/billing y /developer: el flujo de PayPal exige una redireccion de navegador.
 */

export const paymentsCommands: CommandDef[] = [
    def({
        name: 'billing status', risk: 'read', summary: L('Estado de pagos de la instancia (PayPal y modo de cobro)', 'Instance payments state (PayPal and charge mode)'),
        covers: ['ALL /api/admin/billing/**'], handler: async ({ ctx }) => data((await ctx.callOk({ method: 'GET', path: '/billing/status' })).data),
    }),
    def({
        name: 'billing subscriptions', risk: 'read', summary: L('Suscripciones de extensiones de pago del dominio', 'Paid-extension subscriptions of the domain'),
        handler: async ({ ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/billing/subscriptions' })).data;
            const rows = (r.subscriptions ?? r.items ?? []) as any[];
            return table(['id', 'extensionId', 'status', 'interval'], rows.map((s) => ({ id: s.id ?? '', extensionId: s.extensionId ?? '', status: s.status ?? '', interval: s.interval ?? s.plan ?? '' })));
        },
    }),
    def({
        name: 'billing summary', risk: 'read', summary: L('Resumen de facturacion (compras y ventas) del periodo', 'Billing summary (purchases and sales) for the period'),
        flags: [
            { name: 'from', type: 'string', description: L('Desde (AAAA-MM-DD)', 'From (YYYY-MM-DD)') },
            { name: 'to', type: 'string', description: L('Hasta (AAAA-MM-DD)', 'To (YYYY-MM-DD)') },
        ],
        handler: async ({ args, ctx }) => data((await ctx.callOk({ method: 'GET', path: '/billing/summary', query: { from: args.flags.from as string | undefined, to: args.flags.to as string | undefined } })).data),
    }),
    def({
        name: 'developer overview', risk: 'read', summary: L('Portal de desarrollador: terminos aceptados, extensiones y envios', 'Developer portal: accepted terms, extensions and submissions'),
        covers: ['ALL /api/admin/developer/**'], handler: async ({ ctx }) => {
            const r = (await ctx.callOk({ method: 'GET', path: '/developer/overview' })).data;
            return r && typeof r === 'object' && !Array.isArray(r) ? kv(Object.entries(r).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : (v as any)])) : data(r);
        },
    }),
];
