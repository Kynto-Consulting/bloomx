import { z } from 'zod';
import { audit, parseBody } from '@/lib/admin/http';
import { auditLog } from '@/lib/security';
import { getSpamConfig } from '@/lib/spam/config-store';
import { effectiveThreshold } from '@/lib/spam/config-core';
import { MIN_TRAINED_MESSAGES } from '@/lib/spam/bayes';
import { deleteModel, getUserPrefs, modelStats, saveUserPrefs } from '@/lib/spam/learning-store';
import { userRoute } from '@/lib/spam/user-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function view(userId: string) {
    const [cfg, prefs, model] = await Promise.all([getSpamConfig(), getUserPrefs(userId), modelStats(userId)]);
    return {
        prefs,
        // Lo que el dominio permite: si no deja ajustar, la sensibilidad se ignora
        domain: { level: cfg.level, allowUserSensitivity: cfg.allowUserSensitivity, learningAllowed: cfg.engine.learning, externalEnabled: cfg.external.enabled },
        effectiveThreshold: effectiveThreshold(cfg, prefs.sensitivity),
        baseThreshold: effectiveThreshold(cfg, 0),
        model: { ...model, minMessages: MIN_TRAINED_MESSAGES, active: model.spamMessages + model.hamMessages >= MIN_TRAINED_MESSAGES },
    };
}

export const GET = userRoute({ scope: 'settings.read' }, async ({ user }) => ({ ...(await view(user.id)) }));

const bodySchema = z.object({ learn: z.boolean().optional(), sensitivity: z.union([z.literal(-1), z.literal(0), z.literal(1)]).optional() }).strict();

/** PUT { learn?, sensitivity? (-1 | 0 | 1) }. La sensibilidad solo tiene efecto si el dominio la permite. */
export const PUT = userRoute({ scope: 'settings.write', write: true }, async ({ req, user }) => {
    const body = await parseBody(req, bodySchema);
    await saveUserPrefs(user.id, body);
    auditLog('spam.user_prefs_changed', { userId: user.id, ...body });
    return { ...(await view(user.id)) };
});

/** DELETE -> borra el modelo aprendido (tokens y contadores por remitente) sin tocar las listas ni las preferencias. */
export const DELETE = userRoute({ scope: 'settings.write', write: true, limit: 10 }, async ({ user }) => {
    const r = await deleteModel(user.id);
    auditLog('spam.user_model_deleted', { userId: user.id, ...r });
    return { deleted: r, ...(await view(user.id)) };
});

void audit;
