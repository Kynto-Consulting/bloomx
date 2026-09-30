import { actorKey, adminRoute, audit, parseBody } from '@/lib/admin/http';
import { ownDomains } from '@/lib/backend-auth';
import { getSpamConfigInfo, resetSpamConfig, saveSpamConfig } from '@/lib/spam/config-store';
import { PRESET_THRESHOLDS } from '@/lib/spam/config-core';
import { configPatchSchema } from '@/lib/spam/config-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function view() {
    const info = await getSpamConfigInfo({ fresh: true });
    return { config: info.config, source: info.source, updatedAt: info.updatedAt, updatedBy: info.updatedBy, presets: PRESET_THRESHOLDS, ownDomains: ownDomains() };
}

export const GET = adminRoute({ scope: 'spam.config.read', limit: 120 }, async () => ({ ...(await view()) }));

export const PUT = adminRoute({ scope: 'spam.config.write', write: true, limit: 30 }, async (ctx) => {
    const patch = await parseBody(ctx.req, configPatchSchema);
    await saveSpamConfig(patch, ctx.actor.email || actorKey(ctx.actor, ctx.ip));
    // Se auditan las claves cambiadas (nunca los textos libres)
    audit(ctx, 'spam.config_changed', { keys: Object.keys(patch), ...(patch.level ? { level: patch.level } : {}), ...(patch.threshold ? { threshold: patch.threshold } : {}) });
    return { ...(await view()) };
});

export const DELETE = adminRoute({ scope: 'spam.config.write', write: true, limit: 10 }, async (ctx) => {
    await resetSpamConfig(ctx.actor.email || actorKey(ctx.actor, ctx.ip));
    audit(ctx, 'spam.config_reset', {});
    return { ...(await view()) };
});
