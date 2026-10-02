import { emailsAtLeast, effectiveLevelSync, LEVEL_NAMES, type PermissionLevel } from '@/lib/permissions-core';
import { USER_ID_RE, collectUserRefs, type SettingField, type SettingIssue, type UserFilter } from '@/lib/expansions/settings-schema';
import { escapeLike } from '@/lib/admin/users-store';
import { query as defaultQuery, tolerant } from '@/lib/admin/sql';

/**
 * Selector de usuarios para los ajustes de extensiones (`user`, `users`, `userMap`).
 *
 * AISLAMIENTO POR DOMINIO: la fuente es la tabla "User" de ESTA instancia (cada dominio tiene su propia base), asi que solo existen las
 * cuentas del dominio actual; no hay parametro con el que consultar otro. Solo se proyectan id, correo, nombre, estado y nivel (nunca
 * contrasena, tokens ni MFA). SQL siempre parametrizado; la busqueda escapa `% _ \`.
 *
 * `filter` del schema (`minLevel`, `role`): el nivel sale del permiso efectivo de la cuenta (UserPermission + ADMIN_EMAILS); `role` es el
 * nombre del nivel (user, support, operator, admin, superadmin). Un rol desconocido no coincide con nadie (falla cerrado).
 */

export const USERS_PAGE_MAX = 50;
export const USERS_IDS_MAX = 100;

export interface DomainUser { id: string; email: string; name: string | null; disabled: boolean; level: number; levelName: string }
export type Query = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => Promise<T[]>;
export interface UserDeps { query: Query }
const defaultDeps: UserDeps = { query: defaultQuery };

const ROLE_LEVEL: Record<string, PermissionLevel> = Object.fromEntries(Object.entries(LEVEL_NAMES).map(([level, name]) => [name, Number(level) as PermissionLevel]));

function toUser(row: { id: string; email: string; name: string | null; disabled: boolean }): DomainUser {
    const level = effectiveLevelSync(row.email).level;
    return { id: String(row.id), email: String(row.email), name: typeof row.name === 'string' ? row.name.slice(0, 200) : null, disabled: !!row.disabled, level, levelName: LEVEL_NAMES[level] };
}

/** El usuario cumple el `filter` del campo (nivel minimo y/o rol). */
export function matchesFilter(user: Pick<DomainUser, 'level'>, filter: UserFilter | undefined): boolean {
    if (!filter) return true;
    if (filter.minLevel !== undefined && user.level < filter.minLevel) return false;
    if (filter.role !== undefined && ROLE_LEVEL[filter.role] !== user.level) return false;
    return true;
}

interface Row { id: string; email: string; name: string | null; disabled: boolean }

async function select(deps: UserDeps, where: string, params: unknown[], tail: string, withState: boolean): Promise<Row[]> {
    const sql = withState
        ? `SELECT u."id", u."email", u."name", COALESCE(ast."disabled", FALSE) AS "disabled" FROM "User" u LEFT JOIN "UserAdminState" ast ON ast."userId" = u."id" ${where} ${tail}`
        : `SELECT u."id", u."email", u."name", FALSE AS "disabled" FROM "User" u ${where} ${tail}`;
    return deps.query<Row>(sql, ...params);
}

