import { z } from 'zod';
import { adminRoute, parseBody } from '@/lib/admin/http';
import { getSpamConfig } from '@/lib/spam/config-store';
import { simulate } from '@/lib/spam/simulate';
import { configPatchSchema } from '@/lib/spam/config-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { config: <parche parcial> } -> "con este ajuste, de los ultimos 200 correos evaluados X habrian ido a spam". No cambia nada. */
export const POST = adminRoute({ scope: 'spam.simulate', write: true, limit: 30 }, async (ctx) => {
    const { config } = await parseBody(ctx.req, z.object({ config: configPatchSchema }).strict());
    const current = await getSpamConfig({ fresh: true });
    const r = await simulate(config, current, ctx.actor.kind === 'user' ? ctx.actor.id : null);
    return { ...r, scope: ctx.actor.kind === 'user' ? 'mine' : 'domain' };
});
