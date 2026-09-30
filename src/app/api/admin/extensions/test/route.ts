import { adminRoute, audit, badRequest, json, notFound, parseBody } from '@/lib/admin/http';
import { fetchCatalog } from '@/lib/admin/extensions-catalog';
import { testConnectionAction } from '@/lib/admin/extensions-manifest';
import { testBody } from '@/lib/admin/extensions-schemas';
import { runTestConnection, testConnectionSupport } from '@/lib/admin/extensions-test';

/**
 * POST { extensionId } -> { ok: boolean, message?: 'auth_required'|'timeout'|'not_installed'|'rate_limited'|'failed' }
 * Ejecuta la funcion de prueba (`testConnection`) que DECLARA el manifest, en el backend, con timeout de 10 s. Devuelve solo
 * el resultado y un codigo estable: jamas datos de la respuesta del proveedor. Audita `extension.test` con `outcome`.
 * 501 `not_supported` (con `reason`) si no se puede ejecutar de forma segura: ver lib/admin/extensions-test.ts.
 */
export const POST = adminRoute({ scope: 'extensions.test', write: true, limit: 10 }, async (ctx) => {
    const { extensionId } = await parseBody(ctx.req, testBody);

    const support = testConnectionSupport(ctx.actor);
    if (!support.supported || ctx.actor.kind !== 'user') {
        const reason = support.supported ? 'user_context_required' : support.reason;
        return json({ error: 'Not supported', code: 'not_supported', reason }, { status: 501 });
    }

    const catalog = await fetchCatalog();
    const entry = catalog.find((e) => e.id === extensionId);
    if (!entry) throw notFound('extension_not_found');
    const action = testConnectionAction(entry.template);
    if (!action) throw badRequest('no_test_function');

    const outcome = await runTestConnection({ req: ctx.req, actor: ctx.actor, extensionId, action });
    audit(ctx, 'extension.test', { extensionId, outcome: outcome.ok ? 'ok' : 'failed', status: outcome.status || undefined });
    return { ok: outcome.ok, ...(outcome.message ? { message: outcome.message } : {}) };
});
