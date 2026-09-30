import type { ConditionsV2 } from '@/lib/rules/conditions';

export const TEMPLATE_IDS = ['domain', 'newsletters', 'invoices', 'contacts', 'automated'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

const and = (...children: any[]): ConditionsV2 => ({ v: 2, root: { type: 'group', op: 'and', children } });

/** Plantillas rapidas: condiciones listas para ajustar (los textos viven en i18n `ruleBuilder.templates`). */
export function templateConditions(id: TemplateId): ConditionsV2 {
    switch (id) {
        case 'domain':
            return and({ field: 'fromDomain', op: 'equals', value: '', subdomains: true });
        case 'newsletters':
            return and({ field: 'header', name: 'list-unsubscribe', op: 'exists' });
        case 'invoices':
            return and(
                { field: 'subject', op: 'containsAny', values: ['factura', 'invoice', 'recibo'] },
                { field: 'attachmentType', op: 'equals', value: 'pdf' },
            );
        case 'contacts':
            return and({ field: 'senderInContacts', value: true });
        case 'automated':
            return { v: 2, root: { type: 'group', op: 'or', children: [
                { field: 'header', name: 'precedence', op: 'in', values: ['bulk', 'list', 'junk'] },
                { type: 'group', op: 'and', children: [
                    { field: 'header', name: 'auto-submitted', op: 'exists' },
                    { field: 'header', name: 'auto-submitted', op: 'notEquals', value: 'no' },
                ] },
                { field: 'from', op: 'wildcard', values: ['noreply@*', 'no-reply@*', 'notifications@*'] },
            ] } };
    }
}
