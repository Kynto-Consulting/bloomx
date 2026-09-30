import { z } from 'zod';
import { revokeAllSessions } from '@/lib/session';
import { adminRoute, audit, HttpError, parseBody } from '@/lib/admin/http';
import { setUserDisabled } from '@/lib/admin/user-state';
import { existingUserIds, isSelf } from '@/lib/admin/users-store';

const schema = z.object({
    ids: z.array(z.string().min(1).max(200)).min(1).max(100),
    action: z.enum(['disable', 'enable', 'revokeSessions']),
});

type Outcome = 'ok' | 'not_found' | 'skipped_self' | 'failed';

// Accion masiva: resultado POR id. Nunca deshabilita al propio admin. Auditoria por usuario.
export const POST = adminRoute({ scope: 'users.bulk', write: true, limit: 10 }, async (ctx) => {
    const { ids: raw, action } = await parseBody(ctx.req, schema);
    const ids = Array.from(new Set(raw));
    const existing = await existingUserIds(ids);
    const results: { id: string; result: Outcome }[] = [];

    for (const id of ids) {
        if (!existing.has(id)) {
            results.push({ id, result: 'not_found' });
            continue;
        }
        if (action === 'disable' && isSelf(ctx.actor, id)) {
            results.push({ id, result: 'skipped_self' });
            continue;
        }
        try {
            if (action === 'revokeSessions') {
                await revokeAllSessions(id);
                audit(ctx, 'users.sessions_revoked', { targetUserId: id, scope: 'all', bulk: true });
            } else {
                const ok = await setUserDisabled(id, action === 'disable');
                if (!ok) throw new HttpError(503, 'admin_state_unavailable');
                if (action === 'disable') await revokeAllSessions(id);
                audit(ctx, action === 'disable' ? 'users.disabled' : 'users.enabled', { targetUserId: id, bulk: true });
            }
            results.push({ id, result: 'ok' });
        } catch {
            results.push({ id, result: 'failed' });
        }
    }
    const count = (r: Outcome) => results.filter((x) => x.result === r).length;
    return { action, results, summary: { ok: count('ok'), notFound: count('not_found'), skippedSelf: count('skipped_self'), failed: count('failed') } };
});
