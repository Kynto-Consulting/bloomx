import {
    CmdError, type Cell, type CmdContext, type CmdOutput, type CommandDef, type FlagDef, type L10n, type PositionalDef, type TableColumn, type Tone,
} from '../types';

/** Ayudantes para declarar comandos de forma compacta. */

export const L = (es: string, en: string): L10n => ({ es, en });

export const str = (name: string, es: string, en: string, o: Partial<FlagDef> = {}): FlagDef => ({ name, type: 'string', description: L(es, en), ...o });
export const num = (name: string, es: string, en: string, o: Partial<FlagDef> = {}): FlagDef => ({ name, type: 'number', description: L(es, en), ...o });
export const bool = (name: string, es: string, en: string, o: Partial<FlagDef> = {}): FlagDef => ({ name, type: 'boolean', description: L(es, en), ...o });
export const oneOf = (name: string, values: readonly string[], es: string, en: string, o: Partial<FlagDef> = {}): FlagDef => ({ name, type: 'enum', values, description: L(es, en), ...o });
export const json = (name: string, es: string, en: string, o: Partial<FlagDef> = {}): FlagDef => ({ name, type: 'json', description: L(es, en), ...o });
export const list = (name: string, es: string, en: string, o: Partial<FlagDef> = {}): FlagDef => ({ name, type: 'list', description: L(es, en), ...o });

export const pos = (name: string, es: string, en: string, o: Partial<PositionalDef> = {}): PositionalDef => ({ name, description: L(es, en), required: true, ...o });
export const USER_POS = pos('user', 'Id o correo del usuario', 'User id or email', { complete: 'user' });

/** Banderas de paginacion y orden comunes. */
export const PAGING: FlagDef[] = [
    num('page', 'Pagina (desde 1)', 'Page (from 1)', { min: 1 }),
    num('page-size', 'Filas por pagina (max 100)', 'Rows per page (max 100)', { min: 1, max: 100 }),
];

export const text = (s: string, tone?: Tone): CmdOutput => ({ type: 'text', text: s, tone });
export const data = (d: unknown): CmdOutput => ({ type: 'json', data: d });
export const kv = (items: Array<[string, Cell | Cell[], Tone?]>, title?: string): CmdOutput => ({ type: 'kv', title, items: items.map(([key, value, tone]) => ({ key, value, tone })) });
export const table = (columns: Array<string | TableColumn>, rows: Record<string, Cell>[], extra: { caption?: string; total?: number } = {}): CmdOutput => ({
    type: 'table',
    columns: columns.map((c) => (typeof c === 'string' ? { key: c, label: c } : c)),
    rows,
    ...extra,
});
export const multi = (...parts: CmdOutput[]): CmdOutput => ({ type: 'multi', parts });

export const done = (ctx: CmdContext, es: string, en: string): CmdOutput => text(ctx.t(L(es, en)), 'success');

export const iso = (v: unknown): string => (typeof v === 'string' ? v.replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '');

/** Convierte `--page`/`--page-size` en la query de las rutas. */
export function pagingQuery(flags: Record<string, unknown>): Record<string, string | number | undefined> {
    return { page: flags.page as number | undefined, pageSize: flags['page-size'] as number | undefined };
}

export function pageNote(page: { page?: number; pages?: number; total?: number } | undefined): { total?: number } {
    return page?.total !== undefined ? { total: page.total } : {};
}

/** Id de usuario a partir de id o correo (`me` = el propio administrador). Usa la busqueda real del admin. */
export async function resolveUserId(ctx: CmdContext, ref: string): Promise<string> {
    const r = ref.trim();
    if (r === 'me') {
        if (ctx.actor.kind === 'user' && ctx.actor.id) return ctx.actor.id;
        throw new CmdError('not_available_for_manager', ctx.t(L('Una cuenta manager no tiene usuario de la app.', 'A manager account has no app user.')));
    }
    if (!r.includes('@')) return r;
    if (r.length < 3) throw new CmdError('user_not_found', 'user_not_found');
    const res = await ctx.callOk({ method: 'GET', path: '/search', query: { q: r } });
    const hit = (res.data?.users as Array<{ id: string; email: string }> | undefined)?.find((u) => u.email.toLowerCase() === r.toLowerCase());
    if (!hit) throw new CmdError('user_not_found', ctx.t(L(`No existe el usuario ${r}.`, `User ${r} not found.`)), 1, 404);
    return hit.id;
}

export function requireManager(ctx: CmdContext): void {
    if (ctx.actor.kind !== 'manager') {
        throw new CmdError('manager_session_required', ctx.t(L(
            'Este comando requiere una cuenta manager dueña del dominio (la cuenta de administrador de la app no tiene sesión en el backend compartido).',
            'This command needs a manager account that owns the domain (an app admin account has no session on the shared backend).',
        )), 1, 403);
    }
}

/** Id del Domain de ESTA instancia (nunca se acepta uno distinto por bandera). */
export async function instanceDomainId(): Promise<string> {
    const { resolveInstanceDomainId } = await import('@/lib/admin/extensions-instance');
    const id = await resolveInstanceDomainId();
    if (!id) throw new CmdError('instance_unavailable', 'instance_unavailable', 1, 503);
    return id;
}

export type Def = CommandDef;
export const def = (c: CommandDef): CommandDef => c;

/** Texto de entrada obligatorio (JSON pegado / archivo / stdin). */
export function requireInput(ctx: CmdContext, hint: L10n): string {
    if (!ctx.input || !ctx.input.trim()) throw new CmdError('input_required', ctx.t(hint), 2);
    return ctx.input;
}

export function parseInputJson(ctx: CmdContext, hint: L10n): unknown {
    const raw = requireInput(ctx, hint);
    try { return JSON.parse(raw); } catch { throw new CmdError('invalid_json', ctx.t(L('La entrada no es JSON válido.', 'The input is not valid JSON.')), 2); }
}

export const INPUT_HINT = L(
    'Falta el JSON. En la consola web usa --stdin y pega el JSON (termina con una línea "EOF"); en la CLI usa --file ruta.json o un pipe.',
    'JSON input is missing. In the web console use --stdin and paste the JSON (end with a line "EOF"); in the CLI use --file path.json or a pipe.',
);
