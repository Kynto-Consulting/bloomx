import { z } from 'zod';
import { HttpError, notFound, parseBody } from '@/lib/admin/http';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/security';
import { canAccessEmail } from '@/lib/mailbox-access';
import { moveEmailsTracked } from '@/lib/mail-store';
import { apiAdd, userOwner } from '@/lib/spam/lists-api';
import { domainOf, parseAddress } from '@/lib/spam/text';
import { userRoute } from '@/lib/spam/user-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
    emailId: z.string().min(1).max(64),
    target: z.enum(['sender', 'domain']),
    /** Mover ese correo a spam ademas de bloquear (por defecto si). */
    moveToSpam: z.boolean().optional(),
}).strict();

/**
 * Accion "Bloquear remitente / dominio" del lector: anade el remitente (o su dominio) a la blocklist PERSONAL del dueno del buzon.
 * No se puede bloquear el propio dominio (guarda de lists-api). Correos ajenos -> 404 (sin revelar su existencia).
 */
export const POST = userRoute({ scope: 'block', write: true, limit: 60 }, async ({ req, user }) => {
    const { emailId, target, moveToSpam } = await parseBody(req, schema);
    const email = await prisma.email.findUnique({ where: { id: emailId }, select: { id: true, userId: true, from: true } });
    if (!email || !(await canAccessEmail(user.id, email.userId))) throw notFound('email_not_found');
    const addr = parseAddress(email.from).email;
    const dom = domainOf(addr);
    if (!addr || !dom) throw new HttpError(400, 'no_sender');
    const r = await apiAdd(userOwner(email.userId), 'block', {
        entries: [target === 'sender' ? { matchType: 'email', value: addr, reason: 'reader' } : { matchType: 'domain', value: dom, includeSubdomains: false, reason: 'reader' }],
    });
    if (r.invalid.length > 0) throw new HttpError(400, r.invalid[0].error);
    if (moveToSpam !== false) await moveEmailsTracked({ ids: [email.id], userIds: [email.userId], folder: 'spam' });
    auditLog('spam.user_block', { userId: user.id, target, added: r.added });
    return { ok: true, added: r.added, duplicates: r.duplicates, value: target === 'sender' ? addr : dom };
});
