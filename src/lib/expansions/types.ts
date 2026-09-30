// Tipos del manifest de extensiones tal como los consume el frontend.
// El vocabulario valido (puntos de montaje, componentes, acciones, permisos) y la validacion viven en
// ./manifest-schema.ts, que es copia de bloomx-extensions/_shared/manifest-schema.ts (fuente canonica).

export type MountPoint = string; // ver KNOWN_MOUNT_POINTS
export type ComponentType = string; // ver KNOWN_COMPONENT_TYPES

export type ExtensionActionName =
    | 'SET_STATE' | 'MERGE_STATE' | 'MAP_ARRAY' | 'FILTER_ARRAY' | 'SET_LOADING'
    | 'OPEN_OVERLAY' | 'CLOSE_OVERLAY' | 'OPEN_URL' | 'NAVIGATE' | 'REFRESH' | 'DELAY' | 'CONFIRM'
    | 'CALL_BACKEND' | 'CALL_API' | 'TOAST' | 'COPY_TO_CLIPBOARD'
    | 'INSERT_CONTENT' | 'APPEND_BODY' | 'SET_SUBJECT' | 'ADD_ATTACHMENT' | 'SET_CONTEXT_VALUE'
    | 'NEXT_STEP' | 'PREV_STEP'
    | 'SECURE_SAVE' | 'SECURE_READ'
    | 'OAUTH_CONNECT' | 'OAUTH_DISCONNECT';

export interface ExtensionAction {
    action: ExtensionActionName;
    function?: string; // CALL_BACKEND: clave de api.functions
    targetId?: string; // OPEN_OVERLAY
    message?: string; // TOAST
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    params?: any;
    /** CALL_BACKEND: args explicitos; si se dispara desde un FORM, formData se completa solo. */
    args?: any;
    key?: string;
    value?: any;
    emitEvent?: string;
    /** CALL_BACKEND/CALL_API: reintento declarativo (max 5 intentos). */
    retry?: { attempts?: number; delayMs?: number; backoff?: 'none' | 'linear' | 'exponential' };
    /** CALL_BACKEND/CALL_API: guarda el resultado en state[resultKey]. */
    resultKey?: string;
    /** false = no mostrar aviso cuando falla y no hay onError. */
    toastOnError?: boolean;
    onSuccess?: ExtensionAction | ExtensionAction[] | { actions: ExtensionAction[] };
    onError?: ExtensionAction | ExtensionAction[] | { actions: ExtensionAction[] };
    [extra: string]: any;
}

export interface ExtensionComponent {
    type: ComponentType;
    props?: Record<string, any>; // strings con ${expresion}: ver expressions.ts
    children?: ExtensionComponent[];
}

export interface ExtensionMount {
    point: MountPoint;
    id?: string; // OVERLAY
    component?: ExtensionComponent;
    handler?: string; // ON_*_HANDLER: nombre en api.functions
    priority?: 'HIGH' | 'NORMAL' | 'LOW' | 'MONITOR' | number;
}

export interface ExtensionIntercept {
    point: 'EMAIL_PRE_SEND' | 'EMAIL_RECEIVED' | 'CRON'
        | 'EMAIL_OPENED' | 'EMAIL_SENT' | 'COMPOSE_OPENED'
        | 'CALENDAR_EVENT_CREATED' | 'CALENDAR_EVENT_UPDATED' | 'CALENDAR_EVENT_CANCELLED'
        | 'CONTACT_SAVED' | 'CONTACT_DELETED' | 'APPOINTMENT_BOOKED';
    handler: string;
    priority?: 'HIGH' | 'NORMAL' | 'LOW' | 'MONITOR' | number;
    /** EMAIL_PRE_SEND: "block" impide el envio si el handler falla (p.ej. DLP). */
    onError?: 'block' | 'continue';
    /** CRON: cada cuanto corre (el planificador del operador llama con el mismo valor). */
    schedule?: 'hourly' | 'daily';
}

export interface ExtensionManifest {
    manifestVersion?: string;
    id: string;
    name: string;
    description?: string;
    version: string;
    status?: 'active' | 'disabled';
    permissions?: string[];
    auth?: { type?: string; provider?: string; scopes?: string[] };
    api?: { runtime?: 'nodejs'; entry?: string; functions?: Record<string, { handler: string; timeout?: number }> };
    mounts?: ExtensionMount[];
    intercepts?: ExtensionIntercept[];
    /** Alias de `intercepts` (misma forma). */
    hooks?: ExtensionIntercept[];
    /** Estado inicial de cada mount/overlay (`${state.x}`); objeto pequeno (max 50 KB). */
    state?: Record<string, any>;
    /** Pagina /extensions: categoria, etiquetas de busqueda, capturas (URLs https) e historial de versiones. */
    category?: string;
    tags?: string[];
    screenshots?: string[];
    changelog?: Array<{ version: string; date?: string; notes?: string }>;
}
