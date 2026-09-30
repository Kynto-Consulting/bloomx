import { actorKey, adminRoute, audit, parseBody } from '@/lib/admin/http';
import { getRetentionSettings, retentionPatchSchema, saveRetentionSettings } from '@/lib/admin/retention-settings';
import { RETENTION_KEYS } from '@/lib/retention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET -> { effective, env, overrides, updatedAt, updatedBy, limits }. `effective` = entorno + lo guardado desde la consola. */
export const GET = adminRoute({ scope: 'retention.settings.read', limit: 60 }, async () => ({ ...(await getRetentionSettings()) }));

/** PUT { spamDays?: n|null, ... }: `null` vuelve al valor del entorno para esa clave. Audita las claves y valores numericos. */
export const PUT = adminRoute({ scope: 'retention.settings.write', write: true, limit: 20 }, async (ctx) => {
    const patch = await parseBody(ctx.req, retentionPatchSchema);
    const changed = RETENTION_KEYS.filter((k) => patch[k] !== undefined);
    const values: Record<string, number | null> = {};
    for (const k of changed) values[k] = patch[k] ?? null;
    const view = await saveRetentionSettings(patch, ctx.actor.email || actorKey(ctx.actor, ctx.ip));
    audit(ctx, 'retention.settings_changed', { changedKeys: changed, values });
    return { ...view };
});
