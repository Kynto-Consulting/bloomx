import { prisma } from '@/lib/prisma';
import { validateRuleInput } from './engine';

/** Comprueba que las etiquetas de las acciones pertenecen al usuario. */
export async function ownsActionLabels(userId: string, actions: Array<{ type: string; labelId?: string }>): Promise<boolean> {
    const ids = Array.from(new Set(actions.filter((a) => a.type === 'addLabel' && a.labelId).map((a) => a.labelId!)));
    if (ids.length === 0) return true;
    const count = await prisma.label.count({ where: { id: { in: ids }, userId } });
    return count === ids.length;
}

export function parseRuleBody(body: any) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) return { ok: false as const, error: 'Nombre invalido (1-80 caracteres)' };
    const v = validateRuleInput({ conditions: body.conditions, actions: body.actions });
    if (!v.ok) return { ok: false as const, error: v.error };
    const priority = Number.isFinite(Number(body.priority)) ? Math.max(-1000, Math.min(1000, Math.trunc(Number(body.priority)))) : 0;
    return {
        ok: true as const,
        value: {
            name,
            enabled: body.enabled !== false,
            priority,
            conditions: v.conditions,
            actions: v.actions,
            stopProcessing: body.stopProcessing === true,
        },
    };
}
