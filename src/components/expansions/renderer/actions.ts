/**
 * Motor de ACCIONES de las extensiones (CALL_BACKEND, SET_STATE, TOAST, OPEN_OVERLAY, NEXT_STEP, ...).
 *
 * Sin React: recibe un `env` con los efectos (estado, toast, router, overlays...) y devuelve `run(actionDef, event, extra)`.
 * Es testeable de forma aislada (ver renderer/__tests__/actions.test.ts). Catalogo y campos de cada accion:
 * UI_ACTIONS en src/lib/expansions/ui-schema.ts.
 *
 * Convenciones (consistentes en todas las acciones):
 *  - Una accion es `{action: "NOMBRE", ...}`, un arreglo de acciones o `{actions: [...]}` (se ejecutan EN ORDEN).
 *  - Los strings con `${...}` se resuelven justo antes de ejecutar cada paso con el estado vigente (un SET_STATE
 *    anterior de la misma cadena ya es visible) y con `result`/`value`/`formData`/`row`/`error` del evento.
 *  - Las que pueden fallar (CALL_BACKEND, CALL_API, SECURE_*, OAUTH_DISCONNECT) admiten `onSuccess` / `onError`; sin
 *    onError muestran un aviso con el motivo. CALL_BACKEND/CALL_API mantienen solos `state.$loading[clave]` y
 *    `state.$error[clave]`, admiten `retry` (attempts, delayMs, backoff) y `resultKey` (guarda el resultado en state).
 *  - `run` devuelve un ActionOutcome {ok, error?, handled?, result?}: un FORM lo usa para mostrar cargando/error/exito.
 *  - Un error inesperado dentro de una accion se captura, se registra para el autor y NO interrumpe la cadena.
 */
import { toast } from 'sonner';
import { LAZY_KEYS, resolveDeep, resolveTemplate } from '@/lib/expansions/expressions';
import { safeHref, safeInternalPath } from '@/lib/expansions/safe-url';
import { toBackendContext } from '@/lib/expansions/context';
import { executeExtensionAction } from '@/lib/expansions/api';
import { secureRead, secureWrite } from '@/lib/expansions/client/secure-storage';
import { reportExtensionError } from '@/lib/expansions/client/error-log';
import { UI_ACTION_TYPES, suggest } from '@/lib/expansions/ui-schema';
import { getPath } from './state';

export interface ActionOutcome {
    ok: boolean;
    /** Mensaje del primer fallo. */
    error?: string;
    /** true si el autor lo trata con `onError` (el formulario no muestra su propio aviso). */
    handled?: boolean;
    /** Resultado del ultimo CALL_BACKEND/CALL_API. */
    result?: unknown;
}

export interface OverlayRequest {
    component: any;
    context: Record<string, any>;
    width?: string;
    /** 'drawer' si la raiz del overlay es un DRAWER. */
    kind: 'modal' | 'drawer';
    label: string;
}

/** Sustituto de `executeExtensionAction` (playground/vista previa: respuestas simuladas, nunca el backend real). */
export type BackendCaller = (extensionId: string, fn: string, params: any, context: Record<string, any>) => Promise<{ success: boolean; result?: any; error?: string }>;

export interface ActionEnv {
    /** Si existe, CALL_BACKEND lo usa en lugar de llamar al backend real. */
    callBackend?: BackendCaller;
    /** Contexto del mount (correo abierto, composer, extensionId, overlays...). */
    context: Record<string, any>;
    getState: () => Record<string, any>;
    setState: (key: string, value: any) => void;
    wizard: { next: () => void; prev: () => void } | null;
    router: { push: (path: string) => void; refresh: () => void };
    userId: string | null;
    /** Abre un overlay en el anfitrion (ExpansionUI o el dialogo propio del renderer). */
    showOverlay: (request: OverlayRequest) => void;
    closeOverlay: () => void;
    /** Confirmacion accesible; por defecto window.confirm. */
    confirm?: (message: string) => Promise<boolean>;
    /** Observador (docs/playground): recibe CADA paso con sus argumentos ya interpolados, justo antes de ejecutarlo. */
    onAction?: (step: ActionStep) => void;
    /**
     * Simulacion (docs): los efectos externos (aviso, navegacion, URL, portapapeles, OAuth, almacenamiento seguro, composer)
     * NO se ejecutan y CALL_API se trata como CALL_BACKEND (`callBackend`). SET_STATE, overlays, CONFIRM, CALL_BACKEND... si.
     */
    dryRun?: boolean;
}

