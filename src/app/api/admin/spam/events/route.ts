import { z } from 'zod';
import { adminRoute, parseQuery } from '@/lib/admin/http';
import { EVENT_DECISIONS, listEvents } from '@/lib/spam/events-store';
import { explainSignal } from '@/lib/spam/reasons';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const dateStr = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), 'date');
const schema = z.object({
    from: dateStr.optional(), to: dateStr.optional(), decision: z.enum(EVENT_DECISIONS).optional(), domain: z.string().max(100).optional(),
    page: z.coerce.number().int().min(1).max(100_000).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

/** Registro de decisiones SIN contenido: remitente, destinatario, decision, puntuacion, regla y motivos (ids + texto es/en). */
export const GET = adminRoute({ scope: 'spam.events.read', limit: 120 }, async (ctx) => {
    const q = parseQuery(ctx.req, schema);
    const r = await listEvents({ from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined, decision: q.decision, domain: q.domain, page: q.page, pageSize: q.pageSize });
    return {
        total: r.total,
        rows: r.rows.map((e) => ({
            ...e,
            reasons: e.reasons.slice(0, 12).map((x) => ({ id: x.i, weight: x.w, es: explainSignal({ id: x.i }, 'es'), en: explainSignal({ id: x.i }, 'en') })),
        })),
    };
});
