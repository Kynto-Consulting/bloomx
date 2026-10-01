import { actorKey, adminRoute, audit, parseBody } from '@/lib/admin/http';
import { requireCritical, toHttpError } from '@/lib/ai/admin';
import { changedFields, getAiSettingsView, patchIsCritical, recordAudit, saveAiSettings, settingsPatchSchema } from '@/lib/ai/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET -> vista de ajustes (NUNCA la clave: solo keyConfigured/keyLast4). */
export const GET = adminRoute({ scope: 'ai.read', limit: 60 }, async () => ({ ...(await getAiSettingsView()) }));

/**
 * PUT parche de ajustes. Campos criticos (enabled, provider, baseUrl, apiKey) => nivel 4 + step-up MFA; el resto, nivel 3.
 * La auditoria registra SOLO nombres de campos.
 */
export const PUT = adminRoute({ scope: 'ai.write', write: true, limit: 20 }, async (ctx) => {
    const patch = await parseBody(ctx.req, settingsPatchSchema);
    if (patchIsCritical(patch)) await requireCritical(ctx);
    const actor = ctx.actor.email || actorKey(ctx.actor, ctx.ip);
    let view;
    try { view = await saveAiSettings(patch, actor); } catch (e) { throw toHttpError(e); }
    const fields = changedFields(patch);
    await recordAudit(actor, 'settings.update', fields);
    audit(ctx, 'ai.settings_changed', { fields });
    return { ...view };
});