/** Un paso de accion tal como se ejecuta: nombre y argumentos ya resueltos (`${...}` interpolado). */
export interface ActionStep { action: string; args: Record<string, any>; depth: number }

/** Acciones con efecto fuera del renderer: en `dryRun` solo se registran. */
const DRY_RUN_NOOP = new Set(['TOAST', 'OPEN_URL', 'NAVIGATE', 'REFRESH', 'COPY_TO_CLIPBOARD', 'OAUTH_CONNECT', 'OAUTH_DISCONNECT', 'INSERT_CONTENT', 'APPEND_BODY', 'SET_SUBJECT', 'ADD_ATTACHMENT', 'SET_CONTEXT_VALUE', 'SECURE_SAVE', 'SECURE_READ']);

export type ActionRunner = (actionDef: any, event?: any, extra?: Record<string, any>) => Promise<ActionOutcome>;

const MAX_ACTIONS_PER_CHAIN = 100;
const MAX_DEPTH = 30;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RetryConfig { attempts?: number; delayMs?: number; backoff?: 'none' | 'linear' | 'exponential' }

/** Ejecuta `fn` con reintento declarativo (max 5 intentos, espera max 10 s). Relanza el ultimo error. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, retry?: RetryConfig): Promise<T> {
    const attempts = Math.max(1, Math.min(5, Math.floor(Number(retry?.attempts) || 1)));
    const base = Math.max(0, Math.min(10_000, Number(retry?.delayMs ?? 500) || 0));
    const backoff = retry?.backoff ?? 'exponential';
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn(attempt);
        } catch (error) {
            lastError = error;
            if (attempt < attempts) {
                const factor = backoff === 'exponential' ? 2 ** (attempt - 1) : backoff === 'linear' ? attempt : 1;
                await sleep(Math.min(10_000, base * factor));
            }
        }
    }
    throw lastError;
}

function messageOf(error: unknown, fallback: string): string {
    const text = error && typeof error === 'object' && 'message' in error ? String((error as any).message) : typeof error === 'string' ? error : '';
    return text || fallback;
}

/** Clave de carga/error de una accion de red (por defecto el nombre de la funcion o la ruta). */
export function loadingKeyOf(act: any): string | null {
    if (!act || typeof act !== 'object') return null;
    if (act.action === 'CALL_BACKEND') return typeof act.key === 'string' && act.key ? act.key : typeof act.function === 'string' ? act.function : null;
    if (act.action === 'CALL_API') return typeof act.key === 'string' && act.key ? act.key : typeof act.url === 'string' ? act.url.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || null : null;
    return null;
}

/** Primera accion de red de una definicion (para que un BUTTON muestre solo su estado de carga). */
export function primaryLoadingKey(actionDef: any, depth = 0): string | null {
    if (!actionDef || depth > 4) return null;
    if (Array.isArray(actionDef)) {
        for (const item of actionDef) { const key = primaryLoadingKey(item, depth + 1); if (key) return key; }
        return null;
    }
    if (typeof actionDef !== 'object') return null;
    if (Array.isArray(actionDef.actions)) return primaryLoadingKey(actionDef.actions, depth + 1);
    return loadingKeyOf(actionDef);
}

export function normalizeActionList(actionDef: any): any[] {
    if (!actionDef) return [];
    if (Array.isArray(actionDef)) return actionDef;
    if (Array.isArray(actionDef.actions)) return actionDef.actions;
    return [actionDef];
}

/** Crea el ejecutor. `getEnv` se llama en cada accion: siempre ve el contexto/estado mas reciente. */
export function createActionRunner(getEnv: () => ActionEnv): ActionRunner {
    const run = async (actionDef: any, event?: any, extra: Record<string, any> = {}, depth = 0): Promise<ActionOutcome> => {
        const outcome: ActionOutcome = { ok: true };
        if (!actionDef) return outcome;
        if (depth > MAX_DEPTH) {
            const error = 'Acciones encadenadas demasiado anidadas';
            console.error(`[Extensions] ${error}`);
            return { ok: false, error };
        }

        const actions = normalizeActionList(actionDef).slice(0, MAX_ACTIONS_PER_CHAIN);
        for (const act of actions) {
            if (!act || typeof act !== 'object') continue;
            const env = getEnv();
            const step = await runOne(env, act, event, extra, depth, run);
            if (!step.ok && outcome.ok) { outcome.ok = false; outcome.error = step.error; outcome.handled = step.handled; }
            if (step.result !== undefined) outcome.result = step.result;
        }
        return outcome;
    };
    return (actionDef, event, extra) => run(actionDef, event, extra ?? {}, 0);
}

