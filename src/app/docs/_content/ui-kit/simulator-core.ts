import { UI_LIMITS, type PropSpec } from '@/lib/expansions/ui-schema';
import { MOUNT_POINT_CONTEXT } from '@/lib/expansions/mount-points';
import { EXAMPLE_CONTEXT } from '@/lib/expansions/ui-examples';
import { analyze, parseJson } from '@/lib/expansions/playground/analyze';
import { formatTime, MAX_DELAY_MS } from '@/lib/expansions/playground/simulate';

/**
 * Nucleo PURO del simulador de /docs/extension-ui/<componente> (sin React, sin red): validacion del JSON editado con el
 * validador del esquema, contexto simulado por punto de montaje, backend simulado (CALL_BACKEND con exito/error
 * configurables), registro de eventos, formulario generado del esquema y snippet de manifest.
 */

// ------------------------------------------------------------------ validacion del JSON editado
export interface SimIssue { path: string; message: string; line?: number; column?: number }
export interface SimEvaluation {
    status: 'ok' | 'invalid' | 'empty';
    /** Nodo validado (ya migrado al formato actual): lo unico que se renderiza. */
    node?: Record<string, any>;
    errors: SimIssue[];
    warnings: SimIssue[];
    deprecations: SimIssue[];
    bytes: number;
}

const byteLength = (text: string): number => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length);

/** Valida el texto con el MISMO validador que la app (validateUi + checkExpression, via analyze) y respeta los limites del esquema. */
export function evaluateNodeText(text: string): SimEvaluation {
    const bytes = byteLength(text);
    const empty: SimEvaluation = { status: 'empty', errors: [], warnings: [], deprecations: [], bytes };
    if (!text.trim()) return empty;
    if (bytes > UI_LIMITS.maxBytes) {
        return { ...empty, status: 'invalid', errors: [{ path: '$', message: `El JSON ocupa ${bytes} bytes y el límite es ${UI_LIMITS.maxBytes}` }] };
    }
    const analysis = analyze(text);
    const pick = (cat: string): SimIssue[] => analysis.issues.filter((i) => i.category === cat).map((i) => ({ path: i.path, message: i.message, line: i.line, column: i.column }));
    const errors = pick('error');
    if (analysis.status === 'ok' && analysis.kind === 'manifest') errors.unshift({ path: '$', message: 'Aquí se edita un nodo { "type", "props", "children" }, no un manifest completo. Usa "Copiar manifest snippet" para obtener el manifest.' });
    const result: SimEvaluation = { status: errors.length ? 'invalid' : 'ok', errors, warnings: pick('warning'), deprecations: pick('deprecation'), bytes };
    if (!errors.length && analysis.kind === 'node') result.node = analysis.targets[0]?.node;
    if (!result.node && result.status === 'ok') result.status = 'invalid';
    return result;
}

// ------------------------------------------------------------------ contexto simulado
export const SIM_MOUNT_POINTS: string[] = ['PAGE', ...Object.keys(MOUNT_POINT_CONTEXT)];
export const TOOLBAR_POINTS = new Set(['EMAIL_TOOLBAR', 'COMPOSER_TOOLBAR', 'CALENDAR_TOOLBAR', 'CONTACTS_TOOLBAR']);
export type ToolbarMode = 'off' | 'compact' | 'menu';

const EMAIL_SAMPLE = {
    email: { id: 'msg-1', from: 'ana.garcia@example.com', to: 'yo@example.com', cc: '', subject: EXAMPLE_CONTEXT.subject, folder: 'INBOX', date: EXAMPLE_CONTEXT.date, isRead: false, labels: ['Trabajo'], hasAttachments: true },
    emailContent: EXAMPLE_CONTEXT.emailContent,
    fromContact: { email: 'ana.garcia@example.com', name: 'Ana Garcia', firstName: 'Ana', lastName: 'Garcia' },
    content: EXAMPLE_CONTEXT.emailContent,
};
const COMPOSER_SAMPLE = { emailContent: 'Hola Ana, gracias por tu mensaje.', subject: 'Re: Reunion de seguimiento', to: ['ana.garcia@example.com'], cc: [], bcc: [], sender: 'yo@example.com' };
const POINT_SAMPLES: Record<string, Record<string, any>> = {
    SIDEBAR_HEADER: { folder: 'INBOX', unreadCounts: { INBOX: 7 } }, SIDEBAR_FOOTER: { folder: 'INBOX', unreadCounts: { INBOX: 7 } }, SIDEBAR_PANEL: { folder: 'INBOX', unreadCounts: { INBOX: 7 } },
    CALENDAR_TOOLBAR: { range: { from: '2026-03-09T00:00:00.000Z', to: '2026-03-15T23:59:59.000Z' }, view: 'week', isGoogleLinked: true },
    CALENDAR_EVENT_PANEL: { event: { id: 'ev-1', title: 'Reunión de seguimiento', startsAt: '2026-03-12T10:00:00.000Z', endsAt: '2026-03-12T10:30:00.000Z', allDay: false, location: 'Sala 2', attendees: [{ email: 'ana.garcia@example.com', name: 'Ana Garcia', responseStatus: 'accepted' }] }, calendarId: 'cal-1', isReadOnly: false },
    CONTACTS_TOOLBAR: { contactCount: 128, isGoogleLinked: false, selectedIds: ['c-1', 'c-2'] },
    CONTACT_CARD_PANEL: { contact: { id: 'c-1', email: 'ana.garcia@example.com', name: 'Ana Garcia', notes: 'Cliente desde 2024', source: 'manual' } },
    SETTINGS_PANEL: { extensionId: 'my-extension', settings: { language: 'es' } },
};

