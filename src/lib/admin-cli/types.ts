/**
 * Tipos del motor de comandos de administracion (consola web + CLI por API).
 *
 * Un comando es DATOS: nombre, banderas tipadas, descripcion es/en, nivel de riesgo y un handler que reutiliza las
 * rutas/almacenes existentes del admin (ver bridge.ts). Cada handler devuelve salida ESTRUCTURADA (CmdOutput); el
 * render a texto/JSON vive aparte (render.ts) para que la web y el CLI muestren lo mismo.
 */

import type { LevelSource, PermissionLevel } from '../permissions-core';

export type Locale = 'es' | 'en';
export interface L10n { es: string; en: string }

/** read: solo lee. write: cambia datos reversibles. destructive: borra/revoca (confirmacion). security: credenciales/MFA/claves (step-up). */
export type Risk = 'read' | 'write' | 'destructive' | 'security';

/** Ambitos de un token de CLI. `write` incluye `read`; `security` incluye `write` y `read`. */
export type Scope = 'read' | 'write' | 'security';
export const SCOPES: readonly Scope[] = ['read', 'write', 'security'];

export type FlagType = 'string' | 'number' | 'boolean' | 'enum' | 'json' | 'list';

export interface FlagDef {
    name: string;
    alias?: string;
    type: FlagType;
    values?: readonly string[];
    description: L10n;
    required?: boolean;
    /** Su valor es un secreto: jamas se audita ni se muestra (se redacta). */
    secret?: boolean;
    /** Fuente de autocompletado dinamico. */
    complete?: CompleteSource;
    min?: number;
    max?: number;
}

export type CompleteSource = 'user' | 'extension' | 'command';

export interface PositionalDef {
    name: string;
    description: L10n;
    required?: boolean;
    variadic?: boolean;
    secret?: boolean;
    complete?: CompleteSource;
    type?: 'string' | 'number';
    values?: readonly string[];
}

export type Cell = string | number | boolean | null | undefined;
export interface TableColumn { key: string; label: string; align?: 'left' | 'right' }

/** Salida estructurada. `tone` usa tokens semanticos (nunca colores crudos): el render la traduce a clases del tema / ANSI. */
export type CmdOutput =
    | { type: 'text'; text: string; tone?: Tone }
    | { type: 'table'; columns: TableColumn[]; rows: Record<string, Cell>[]; caption?: string; total?: number }
    | { type: 'kv'; items: { key: string; value: Cell | Cell[]; tone?: Tone }[]; title?: string }
    | { type: 'json'; data: unknown }
    | { type: 'csv'; filename: string; text: string }
    | { type: 'list'; items: string[]; title?: string }
    | { type: 'multi'; parts: CmdOutput[] };

export type Tone = 'default' | 'muted' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export interface ParsedArgs {
    positionals: string[];
    flags: Record<string, unknown>;
}

export interface RouteCall {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    /** Ruta bajo /api/admin (empieza por "/"). */
    path: string;
    query?: Record<string, string | number | boolean | undefined | null>;
    body?: unknown;
    /** Cabeceras extra permitidas (solo x-chunk-sha256 en la subida de trozos). */
    headers?: Record<string, string>;
    /** Devuelve la Response cruda (descargas en flujo) en vez de leerla. */
    raw?: boolean;
}

export interface RouteResult { status: number; data: any; text?: string; headers: Record<string, string> }

/** Contexto que recibe un handler. */
export interface CmdContext {
    locale: Locale;
    /** Llama a la ruta REAL /api/admin/** en proceso (misma validacion, limites y auditoria que la consola). */
    call: (c: RouteCall) => Promise<RouteResult>;
    /** Igual que call pero lanza CmdError si el estado no es 2xx. */
    callOk: (c: RouteCall) => Promise<RouteResult>;
    actor: CliActor;
    /** Texto de entrada adicional (JSON pegado o leido de archivo/stdin por el cliente). */
    input?: string;
    ip: string;
    session: SessionInfo;
    source: 'web' | 'token';
    t: (l: L10n) => string;
    /** Llamada al backend compartido con la sesion de manager (solo lectura de /api/manager/domains y similares). */
    backend: (path: string) => Promise<{ status: number; data: any }>;
    /** Cookie de manager (SECRETA): solo para guardarla cifrada al emitir un token. Nunca se devuelve ni se audita. */
    managerSession?: string | null;
}

export interface SessionInfo {
    source: 'web' | 'token';
    scopes: Scope[];
    tokenId?: string | null;
    tokenName?: string | null;
    expiresAt?: string | null;
    domain?: string | null;
    /** Tope de nivel del token (nivel de la cuenta al emitirlo). */
    levelCap?: PermissionLevel;
    /** interactive (ocupa el slot de sesion privilegiada) | machine (automatizacion, solo lectura). */
    tokenClass?: 'interactive' | 'machine';
}

export interface CliActor {
    kind: 'manager' | 'user';
    id?: string;
    email?: string;
    /** permission_level efectivo (0..4) de quien ejecuta (token: min(tope del token, nivel actual de la cuenta)). */
    level: PermissionLevel;
    levelSource: LevelSource;
}

export type Handler = (a: { args: ParsedArgs; ctx: CmdContext }) => Promise<CmdOutput>;

export interface CommandDef {
    /** Palabras separadas por espacio: "users list". */
    name: string;
    summary: L10n;
    risk: Risk;
    positionals?: PositionalDef[];
    flags?: FlagDef[];
    /** Rutas /api/admin que este comando cubre ("GET /api/admin/users"): alimenta el test de cobertura. */
    covers?: string[];
    /** Solo administradores con sesion de manager (dueno del dominio): la ruta reenvia su cookie al backend. */
    managerOnly?: boolean;
    /** Exige que el step-up se haya hecho con un codigo MFA (usuarios de la app; las managers usan su contrasena). */
    mfaStepUp?: boolean;
    /** Admite texto adicional por `input` (JSON pegado / archivo / stdin). */
    acceptsInput?: boolean;
    examples?: string[];
    handler: Handler;
    /** Oculta del catalogo y del autocompletado. */
    hidden?: boolean;
}

export class CmdError extends Error {
    constructor(public code: string, message?: string, public exitCode = 1, public status?: number) {
        super(message ?? code);
        this.name = 'CmdError';
    }
}

export interface ExecResponse {
    ok: boolean;
    exitCode: number;
    command?: string;
    risk?: Risk;
    output?: CmdOutput;
    /** Texto ya renderizado (sin color) para clientes simples. */
    text?: string;
    /** Con --json: los datos en bruto (filas, objeto, etc.) listos para `JSON.stringify`. */
    json?: unknown;
    error?: { code: string; message: string };
    /** Falta confirmacion explicita (reintentar con confirm:true) o step-up (POST /api/admin/cli/reauth). */
    needs?: 'confirm' | 'stepup';
    durationMs?: number;
}