type Runner = (actionDef: any, event?: any, extra?: Record<string, any>, depth?: number) => Promise<ActionOutcome>;

async function runOne(env: ActionEnv, act: any, event: any, extra: Record<string, any>, depth: number, run: Runner): Promise<ActionOutcome> {
    const scopeContext = { ...env.context, ...extra };
    const state = env.getState();
    let resolved: any = resolveDeep(act, { ctx: scopeContext, state }, LAZY_KEYS);
    const extensionId = String(scopeContext.extensionId || 'desconocida');
    const chain = (def: any, more: Record<string, any> = {}) => run(def, event, { ...extra, ...more }, depth + 1);
    const setFlag = (group: '$loading' | '$error', key: string | null, value: unknown) => { if (key) env.setState(`${group}.${key}`, value); };

    // `actions` anidadas dentro de un paso
    if (Array.isArray(resolved?.actions) && !resolved.action) return chain(act.actions);

    if (env.onAction && resolved && typeof resolved === 'object') env.onAction({ action: String(resolved.action ?? ''), args: resolved, depth });
    if (env.dryRun) {
        if (resolved?.action === 'CALL_API') {
            const method = String(resolved.method || 'GET').toUpperCase();
            resolved = { ...resolved, action: 'CALL_BACKEND', function: `${method} ${String(resolved.url ?? '')}`, key: loadingKeyOf(resolved) ?? undefined, args: resolved.body ?? resolved.args ?? resolved.params };
        } else if (DRY_RUN_NOOP.has(resolved?.action)) {
            const nested = act.onSuccess && (resolved.action === 'SECURE_SAVE' || resolved.action === 'SECURE_READ' || resolved.action === 'OAUTH_DISCONNECT') ? await chain(act.onSuccess, {}) : { ok: true };
            return { ok: nested.ok, error: nested.error, handled: nested.handled };
        }
    }

    try {
        switch (resolved.action) {
            case 'SET_STATE':
                if (!resolved.key) { toast.error('SET_STATE requiere `key`'); return fail('SET_STATE requiere `key`'); }
                env.setState(String(resolved.key), resolved.value);
                return { ok: true };

            case 'MERGE_STATE': {
                const existing = getPath(env.getState(), resolved.key);
                const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
                env.setState(String(resolved.key), { ...base, ...(resolved.value && typeof resolved.value === 'object' ? resolved.value : {}) });
                return { ok: true };
            }

            case 'SET_LOADING':
                setFlag('$loading', String(resolved.key || ''), resolved.value ?? true);
                return { ok: true };

            case 'MAP_ARRAY': {
                const source = getPath(env.getState(), resolved.source);
                if (Array.isArray(source)) {
                    const mapped = source.map((item: any) => resolveDeep(act.template, { ctx: { ...scopeContext, item }, state: env.getState() }, LAZY_KEYS));
                    env.setState(String(resolved.target || resolved.source), mapped);
                }
                return { ok: true };
            }

            case 'FILTER_ARRAY': {
                const source = getPath(env.getState(), resolved.source);
                if (Array.isArray(source)) {
                    const filtered = source.filter((item: any) => {
                        const scope = { ctx: { ...scopeContext, item }, state: env.getState() };
                        return typeof act.condition === 'string' ? Boolean(resolveTemplate(act.condition, scope)) : Boolean(act.condition);
                    });
                    env.setState(String(resolved.target || resolved.source), filtered);
                }
                return { ok: true };
            }

            case 'OPEN_OVERLAY': {
                const targetId = resolved.targetId;
                const overlays = resolved.overlays || scopeContext.overlays || env.context.overlays;
                const ownerId = resolved.extensionId || scopeContext.extensionId || env.context.extensionId;
                const def = overlays?.[targetId];
                if (!def) {
                    console.warn(`[Extensions] Overlay "${targetId}" no existe en el manifest de ${ownerId}`);
                    reportExtensionError({ extensionId: String(ownerId || extensionId), kind: 'action', message: `OPEN_OVERLAY: el overlay "${targetId}" no existe en overlays ni en mounts OVERLAY` });
                    toast.error(`No se encontro el panel "${targetId ?? ''}"`);
                    return fail(`Overlay ${targetId} no encontrado`);
                }
                const component = normalizeOverlayDef(def);
                env.showOverlay({
                    component,
                    context: { ...scopeContext, extensionId: ownerId, overlays, toolbarButtonMode: undefined },
                    width: typeof component?.props?.width === 'string' ? component.props.width : undefined,
                    kind: component?.type === 'DRAWER' ? 'drawer' : 'modal',
                    label: typeof component?.props?.title === 'string' ? component.props.title : String(ownerId || ''),
                });
                return { ok: true };
            }

            case 'CLOSE_OVERLAY':
                env.closeOverlay();
                return { ok: true };

            case 'OAUTH_CONNECT': {
                const provider = String(resolved.provider || '');
                if (!/^[a-z0-9_-]{1,32}$/i.test(provider)) { toast.error('Proveedor OAuth no valido'); return fail('Proveedor OAuth no valido'); }
                const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                // Solo rutas internas: una URL del manifest no puede sacar al usuario a otro sitio.
                window.location.href = safeInternalPath(resolved.url) || `/api/auth/${provider}?returnTo=${encodeURIComponent(returnTo)}`;
                return { ok: true };
            }

            case 'OAUTH_DISCONNECT': {
                const provider = String(resolved.provider || '');
                if (!/^[a-z0-9_-]{1,32}$/i.test(provider)) { toast.error('Proveedor OAuth no valido'); return fail('Proveedor OAuth no valido'); }
                try {
                    const res = await fetch(`/api/auth/oauth/${provider}/disconnect`, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ extensionId: env.context.extensionId }),
                    });
                    if (!res.ok) throw new Error(`No se pudo desconectar (${res.status})`);
                    toast.success('Desconectado');
                    if (act.onSuccess) await chain(act.onSuccess);
                    return { ok: true };
                } catch (error) {
                    return handleFailure(error, 'No se pudo desconectar');
                }
            }

            case 'COPY_TO_CLIPBOARD':
                try {
                    await navigator.clipboard.writeText(String(resolved.text ?? ''));
                    toast.success(resolved.successMessage || 'Copiado');
                    return { ok: true };
                } catch {
                    toast.error('No se pudo copiar');
                    return fail('No se pudo copiar');
                }

            case 'OPEN_URL': {
                const href = safeHref(resolved.url);
                if (!href) { toast.error('Enlace bloqueado: solo se permiten https, http, mailto y tel'); return fail('Enlace bloqueado'); }
                window.open(href, '_blank', 'noopener,noreferrer');
                return { ok: true };
            }

            case 'NAVIGATE': {
                const path = safeInternalPath(resolved.path);
                if (!path) { toast.error('Navegacion bloqueada: solo rutas internas que empiecen por /'); return fail('Navegacion bloqueada'); }
                env.router.push(path);
                return { ok: true };
            }

            case 'REFRESH':
                env.router.refresh();
                return { ok: true };

            case 'DELAY':
                await sleep(Math.min(Math.max(Number(resolved.ms) || 1000, 0), 10_000));
                return { ok: true };

            case 'CALL_BACKEND': {
                const key = loadingKeyOf(resolved);
                if (typeof resolved.function !== 'string' || !resolved.function) { toast.error('CALL_BACKEND requiere `function`'); return fail('CALL_BACKEND requiere `function`'); }
                // args explicitos ganan; el formData del formulario que disparo la accion se completa solo.
                const explicit = resolved.args ?? resolved.params;
                const formData = extra?.formData && typeof extra.formData === 'object' ? extra.formData : null;
                const params = formData && (explicit === undefined || (explicit && typeof explicit === 'object' && !Array.isArray(explicit)))
                    ? { ...formData, ...(explicit || {}) }
                    : explicit;
                setFlag('$loading', key, true);
                setFlag('$error', key, null);
                let result: any;
                try {
                    result = await withRetry(async () => {
                        const call: BackendCaller = env.callBackend ?? executeExtensionAction;
                        const response = await call(String(scopeContext.extensionId), resolved.function, params, toBackendContext(env.context));
                        if (!response.success) throw new Error(response.error || 'La solicitud fallo');
                        return response.result;
                    }, resolved.retry);
                } catch (error) {
                    const message = messageOf(error, 'La accion fallo');
                    if (!env.dryRun) console.error('[Extensions] CALL_BACKEND fallo', resolved.function, message);
                    setFlag('$error', key, message);
                    setFlag('$loading', key, false);
                    if (!env.dryRun) reportExtensionError({ extensionId, kind: 'action', message: `${resolved.function}: ${message}` });
                    return handleFailure(error, 'La accion fallo', resolved.toastOnError !== false);
                }
                setFlag('$loading', key, false);
                if (resolved.resultKey) env.setState(String(resolved.resultKey), result);
                const nested = act.onSuccess ? await chain(act.onSuccess, { result }) : { ok: true };
                return { ok: nested.ok, error: nested.error, handled: nested.handled, result };
            }

            case 'CALL_API': {
                const key = loadingKeyOf(resolved);
                const url = safeInternalPath(resolved.url);
                if (!url) { toast.error('URL de API bloqueada: solo rutas del propio origen (/api/...)'); return fail('URL de API bloqueada'); }
                const method = String(resolved.method || 'GET').toUpperCase();
                const headers: Record<string, string> = { ...(resolved.headers || {}) };
                const body = resolved.body ?? resolved.args ?? resolved.params;
                const init: RequestInit = { method, headers };
                if (body !== undefined && method !== 'GET') {
                    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
                    init.body = headers['Content-Type'] === 'application/json' ? JSON.stringify(body) : body;
                }
                setFlag('$loading', key, true);
                setFlag('$error', key, null);
                let result: any;
                try {
                    result = await withRetry(async () => {
                        const response = await fetch(url, init);
                        const contentType = response.headers.get('content-type') || '';
                        const data = contentType.includes('application/json') ? await response.json() : await response.text();
                        if (!response.ok) {
                            throw new Error(typeof data === 'object' && data !== null && 'error' in data ? String((data as any).error) : `La solicitud fallo (${response.status})`);
                        }
                        return data;
                    }, resolved.retry);
                } catch (error) {
                    const message = messageOf(error, 'La solicitud fallo');
                    setFlag('$error', key, message);
                    setFlag('$loading', key, false);
                    reportExtensionError({ extensionId, kind: 'action', message: `CALL_API ${url}: ${message}` });
                    return handleFailure(error, 'La solicitud fallo', resolved.toastOnError !== false);
                }
                setFlag('$loading', key, false);
                if (resolved.emitEvent && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(String(resolved.emitEvent), { detail: result }));
                if (resolved.resultKey) env.setState(String(resolved.resultKey), result);
                const nested = act.onSuccess ? await chain(act.onSuccess, { result }) : { ok: true };
                return { ok: nested.ok, error: nested.error, handled: nested.handled, result };
            }

            case 'TOAST': {
                const kind = resolved.variant ?? (resolved.tone === 'danger' ? 'error' : resolved.tone);
                const message = String(resolved.message ?? '');
                if (kind === 'error') toast.error(message);
                else if (kind === 'success') toast.success(message);
                else if (kind === 'warning' && typeof (toast as any).warning === 'function') (toast as any).warning(message);
                else toast(message);
                return { ok: true };
            }

            case 'SET_SUBJECT': {
                const next = resolved.subject ?? resolved.value;
                const current = typeof env.context.subject === 'string' ? env.context.subject.trim() : '';
                if (next && env.context.setSubject && (!resolved.ifEmpty || !current)) await env.context.setSubject(next);
                return { ok: true };
            }

            case 'ADD_ATTACHMENT': {
                const attachment = resolved.attachment || resolved;
                if (attachment?.url && env.context.addAttachment) {
                    env.context.addAttachment(attachment);
                } else if (attachment?.contentBase64 && env.context.addAttachment) {
                    const bytes = Uint8Array.from(atob(attachment.contentBase64), (c) => c.charCodeAt(0));
                    env.context.addAttachment({
                        ...attachment,
                        filename: attachment.filename || 'attachment.bin',
                        mimeType: attachment.mimeType || 'application/octet-stream',
                        contentBase64: attachment.contentBase64,
                        size: attachment.size || bytes.byteLength,
                    });
                } else {
                    toast.error('Adjunto no valido: falta url o contentBase64 (o no hay composer abierto)');
                    return fail('Adjunto no valido');
                }
                return { ok: true };
            }

            case 'INSERT_CONTENT':
                if (env.context.insertBody) env.context.insertBody(resolved.content);
                else { toast.error('No se puede insertar: no hay un editor abierto'); return fail('Sin editor'); }
                if (resolved.closeOverlay) env.closeOverlay();
                return { ok: true };

            case 'APPEND_BODY': {
                const content = typeof resolved.content === 'string' ? resolved.content : typeof resolved.content?.content === 'string' ? resolved.content.content : '';
                if (env.context.appendBody) env.context.appendBody(content);
                else { toast.error('No se puede anadir: no hay un composer abierto'); return fail('Sin composer'); }
                if (resolved.closeOverlay) env.closeOverlay();
                return { ok: true };
            }

            case 'SET_CONTEXT_VALUE': {
                const key = resolved.key;
                if (key && typeof env.context?.[key] === 'function') { env.context[key](resolved.value); return { ok: true }; }
                toast.error(`El setter "${key}" no esta disponible aqui`);
                return fail(`Setter ${key} no disponible`);
            }

            case 'NEXT_STEP':
                env.wizard?.next();
                return { ok: true };

            case 'PREV_STEP':
                env.wizard?.prev();
                return { ok: true };

            case 'SECURE_SAVE':
                try {
                    if (!env.userId) throw new Error('Inicia sesion para guardar este dato');
                    await secureWrite(resolved.key, resolved.value, env.userId);
                    if (act.onSuccess) await chain(act.onSuccess);
                    return { ok: true };
                } catch (error) {
                    const message = messageOf(error, 'No se pudo guardar');
                    return handleFailure(new Error(message === 'SECURE_STORAGE_UNAVAILABLE' ? 'El almacenamiento seguro no esta disponible en este navegador' : message), 'No se pudo guardar');
                }

            case 'SECURE_READ':
                try {
                    // Sin sesion no hay clave: se trata como "sin dato" (no como un usuario generico compartido)
                    const value = env.userId ? await secureRead(resolved.key, env.userId) : null;
                    if (resolved.targetState) env.setState(String(resolved.targetState), value);
                    if (act.onSuccess) await chain(act.onSuccess, { value });
                    return { ok: true, result: value };
                } catch (error) {
                    console.error('[Extensions] SECURE_READ fallo', messageOf(error, ''));
                    if (act.onError) { await chain(act.onError, { error: messageOf(error, 'No se pudo leer') }); return { ok: false, error: messageOf(error, 'No se pudo leer'), handled: true }; }
                    return fail(messageOf(error, 'No se pudo leer'));
                }

            case 'CONFIRM': {
                const message = String(resolved.message || 'Seguro?');
                const confirmed = env.confirm ? await env.confirm(message) : window.confirm(message);
                if (confirmed && act.onConfirm) return chain(act.onConfirm);
                if (!confirmed && act.onCancel) return chain(act.onCancel);
                return { ok: true };
            }

            default: {
                const name = String(resolved.action ?? '');
                const near = suggest(name, UI_ACTION_TYPES);
                const message = `Accion desconocida "${name}"${near ? ` (¿quisiste decir ${near}?)` : ''}`;
                console.warn(`[Extensions] ${message}`);
                reportExtensionError({ extensionId, kind: 'action', message });
                return fail(message);
            }
        }
    } catch (error) {
        const message = messageOf(error, 'Error inesperado en la accion');
        console.error('[Extensions] Error en la accion', resolved?.action, message);
        reportExtensionError({ extensionId, kind: 'action', message: `${resolved?.action}: ${message}` });
        return fail(message);
    }

    function fail(message: string): ActionOutcome {
        return { ok: false, error: message };
    }

    /** Fallo de una accion con `onError`: lo encadena; si no hay, avisa con un toast (salvo toastOnError=false). */
    async function handleFailure(error: unknown, fallback: string, toastOnError = true): Promise<ActionOutcome> {
        const message = messageOf(error, fallback);
        if (act.onError) {
            await chain(act.onError, { error: message });
            return { ok: false, error: message, handled: true };
        }
        if (toastOnError) toast.error(message);
        return { ok: false, error: message, handled: false };
    }
}

/** Los OVERLAY del manifest pueden venir en la forma heredada `component: "MODAL"` + `props`. */
export function normalizeOverlayDef(overlay: any): any {
    if (overlay && typeof overlay === 'object' && typeof overlay.type === 'string') return overlay;
    const component = overlay?.component ?? overlay;
    if (typeof component === 'string') {
        const { children, ...props } = overlay?.props && typeof overlay.props === 'object' ? overlay.props : ({} as Record<string, any>);
        return { type: component, props, ...(Array.isArray(children) ? { children } : {}) };
    }
    return component;
}
