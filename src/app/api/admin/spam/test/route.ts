import { z } from 'zod';
import { HttpError, adminRoute, audit, parseBody } from '@/lib/admin/http';
import { loadOwnEmailForProbe, probe } from '@/lib/spam/probe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
    rawHeaders: z.string().max(60_000).optional(),
    from: z.string().max(400).optional(),
    subject: z.string().max(1000).optional(),
    text: z.string().max(50_000).optional(),
    html: z.string().max(50_000).optional(),
    attachments: z.array(z.object({ filename: z.string().min(1).max(200) }).strict()).max(20).optional(),
    /** Id de un correo PROPIO del administrador (solo usuarios con buzon). */
    emailId: z.string().min(1).max(64).optional(),
}).strict();

/** POST -> puntuacion por senal. No guarda nada, no cuenta aciertos de lista y no envia nada. */
export const POST = adminRoute({ scope: 'spam.test', write: true, limit: 30 }, async (ctx) => {
    const body = await parseBody(ctx.req, bodySchema);
    let input = body as Parameters<typeof probe>[0];
    if (body.emailId) {
        if (ctx.actor.kind !== 'user') throw new HttpError(400, 'no_mailbox');
        const own = await loadOwnEmailForProbe(ctx.actor.id, body.emailId);
        if (!own) throw new HttpError(404, 'email_not_found'); // tambien para correos ajenos: no se revela su existencia
        input = own;
    } else if (!body.rawHeaders && !body.text && !body.html && !body.subject && !body.from) {
        throw new HttpError(400, 'empty_input');
    }
    const r = await probe(input);
    audit(ctx, 'spam.test_run', { score: r.score, own: !!body.emailId });
    return { ...r };
});