/**
 * Contexto de ejemplo del punto de montaje. Siempre incluye EXAMPLE_CONTEXT (los ejemplos del esquema leen `context.subject`...) y,
 * en las barras de acciones, `toolbarButtonMode` (lo que fija la app para presentar los botones como iconos).
 */
export function simContext(point: string, toolbar: ToolbarMode = 'off'): Record<string, any> {
    const info = MOUNT_POINT_CONTEXT[point];
    let sample: Record<string, any> = {};
    if (POINT_SAMPLES[point]) sample = POINT_SAMPLES[point];
    else if (info?.surface === 'mail.reader' || info?.surface === 'mail.list') sample = EMAIL_SAMPLE;
    else if (info?.surface === 'mail.composer') sample = COMPOSER_SAMPLE;
    const context: Record<string, any> = { ...EXAMPLE_CONTEXT, ...sample, extensionId: 'my-extension', mountPoint: point };
    if (TOOLBAR_POINTS.has(point) && toolbar !== 'off') context.toolbarButtonMode = toolbar;
    return context;
}

// ------------------------------------------------------------------ backend simulado
export interface MockConfig { mode: 'success' | 'error'; resultText: string; errorText: string; delayMs: number }
export const DEFAULT_MOCK: MockConfig = { mode: 'success', resultText: '{ "ok": true, "items": [1, 2, 3] }', errorText: 'Servicio no disponible (simulado)', delayMs: 300 };

export interface MockParsed { mode: 'success' | 'error'; result: unknown; error: string; delayMs: number; resultError?: string }

export function parseMock(config: MockConfig): MockParsed {
    const parsed = parseJson(config.resultText || 'null');
    const delayMs = Math.min(Math.max(Number.isFinite(config.delayMs) ? config.delayMs : 0, 0), MAX_DELAY_MS);
    return { mode: config.mode, result: parsed.ok ? parsed.value : undefined, error: config.errorText || 'Error simulado', delayMs, ...(parsed.ok ? {} : { resultError: parsed.message }) };
}

export type SimBackendResponse = { success: boolean; result?: any; error?: string };

/** `callBackend` del simulador: NO hace red. Responde segun la configuracion vigente (exito o error) tras `delayMs`. */
export function createMockCaller(getConfig: () => MockParsed, onCall?: (call: { fn: string; params: unknown; response: SimBackendResponse }) => void) {
    return async (_extensionId: string, fn: string, params: any): Promise<SimBackendResponse> => {
        const cfg = getConfig();
        if (cfg.delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, cfg.delayMs));
        const response: SimBackendResponse = cfg.mode === 'error' ? { success: false, error: cfg.error } : { success: true, result: cfg.result };
        onCall?.({ fn, params, response });
        return response;
    };
}

// ------------------------------------------------------------------ registro de eventos
export type SimEventKind = 'interaction' | 'action' | 'backend' | 'composer';
export interface SimEvent {
    id: number;
    time: string;
    kind: SimEventKind;
    /** Accion (TOAST, CALL_BACKEND...), interaccion (click, change, submit) o funcion del backend. */
    name: string;
    /** Argumentos YA interpolados (`${...}` resueltos). */
    detail?: unknown;
    outcome?: 'ok' | 'error';
    depth?: number;
}

export function createSimLog(max = 200, now: () => Date = () => new Date()) {
    let counter = 0;
    return {
        make: (event: Omit<SimEvent, 'id' | 'time'>): SimEvent => ({ ...event, id: ++counter, time: formatTime(now()) }),
        append: (list: SimEvent[], event: SimEvent): SimEvent[] => { const next = [...list, event]; return next.length > max ? next.slice(next.length - max) : next; },
    };
}

