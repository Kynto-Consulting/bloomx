import { prisma } from '@/lib/prisma';
import { validateRuleInput, type Action } from './engine';
import { toV2, type ConditionsV2 } from './conditions';
import { forwardingEnabled, verifiedForwardTargets } from './forward';

const LABEL_ACTIONS = ['addLabel', 'removeLabel', 'moveToLabelFolder'];

/** Comprueba que las etiquetas de las acciones (y la etiqueta vinculada) pertenecen al usuario. */
export async function ownsActionLabels(userId: string, actions: Array<{ type: string; labelId?: string }>, linkedLabelId?: string | null): Promise<boolean> {
    const ids = Array.from(new Set([
        ...actions.filter((a) => LABEL_ACTIONS.includes(a.type) && a.labelId).map((a) => a.labelId!),
        ...(linkedLabelId ? [linkedLabelId] : []),
    ]));
    if (ids.length === 0) return true;
    const count = await prisma.label.count({ where: { id: { in: ids }, userId } });
    return count === ids.length;
}

/** El reenvio solo se admite si esta habilitado y hacia direcciones verificadas del propio usuario. */
export async function forwardActionsAllowed(userId: string, actions: Action[]): Promise<{ ok: true } | { ok: false; error: string }> {
    const fwd = actions.filter((a): a is Extract<Action, { type: 'forwardTo' }> => a.type === 'forwardTo');
    if (fwd.length === 0) return { ok: true };
    if (!forwardingEnabled()) return { ok: false, error: 'El reenvio automatico esta desactivado' };
    const ok = new Set(await verifiedForwardTargets(userId));
    if (fwd.some((a) => !ok.has(a.address))) return { ok: false, error: 'Solo se puede reenviar a direcciones verificadas de tu cuenta' };
    return { ok: true };
}

export interface ParsedRule {
    name: string;
    enabled: boolean;
    priority: number;
    conditions: ConditionsV2;
    actions: Action[];
    stopProcessing: boolean;
    labelId?: string | null;
}

export function parseRuleBody(body: any): { ok: true; value: ParsedRule } | { ok: false; error: string } {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) return { ok: false, error: 'Nombre invalido (1-80 caracteres)' };
    const labelId: string | null | undefined = body?.labelId === undefined ? undefined : body.labelId === null ? null : String(body.labelId).slice(0, 100);

    // Las reglas de una etiqueta anaden la etiqueta de forma implicita: se acepta una lista de acciones sin ella.
    let rawActions: unknown = body?.actions;
    if (labelId && Array.isArray(rawActions) && !rawActions.some((a: any) => a?.type === 'addLabel' && a.labelId === labelId) && !rawActions.some((a: any) => a?.type === 'moveToLabelFolder' && a.labelId === labelId)) {
        rawActions = [{ type: 'addLabel', labelId }, ...rawActions];
    }
    if (labelId && (!Array.isArray(rawActions) || rawActions.length === 0)) rawActions = [{ type: 'addLabel', labelId }];

    const v = validateRuleInput({ conditions: body?.conditions, actions: rawActions });
    if (!v.ok) return { ok: false, error: v.error };
    const priority = Number.isFinite(Number(body?.priority)) ? Math.max(-1000, Math.min(1000, Math.trunc(Number(body.priority)))) : 0;
    return {
        ok: true,
        value: {
            name,
            enabled: body?.enabled !== false,
            priority,
            conditions: toV2(v.conditions),
            actions: v.actions,
            stopProcessing: body?.stopProcessing === true,
            ...(labelId !== undefined ? { labelId } : {}),
        },
    };
}
