/** Catalogo de campos y operadores del constructor de condiciones (datos puros; los textos viven en i18n `ruleBuilder`). */
import {
    AUTH_MECHS, CONDITION_FOLDERS, HEADER_WHITELIST, MAX_DEPTH, MAX_LEAVES, countLeaves, isGroup,
    type ConditionsV2, type Group, type Leaf, type Node,
} from '@/lib/rules/conditions';

export type FieldKind = 'address' | 'domain' | 'text' | 'language' | 'count' | 'bytes' | 'number' | 'hour' | 'dow' | 'date' | 'bool' | 'label' | 'folder' | 'header' | 'auth';

export interface FieldDef { id: string; kind: FieldKind; group: 'sender' | 'recipients' | 'content' | 'attachments' | 'message' | 'contacts' | 'state' | 'headers' }

export const FIELD_DEFS: FieldDef[] = [
    { id: 'from', kind: 'address', group: 'sender' },
    { id: 'fromName', kind: 'text', group: 'sender' },
    { id: 'fromDomain', kind: 'domain', group: 'sender' },
    { id: 'replyTo', kind: 'address', group: 'sender' },
    { id: 'to', kind: 'address', group: 'recipients' },
    { id: 'toDomain', kind: 'domain', group: 'recipients' },
    { id: 'cc', kind: 'address', group: 'recipients' },
    { id: 'bcc', kind: 'address', group: 'recipients' },
    { id: 'toAlias', kind: 'text', group: 'recipients' },
    { id: 'subject', kind: 'text', group: 'content' },
    { id: 'body', kind: 'text', group: 'content' },
    { id: 'bodyHtml', kind: 'text', group: 'content' },
    { id: 'language', kind: 'language', group: 'content' },
    { id: 'hasAttachment', kind: 'bool', group: 'attachments' },
    { id: 'attachmentName', kind: 'text', group: 'attachments' },
    { id: 'attachmentType', kind: 'text', group: 'attachments' },
    { id: 'attachmentCount', kind: 'count', group: 'attachments' },
    { id: 'attachmentsSize', kind: 'bytes', group: 'attachments' },
    { id: 'size', kind: 'bytes', group: 'message' },
    { id: 'date', kind: 'date', group: 'message' },
    { id: 'hour', kind: 'hour', group: 'message' },
    { id: 'dayOfWeek', kind: 'dow', group: 'message' },
    { id: 'isReply', kind: 'bool', group: 'message' },
    { id: 'isForward', kind: 'bool', group: 'message' },
    { id: 'isThread', kind: 'bool', group: 'message' },
    { id: 'isCalendarInvite', kind: 'bool', group: 'message' },
    { id: 'spamScore', kind: 'number', group: 'message' },
    { id: 'senderInContacts', kind: 'bool', group: 'contacts' },
    { id: 'senderIsMe', kind: 'bool', group: 'contacts' },
    { id: 'isExternal', kind: 'bool', group: 'contacts' },
    { id: 'hasLabel', kind: 'label', group: 'state' },
    { id: 'inFolder', kind: 'folder', group: 'state' },
    { id: 'isRead', kind: 'bool', group: 'state' },
    { id: 'isStarred', kind: 'bool', group: 'state' },
    { id: 'header', kind: 'header', group: 'headers' },
    { id: 'auth', kind: 'auth', group: 'headers' },
];
export const FIELD_GROUPS = ['sender', 'recipients', 'content', 'attachments', 'message', 'contacts', 'state', 'headers'] as const;
export const defOf = (id: string) => FIELD_DEFS.find((f) => f.id === id);

const COMMON = ['contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith', 'regex', 'notRegex', 'in', 'notIn', 'wildcard', 'notWildcard'] as const;
export const OPS_BY_KIND = {
    address: COMMON,
    domain: ['equals', 'notEquals', 'in', 'notIn', 'endsWith', 'contains', 'notContains', 'wildcard', 'regex'],
    text: [...COMMON, 'containsAny'],
    language: ['equals', 'notEquals', 'in', 'notIn'],
    header: ['exists', 'notExists', ...COMMON],
} as const;
export const NUM_OPS = ['lt', 'lte', 'eq', 'gte', 'gt'] as const;
export const LIST_TEXT_OPS = ['in', 'notIn', 'containsAny', 'wildcard', 'notWildcard'];
export const isListOp = (op: string) => LIST_TEXT_OPS.includes(op);
export const HEADERS = HEADER_WHITELIST.filter((h) => !['authentication-results'].includes(h));
export { AUTH_MECHS, CONDITION_FOLDERS, MAX_DEPTH, MAX_LEAVES };

export const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; } };

/** Hoja nueva para un campo con valores iniciales razonables. */
export function defaultLeaf(field: string): Leaf {
    const d = defOf(field);
    switch (d?.kind) {
        case 'domain': return { field: field as 'fromDomain', op: 'equals', value: '', subdomains: true };
        case 'address': case 'text': return { field: field as 'from', op: 'contains', value: '' };
        case 'language': return { field: 'language', op: 'equals', value: 'es' };
        case 'count': return { field: field as 'attachmentCount', op: 'gte', value: 1 };
        case 'bytes': return { field: field as 'size', op: 'gt', value: 1024 * 1024 };
        case 'number': return { field: 'spamScore', op: 'gt', value: 50 };
        case 'hour': return { field: 'hour', op: 'gte', value: 9, tz: browserTz() };
        case 'dow': return { field: 'dayOfWeek', op: 'in', values: [0, 6], tz: browserTz() };
        case 'date': return { field: 'date', op: 'after', value: new Date(Date.now() - 30 * 86_400_000).toISOString() };
        case 'bool': return { field: field as 'hasAttachment', value: true };
        case 'label': return { field: 'hasLabel', value: '' };
        case 'folder': return { field: 'inFolder', value: 'inbox' };
        case 'header': return { field: 'header', name: 'list-unsubscribe', op: 'exists' };
        case 'auth': return { field: 'auth', mech: 'spf', value: 'pass' };
        default: return { field: 'subject', op: 'contains', value: '' };
    }
}

/** Puede anadirse otro grupo / condicion en `depth` sin pasar los limites. */
export const canAddLeaf = (root: Node) => countLeaves(root) < MAX_LEAVES;
export const canAddGroup = (depth: number, root: Node) => depth < MAX_DEPTH && countLeaves(root) < MAX_LEAVES;

export type Path = number[];

/** Actualiza inmutablemente el nodo en `path`; fn devuelve el nodo nuevo o null para quitarlo. */
export function updateAt(root: Group, path: Path, fn: (n: Node) => Node | null): Group {
    if (path.length === 0) { const r = fn(root); return r && isGroup(r) ? r : root; }
    const [i, ...rest] = path;
    const children = root.children.flatMap((c, idx) => {
        if (idx !== i) return [c];
        if (rest.length === 0) { const r = fn(c); return r ? [r] : []; }
        return isGroup(c) ? [updateAt(c, rest, fn)] : [c];
    });
    return { ...root, children };
}

export const emptyConditions = (): ConditionsV2 => ({ v: 2, root: { type: 'group', op: 'and', children: [defaultLeaf('from')] } });