/** Argumentos de una accion sin la clave `action` ni los encadenados (se registran como pasos propios). */
export function actionDetail(args: Record<string, any>): Record<string, unknown> {
    const { action: _a, onSuccess: _s, onError: _e, onConfirm: _c, onCancel: _x, actions: _l, ...rest } = args;
    void _a; void _s; void _e; void _c; void _x; void _l;
    return rest;
}

// ------------------------------------------------------------------ formulario generado del esquema
export type FieldKind = 'boolean' | 'enum' | 'number' | 'text' | 'json';
export interface FormField { name: string; kind: FieldKind; spec: PropSpec }

/** Tipo de control para cada prop de primer nivel del esquema. */
export function fieldKind(spec: PropSpec): FieldKind {
    switch (spec.k) {
        case 'boolean': return 'boolean';
        case 'enum': return 'enum';
        case 'number': return 'number';
        case 'text': case 'string': case 'name': case 'url': case 'icon': case 'color': case 'regex': return 'text';
        default: return 'json';
    }
}

export function formFields(props: Record<string, PropSpec>): FormField[] {
    return Object.entries(props).map(([name, spec]) => ({ name, kind: fieldKind(spec), spec }));
}

/** Texto que muestra el control para el valor actual de la prop. */
export function fieldText(value: unknown): string {
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Interpreta lo escrito en un control. `json`: JSON valido o, para `any`, el texto tal cual (p. ej. una expresion `${...}`). */
export function parseFieldInput(field: FormField, text: string): { ok: true; value: unknown } | { ok: false; message: string } {
    if (text === '') return { ok: true, value: undefined };
    // Una expresion `${...}` es valida donde se espera un numero o un booleano (se evalua en ejecucion).
    const isExpr = text.includes('${');
    if (field.kind === 'boolean') return text === 'true' ? { ok: true, value: true } : text === 'false' ? { ok: true, value: false } : { ok: true, value: text };
    if (field.kind === 'number') {
        const n = Number(text);
        if (Number.isFinite(n)) return { ok: true, value: n };
        return isExpr ? { ok: true, value: text } : { ok: false, message: 'No es un número' };
    }
    if (field.kind === 'enum') {
        const match = (field.spec.values ?? []).find((v) => String(v) === text);
        return match === undefined ? { ok: false, message: 'Valor no permitido' } : { ok: true, value: match };
    }
    if (field.kind === 'text') return { ok: true, value: text };
    const parsed = parseJson(text);
    if (parsed.ok) return { ok: true, value: parsed.value };
    if (field.spec.k === 'any') return { ok: true, value: text };
    return { ok: false, message: parsed.message };
}

/** Devuelve una copia del nodo con `props[name]` fijada (o eliminada si `value` es undefined). */
export function setNodeProp(node: Record<string, any>, name: string, value: unknown): Record<string, any> {
    const props: Record<string, any> = { ...(node.props ?? {}) };
    if (value === undefined) delete props[name]; else props[name] = value;
    const next: Record<string, any> = { ...node };
    if (Object.keys(props).length) next.props = props; else delete next.props;
    return next;
}

export const prettyJson = (value: unknown): string => JSON.stringify(value, null, 2);

// ------------------------------------------------------------------ localizar y editar el nodo del componente
/** Ruta (indices de `children`) hasta el primer nodo del tipo dado; `[]` = la raiz; undefined si no esta. */
export function findNodePath(node: any, type: string, path: number[] = []): number[] | undefined {
    if (!node || typeof node !== 'object') return undefined;
    if (node.type === type) return path;
    const children = Array.isArray(node.children) ? node.children : [];
    for (let i = 0; i < children.length; i++) {
        const hit = findNodePath(children[i], type, [...path, i]);
        if (hit) return hit;
    }
    return undefined;
}

export function nodeAt(node: any, path: number[]): Record<string, any> | undefined {
    let cur = node;
    for (const i of path) cur = cur?.children?.[i];
    return cur && typeof cur === 'object' ? cur : undefined;
}

/** Copia del arbol con el nodo de `path` reemplazado por `fn(nodo)`. */
export function updateAt(node: Record<string, any>, path: number[], fn: (n: Record<string, any>) => Record<string, any>): Record<string, any> {
    if (path.length === 0) return fn(node);
    const [head, ...rest] = path;
    const children = [...(node.children ?? [])];
    children[head] = updateAt(children[head], rest, fn);
    return { ...node, children };
}