/** Busca usuarios del dominio actual (paginado por pagina/offset, max 50). `q` busca en correo y nombre. */
export async function searchUsers(
    opts: { q?: string; page?: number; limit?: number; filter?: UserFilter; includeDisabled?: boolean },
    deps: UserDeps = defaultDeps,
): Promise<{ users: DomainUser[]; total: number; page: number; limit: number; hasMore: boolean }> {
    const limit = Math.max(1, Math.min(USERS_PAGE_MAX, Math.trunc(opts.limit ?? 20) || 20));
    const page = Math.max(0, Math.min(10_000, Math.trunc(opts.page ?? 0) || 0));
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const conds: string[] = [];
    const q = (opts.q ?? '').trim().slice(0, 100);
    if (q) { const like = p(escapeLike(q)); conds.push(`(u."email" ILIKE ${like} ESCAPE '\\' OR COALESCE(u."name", '') ILIKE ${like} ESCAPE '\\')`); }
    const f = opts.filter;
    if (f?.minLevel !== undefined) conds.push(`lower(u."email") = ANY(${p(emailsAtLeast(f.minLevel as PermissionLevel))}::text[])`);
    if (f?.role !== undefined) {
        const level = ROLE_LEVEL[f.role];
        if (level === undefined) conds.push('FALSE');
        else if (level === 0) conds.push(`NOT (lower(u."email") = ANY(${p(emailsAtLeast(1))}::text[]))`);
        else {
            const higher = new Set(emailsAtLeast(Math.min(4, level + 1) as PermissionLevel));
            const exact = emailsAtLeast(level).filter((e) => level === 4 || !higher.has(e));
            conds.push(`lower(u."email") = ANY(${p(exact)}::text[])`);
        }
    }
    const build = (withState: boolean) => (opts.includeDisabled === false && withState ? [...conds, 'COALESCE(ast."disabled", FALSE) = FALSE'] : conds);
    const run = async (withState: boolean) => {
        const where = build(withState).length ? `WHERE ${build(withState).join(' AND ')}` : '';
        const base = [...params];
        const count = await deps.query<{ n: bigint | number | string }>(
            withState ? `SELECT COUNT(*) AS n FROM "User" u LEFT JOIN "UserAdminState" ast ON ast."userId" = u."id" ${where}` : `SELECT COUNT(*) AS n FROM "User" u ${where}`,
            ...base,
        );
        const rows = await select(deps, where, [...base, limit + 1, page * limit], `ORDER BY lower(u."email") ASC, u."id" ASC LIMIT $${base.length + 1} OFFSET $${base.length + 2}`, withState);
        return { total: Number(count[0]?.n ?? 0), rows };
    };
    const result = (await tolerant(() => run(true), null)) ?? (await run(false));
    return { users: result.rows.slice(0, limit).map(toUser), total: result.total, page, limit, hasMore: result.rows.length > limit };
}

/** Resuelve ids del dominio actual (max 100). Los ids que no existen NO aparecen en el mapa (= "usuario eliminado"). */
export async function resolveUsers(ids: string[], deps: UserDeps = defaultDeps): Promise<Map<string, DomainUser>> {
    const clean = Array.from(new Set(ids.filter((id) => USER_ID_RE.test(id)))).slice(0, USERS_IDS_MAX);
    if (clean.length === 0) return new Map();
    const where = 'WHERE u."id" = ANY($1::text[])';
    const rows = (await tolerant(() => select(deps, where, [clean], '', true), null)) ?? (await select(deps, where, [clean], '', false));
    return new Map(rows.map((r) => { const u = toUser(r); return [u.id, u]; }));
}

const idsOf = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : v && typeof v === 'object' ? Object.keys(v as object) : []);

/**
 * Valida en el SERVIDOR los ids de usuario de un cambio de ajustes: existen en el dominio, no estan desactivados y cumplen el `filter`.
 * Solo se comprueban los ids NUEVOS (los que ya estaban guardados no bloquean otros cambios si el usuario se desactivo despues; aparecen en
 * la UI como "usuario eliminado"/"desactivado" y se pueden limpiar). Devuelve problemas con ruta `values.<clave>`.
 */
export async function validateUserRefs(
    fields: SettingField[],
    nextValues: Record<string, unknown>,
    storedValues: Record<string, unknown>,
    deps: UserDeps = defaultDeps,
): Promise<SettingIssue[]> {
    const refs = collectUserRefs(fields, nextValues);
    if (refs.length === 0) return [];
    const fresh = refs.map((r) => ({ ...r, ids: r.ids.filter((id) => !idsOf(storedValues[r.key]).includes(id)) })).filter((r) => r.ids.length > 0);
    if (fresh.length === 0) return [];
    const found = await resolveUsers(fresh.flatMap((r) => r.ids), deps);
    const issues: SettingIssue[] = [];
    for (const r of fresh) {
        for (const id of r.ids) {
            const user = found.get(id);
            const at = `values.${r.key}`;
            if (!user) { issues.push({ path: at, message: 'El usuario no existe en este dominio', code: 'userMissing', params: { id } }); break; }
            if (user.disabled) { issues.push({ path: at, message: 'El usuario esta desactivado', code: 'userDisabled', params: { id } }); break; }
            if (!matchesFilter(user, r.filter)) { issues.push({ path: at, message: 'El usuario no cumple el filtro del ajuste', code: 'userFilter', params: { id } }); break; }
        }
    }
    return issues;
}
