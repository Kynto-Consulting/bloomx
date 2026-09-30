/** Descripcion en lenguaje natural de una regla completa (condiciones + acciones). Puro; es / en. */
import { describeConditions, type DescribeLocale } from './conditions';
import type { Action } from './engine';

const A = {
    es: {
        then: ' → ',
        addLabel: (n: string) => `etiquetar «${n}»`,
        removeLabel: (n: string) => `quitar la etiqueta «${n}»`,
        moveToLabelFolder: (n: string) => `mover a la carpeta «${n}»`,
        markRead: 'marcar como leído', star: 'destacar', archive: 'saltar la Entrada (archivar)', delete: 'mover a la Papelera', markSpam: 'marcar como spam',
        moveToFolder: (f: string) => `mover a ${f}`, forwardTo: (a: string) => `reenviar a ${a}`, snooze: (h: number) => `posponer ${h} h`, stopProcessing: 'no aplicar más reglas',
        unknownLabel: 'etiqueta eliminada', folders: { inbox: 'Entrada', archive: 'Archivados', trash: 'la Papelera', spam: 'Spam' } as Record<string, string>, none: 'sin acciones',
    },
    en: {
        then: ' → ',
        addLabel: (n: string) => `label "${n}"`,
        removeLabel: (n: string) => `remove label "${n}"`,
        moveToLabelFolder: (n: string) => `move to folder "${n}"`,
        markRead: 'mark as read', star: 'star', archive: 'skip the Inbox (archive)', delete: 'move to Trash', markSpam: 'mark as spam',
        moveToFolder: (f: string) => `move to ${f}`, forwardTo: (a: string) => `forward to ${a}`, snooze: (h: number) => `snooze ${h} h`, stopProcessing: 'stop processing more rules',
        unknownLabel: 'deleted label', folders: { inbox: 'Inbox', archive: 'Archive', trash: 'Trash', spam: 'Spam' } as Record<string, string>, none: 'no actions',
    },
} as const;

export function describeActions(actions: Action[], labelName: (id: string) => string | undefined, loc: DescribeLocale = 'es'): string {
    const d = A[loc];
    const parts = (Array.isArray(actions) ? actions : []).map((a) => {
        switch (a.type) {
            case 'addLabel': return d.addLabel(labelName(a.labelId) ?? d.unknownLabel);
            case 'removeLabel': return d.removeLabel(labelName(a.labelId) ?? d.unknownLabel);
            case 'moveToLabelFolder': return d.moveToLabelFolder(labelName(a.labelId) ?? d.unknownLabel);
            case 'moveToFolder': return d.moveToFolder(d.folders[a.folder] ?? a.folder);
            case 'forwardTo': return d.forwardTo(a.address);
            case 'snooze': return d.snooze(a.hours);
            default: return d[a.type as 'markRead'] as string;
        }
    });
    return parts.length ? parts.join(', ') : d.none;
}

/** "Si el remitente es del dominio «empresa.com» y el asunto contiene «factura» → etiquetar «Facturas», saltar la Entrada". */
export function describeRule(conditions: unknown, actions: Action[], labelName: (id: string) => string | undefined, loc: DescribeLocale = 'es'): string {
    return `${describeConditions(conditions, loc)}${A[loc].then}${describeActions(actions, labelName, loc)}`;
}
