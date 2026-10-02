/**
 * Servicio de usuarios del sandbox de extensiones (`services.users.*`), lado frontend. SOLO LECTURA.
 *
 * Garantias:
 *  - La FUENTE es esta instancia (su propia BD): solo existen las cuentas de SU dominio; no hay forma de consultar otro.
 *  - Exige el permiso READ_USERS en la executionGrant firmada por la instancia (`grant.perms`), ademas de la comprobacion del backend. Sin grant (camino
 *    legado de firma del backend) no se atiende: el servicio es nuevo y nace sin el camino deprecado.
 *  - Campos MINIMOS: id, email, name, createdAt. Nunca contrasena/hash, tokens, MFA, nivel de permiso ni ajustes.
 *  - Paginacion por cursor (keyset createdAt+id, estable ante altas), limite 1..100, busqueda acotada a 100 caracteres.
 *  - Cuota: 120 consultas/min por extension (ademas del limite por usuario de la ruta). Auditoria sin PII: quien, que extension, operacion y cuantas filas.
 */
import { z } from 'zod';
import { BridgeError, op } from './bridge-route';

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const USERS_MAX_LIMIT = 100;
export const USERS_DEFAULT_LIMIT = 50;
export const USERS_PERMISSION = 'READ_USERS';
export const USERS_QUOTA_PER_MINUTE = 120;

export const usersRequest = z.discriminatedUnion('op', [
    op('list', z.strictObject({
        limit: z.number().int().min(1).max(USERS_MAX_LIMIT).default(USERS_DEFAULT_LIMIT),
        cursor: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/).optional(),
        search: z.string().min(1).max(100).optional(),
    }).default({ limit: USERS_DEFAULT_LIMIT })),
    op('get', z.union([z.strictObject({ id }), z.strictObject({ email: z.string().min(3).max(254) })])),
]);
export type UsersRequest = z.infer<typeof usersRequest>;

export interface UsersDb {
    user: {
        findMany: (args: any) => Promise<any[]>;
        findFirst: (args: any) => Promise<any>;
    };
}

export interface UsersDeps {
    db: UsersDb;
    rateLimit: (key: string, limit: number, windowMs: number) => Promise<{ ok: boolean; retryAfter: number }>;
    audit: (event: string, data: Record<string, unknown>) => void;
}

export async function defaultUsersDeps(): Promise<UsersDeps> {
    const { prisma } = await import('@/lib/prisma');
    const { rateLimitAsync } = await import('@/lib/security');
    const { auditLog } = await import('@/lib/audit');
    return { db: prisma as unknown as UsersDb, rateLimit: rateLimitAsync, audit: auditLog };
}

export interface UserOut { id: string; email: string; name: string | null; createdAt: string }

/** Lista blanca de campos: el `select` de la consulta ya los limita, y aqui se proyectan de nuevo por defensa. */
export function toUser(row: any): UserOut {
    return {
        id: String(row.id),
        email: String(row.email),
        name: typeof row.name === 'string' ? row.name.slice(0, 200) : null,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ''),
    };
}
const SELECT = { id: true, email: true, name: true, createdAt: true } as const;

export function encodeCursor(createdAt: Date, userId: string): string {
    return Buffer.from(`${createdAt.getTime()}.${userId}`, 'utf8').toString('base64url');
}
export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
    try {
        const text = Buffer.from(cursor, 'base64url').toString('utf8');
        const m = /^(\d{1,15})\.([A-Za-z0-9_-]{1,64})$/.exec(text);
        if (!m) return null;
        const createdAt = new Date(Number(m[1]));
        return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id: m[2] };
    } catch {
        return null;
    }
}

/**
 * `contains` de Prisma NO escapa los comodines de LIKE (verificado contra Postgres real: `_` y `%` coinciden con cualquier caracter).
 * Se descartan los caracteres de control, se acota la longitud y se escapan `\`, `%` y `_` con `\` (escape por defecto de LIKE en PostgreSQL).
 */
export function cleanSearch(value: string): string {
    return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function handleUsers(deps: UsersDeps, req: UsersRequest, ctx: { grant?: { perms: string[] } } = {}): Promise<unknown> {
    // El permiso lo decide la concesion firmada por ESTA instancia (no el cuerpo que reenvia el backend).
    if (!ctx.grant || !Array.isArray(ctx.grant.perms) || !ctx.grant.perms.includes(USERS_PERMISSION)) throw new BridgeError('forbidden');

    const quota = await deps.rateLimit(`internal-users-ext:${req.extensionId}`, USERS_QUOTA_PER_MINUTE, 60_000);
    if (!quota.ok) throw new BridgeError('rate_limited', quota.retryAfter);

    const { db } = deps;
    let result: { users: UserOut[]; nextCursor?: string | null } | { user: UserOut | null };

    if (req.op === 'list') {
        const { limit, cursor } = req.args;
        const search = req.args.search ? cleanSearch(req.args.search) : '';
        const and: any[] = [];
        if (cursor) {
            const c = decodeCursor(cursor);
            if (!c) throw new BridgeError('invalid_args');
            and.push({ OR: [{ createdAt: { gt: c.createdAt } }, { createdAt: c.createdAt, id: { gt: c.id } }] });
        }
        if (search) and.push({ OR: [{ email: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }] });
        const rows = await db.user.findMany({
            where: and.length ? { AND: and } : {},
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: limit + 1,
            select: SELECT,
        });
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        result = {
            users: page.map(toUser),
            nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt instanceof Date ? last.createdAt : new Date(last.createdAt), String(last.id)) : null,
        };
    } else {
        const a = req.args as { id?: string; email?: string };
        let where: Record<string, unknown>;
        if (a.id) where = { id: a.id };
        else {
            const email = String(a.email || '').trim().toLowerCase();
            if (!/^[^\s@<>",;:()\\]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/.test(email)) throw new BridgeError('invalid_args');
            where = { email: { equals: email, mode: 'insensitive' } };
        }
        const row = await db.user.findFirst({ where, select: SELECT });
        result = { user: row ? toUser(row) : null };
    }

    // Auditoria sin PII: quien consulta, con que extension, la operacion y cuantas filas devolvio.
    deps.audit('extension.users.read', {
        userId: req.userId,
        extensionId: req.extensionId,
        op: req.op,
        rows: 'users' in result ? result.users.length : result.user ? 1 : 0,
    });
    return result;
}
