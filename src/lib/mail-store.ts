// Acceso a datos de la bandeja que necesita SQL propio: carpeta de origen (previousFolder), conteos por filtro y
// seleccion por alcance (carpeta + filtro). Todo parametrizado; ninguna cadena del usuario se interpola en el SQL.
import { prisma } from '@/lib/prisma';
import type { FolderFilterCounts, MailFilterKey, MailSortKey, MailCursor } from '@/lib/mail-query';
import { getAccessibleMailboxUserIds } from '@/lib/mailbox-access';
import { applyLearning, snapshotForLearning } from '@/lib/spam/learn-hook';
import { dropFolderLabels } from '@/lib/labels/behavior';
import {
    DEFAULT_SQL_OPTIONS,
    emptyScope,
    SqlParams,
    buildFolderBadgesSql,
    buildLabelBadgesSql,
    buildPageSql,
    buildScopeCountsSql,
    buildScopeIdsSubquery,
    readScopeCounts,
    type MailListScope,
    type ScopeCounts,
    type SqlOptions,
} from '@/lib/mail-list-sql';

/** Carpetas a las que un "mover" registra la carpeta de origen. */
export const PREVIOUS_FOLDER_TARGETS = ['archive', 'trash', 'spam'] as const;
/** Carpetas validas como destino de "Restaurar" (nunca la papelera ni carpetas internas como snoozed). */
export const RESTORE_TARGETS = ['inbox', 'archive', 'spam', 'sent'] as const;

const FOLDER_TOKEN = /^[A-Za-z0-9_-]{1,50}$/;

/** Valor de previousFolder tras mover de `from` a `to`: el origen si `to` es archive/trash/spam; null si vuelve a otra carpeta. */
export function previousFolderAfterMove(from: string | null | undefined, to: string, current: string | null = null): string | null {
    if (!(PREVIOUS_FOLDER_TARGETS as readonly string[]).includes(to)) return null;
    if (from && from !== to && FOLDER_TOKEN.test(from)) return from;
    return current;
}

/** Carpeta a la que restaura "Restaurar": la registrada si es valida; si no (o no hay dato), la bandeja de entrada. */
export function restoreFolderFor(previous: string | null | undefined, fallback?: string | null): string {
    for (const candidate of [previous, fallback]) {
        if (candidate && (RESTORE_TARGETS as readonly string[]).includes(candidate)) return candidate;
    }
    return 'inbox';
}

const MISSING_COLUMN = /42703|previousFolder.*does not exist|column .* does not exist/i;

function isMissingColumn(error: unknown): boolean {
    const e = error as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } } | null;
    return MISSING_COLUMN.test(`${e?.code ?? ''} ${e?.meta?.code ?? ''} ${e?.message ?? ''} ${e?.meta?.message ?? ''}`);
}

export interface MoveInput {
    ids: string[];
    /** Buzones sobre los que se puede actuar (propiedad): el UPDATE solo toca filas con userId en esta lista. */
    userIds: string[];
    folder: string;
    read?: boolean;
    starred?: boolean;
}

/**
 * Cambia la carpeta (y opcionalmente leido/destacado) y fija `previousFolder` en UNA sentencia atomica.
 * Si la columna aun no existe (despliegue sin `db:ensure`) cae a un updateMany sin previousFolder.
 */
export async function moveEmailsTracked(input: MoveInput): Promise<number> {
    const { ids, userIds, folder, read, starred } = input;
    if (ids.length === 0 || userIds.length === 0) return 0;
    // Spam v2: instantanea de los correos que pasan a/desde spam (aprende de la marca del usuario, en el servidor).
    const learnRows = await snapshotForLearning(ids, userIds, folder);
    try {
        const n = await prisma.$executeRawUnsafe(
            `UPDATE "Email" SET
                "previousFolder" = CASE
                    WHEN $1::text IN ('archive','trash','spam') THEN (CASE WHEN "folder" <> $1::text THEN "folder" ELSE "previousFolder" END)
                    ELSE NULL END,
                "folder" = $1::text,
                "read" = COALESCE($4::boolean, "read"),
                "starred" = COALESCE($5::boolean, "starred")
             WHERE "id" = ANY($2::text[]) AND "userId" = ANY($3::text[])`,
            folder, ids, userIds, read ?? null, starred ?? null,
        );
        // Volver a Entrada por una accion explicita saca al correo de sus etiquetas-carpeta (ya no esta "en" ellas).
        if (folder === 'inbox') await dropFolderLabels(userIds, ids).catch(() => 0);
        if (learnRows.length > 0) void applyLearning(learnRows, folder);
        return Number(n);
    } catch (error) {
        // Sin columna (o cliente sin SQL crudo): camino clasico, sin perder el movimiento.
        if (!isMissingColumn(error) && !(error instanceof TypeError)) throw error;
        const data: Record<string, unknown> = { folder };
        if (read !== undefined) data.read = read;
        if (starred !== undefined) data.starred = starred;
        const r = await prisma.email.updateMany({ where: { id: { in: ids }, userId: { in: userIds } }, data });
        if (learnRows.length > 0) void applyLearning(learnRows, folder);
        return r.count;
    }
}

/** previousFolder de cada correo (solo de los buzones permitidos). {} si la columna no existe. */
export async function getPreviousFolders(ids: string[], userIds: string[]): Promise<Record<string, string | null>> {
    if (ids.length === 0 || userIds.length === 0) return {};
    try {
        const rows = (await prisma.$queryRawUnsafe(
            `SELECT "id", "previousFolder" FROM "Email" WHERE "id" = ANY($1::text[]) AND "userId" = ANY($2::text[])`,
            ids, userIds,
        )) as Array<{ id: string; previousFolder: string | null }>;
        return Object.fromEntries(rows.map((r) => [r.id, r.previousFolder ?? null]));
    } catch (error) {
        if (isMissingColumn(error) || error instanceof TypeError) return {};
        throw error;
    }
}

export interface RestoreResult {
    count: number;
    /** Destino de cada correo restaurado (el cliente actualiza su lista y el deshacer). */
    targets: Record<string, string>;
}

/**
 * "Restaurar": cada correo vuelve a su `previousFolder` (o a `fallbacks[id]`, copia legada del navegador, o a la bandeja).
 * Solo correos que estan en la papelera o spam (restaurar un correo que no esta ahi no hace nada).
 */
export async function restoreEmailsToPrevious(ids: string[], userIds: string[], fallbacks: Record<string, string> = {}): Promise<RestoreResult> {
    if (ids.length === 0 || userIds.length === 0) return { count: 0, targets: {} };
    const rows = await prisma.email.findMany({
        where: { id: { in: ids }, userId: { in: userIds }, folder: { in: ['trash', 'spam'] } },
        select: { id: true },
    });
    const eligible = rows.map((r) => r.id);
    const previous = await getPreviousFolders(eligible, userIds);
    const byFolder = new Map<string, string[]>();
    const targets: Record<string, string> = {};
    for (const id of eligible) {
        const target = restoreFolderFor(previous[id], fallbacks[id]);
        targets[id] = target;
        (byFolder.get(target) ?? byFolder.set(target, []).get(target)!).push(id);
    }
    let count = 0;
    for (const [folder, list] of byFolder) count += await moveEmailsTracked({ ids: list, userIds, folder });
    return { count, targets };
}

// ---------------------------------------------------------------------------
// Conteos por filtro de una carpeta
// ---------------------------------------------------------------------------

export function ownAddressesOf(user: { email: string; accounts?: Array<{ providerAccountId?: string | null }> }): string[] {
    const set = new Set<string>([String(user.email || '').toLowerCase()]);
    for (const a of user.accounts ?? []) {
        const v = String(a.providerAccountId || '').trim().toLowerCase();
        if (v.includes('@')) set.add(v);
    }
    return Array.from(set).filter((v) => v.includes('@'));
}


// ---------------------------------------------------------------------------
// Varios buzones (ambito multi-buzon)
// ---------------------------------------------------------------------------

export type MailboxScopeResult = { ok: true; userIds: string[] } | { ok: false; status: 400 | 403; error: string };

/**
 * Resuelve `mailboxes=<ids>` (o `all`) contra los buzones a los que la SESION puede acceder (getAccessibleMailboxUserIds).
 * Un id que no sea de esa lista NUNCA se acepta (403): el ambito no puede ampliarse con ids ajenos.
 */
export async function resolveMailboxScope(sessionUserId: string, requested: string[]): Promise<MailboxScopeResult> {
    const accessible = await getAccessibleMailboxUserIds(sessionUserId);
    if (requested.length === 0) return { ok: false, status: 400, error: 'No mailboxes' };
    if (requested.includes('all')) return { ok: true, userIds: accessible };
    const allowed = new Set(accessible);
    if (requested.some((id) => !allowed.has(id))) return { ok: false, status: 403, error: 'Forbidden mailbox' };
    return { ok: true, userIds: requested };
}

// ---------------------------------------------------------------------------
// Opciones de SQL segun la BD real (tipo de createdAt, funcion de orden por remitente)
// ---------------------------------------------------------------------------

let sqlOptionsCache: { at: number; options: SqlOptions } | null = null;

export function resetSqlOptionsCache() { sqlOptionsCache = null; }

/** Tipo REAL de Email.createdAt (timestamptz del DDL de ensure-schema o timestamp(3) de Prisma) y si existe bloomx_sender_key. */
export async function getSqlOptions(): Promise<SqlOptions> {
    const now = Date.now();
    if (sqlOptionsCache && now - sqlOptionsCache.at < (sqlOptionsCache.options.senderKeyFn && sqlOptionsCache.options.threadKey ? 300_000 : 20_000)) return sqlOptionsCache.options;
    let options: SqlOptions = DEFAULT_SQL_OPTIONS;
    try {
        const rows = (await prisma.$queryRawUnsafe(
            `SELECT (SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Email' AND column_name = 'createdAt') AS "kind",
                    (to_regproc('bloomx_sender_key') IS NOT NULL) AS "fn",
                    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Email' AND column_name = 'threadKey') AS "tk",
                    (SELECT COUNT(*) = 3 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Label' AND column_name IN ('fullPath','behavior','parentId')) AS "lt"`,
        )) as Array<{ kind: string | null; fn: boolean; tk: boolean; lt: boolean }>;
        const r = rows[0];
        options = {
            createdAtKind: r?.kind === 'timestamp without time zone' ? 'timestamp' : 'timestamptz',
            senderKeyFn: r?.fn === true,
            threadKey: r?.tk === true,
            labelTree: r?.lt === true,
        };
    } catch {
        options = DEFAULT_SQL_OPTIONS;
    }
    sqlOptionsCache = { at: now, options };
    return options;
}

const MISSING_FUNCTION = /42883|bloomx_sender_key/i;

async function withOptions<T>(run: (opt: SqlOptions) => Promise<T>): Promise<T> {
    try {
        return await run(await getSqlOptions());
    } catch (error) {
        const e = error as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } } | null;
        if (!MISSING_FUNCTION.test(`${e?.code ?? ''} ${e?.meta?.code ?? ''} ${e?.message ?? ''} ${e?.meta?.message ?? ''}`)) throw error;
        // La BD no tiene la funcion (despliegue sin db:ensure): misma expresion en linea, sin indice.
        resetSqlOptionsCache();
        const fallback = { ...(await getSqlOptions()), senderKeyFn: false };
        sqlOptionsCache = { at: Date.now(), options: fallback };
        return run(fallback);
    }
}

// ---------------------------------------------------------------------------
// Lista, conteos por hilo, insignias
// ---------------------------------------------------------------------------

/**
 * Email.threadKey de una pagina de correos (id -> clave). SQL directo y tolerante: el cliente de Prisma generado puede no conocer la
 * columna, y en una BD sin db:ensure devuelve un mapa vacio (la interfaz cae a la clave heuristica heredada).
 */
export async function selectThreadKeys(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    try {
        const rows = (await prisma.$queryRawUnsafe(`SELECT "id", "threadKey" FROM "Email" WHERE "id" = ANY($1::text[]) AND "threadKey" IS NOT NULL`, ids)) as Array<{ id: string; threadKey: string }>;
        for (const r of rows) if (r.threadKey) out.set(r.id, r.threadKey);
    } catch (error) {
        const m = `${(error as any)?.code ?? ''} ${(error as any)?.meta?.code ?? ''} ${(error as any)?.message ?? ''}`;
        if (!/does not exist|42703/i.test(m)) throw error;
    }
    return out;
}

export interface PageRow { id: string; ct: string; sk: string | null }

export async function selectPageRows(input: { scope: MailListScope; sort: MailSortKey; filter: MailFilterKey; own: string[]; cursor: MailCursor | null; take: number; offset: number }): Promise<PageRow[]> {
    return withOptions(async (opt) => {
        const q = buildPageSql(input, opt);
        return (await prisma.$queryRawUnsafe(q.sql, ...q.values)) as PageRow[];
    });
}

/** Conteos por filtro del ambito: HILOS (filas de la interfaz) y mensajes. El texto libre reintenta sin full-text si este falla. */
export async function getScopeCounts(scope: MailListScope, own: string[]): Promise<ScopeCounts> {
    const run = (s: MailListScope) => withOptions(async (opt) => {
        const q = buildScopeCountsSql(s, own, opt);
        const rows = (await prisma.$queryRawUnsafe(q.sql, ...q.values)) as Array<Record<string, unknown>>;
        return readScopeCounts(rows[0]);
    });
    try {
        return await run(scope);
    } catch (error) {
        if (!(scope.search?.text && scope.useFts)) throw error;
        return run({ ...scope, useFts: false });
    }
}

/** Conteos por filtro (hilos) de una carpeta de uno o varios buzones. */
export async function getFolderFilterCounts(userIds: string[], folder: string, own: string[]): Promise<FolderFilterCounts> {
    return (await getScopeCounts(emptyScope(userIds, folder), own)).threads;
}

export interface BadgeTally { threads: number; messages: number; unreadThreads: number; unreadMessages: number }

const tally = (r: Record<string, unknown>): BadgeTally => ({
    threads: Number(r.t_all ?? 0), messages: Number(r.m_all ?? 0), unreadThreads: Number(r.t_unread ?? 0), unreadMessages: Number(r.m_unread ?? 0),
});

/** Insignias por carpeta y por etiqueta (nombre en minuscula). Sin `withTotals` solo son fiables los no leidos. */
export async function getBadges(userIds: string[], withTotals: boolean): Promise<{ folders: Record<string, BadgeTally>; labels: Record<string, BadgeTally>; labelsById: Record<string, BadgeTally> }> {
    const opt = await getSqlOptions();
    const f = buildFolderBadgesSql(userIds, withTotals, opt);
    const l = buildLabelBadgesSql(userIds, withTotals, opt);
    const [fr, lr] = await Promise.all([
        prisma.$queryRawUnsafe(f.sql, ...f.values) as Promise<Array<Record<string, unknown>>>,
        prisma.$queryRawUnsafe(l.sql, ...l.values) as Promise<Array<Record<string, unknown>>>,
    ]);
    return {
        folders: Object.fromEntries(fr.map((r) => [String(r.folder), tally(r)])),
        labels: Object.fromEntries(lr.map((r) => [String(r.name), tally(r)])),
        // Con jerarquia el acumulado viene por id de etiqueta (`lid`); sin ella queda vacio y se usa el nombre.
        labelsById: Object.fromEntries(lr.filter((r) => typeof r.lid === 'string').map((r) => [String(r.lid), tally(r)])),
    };
}

// ---------------------------------------------------------------------------
// Alcance (ambito + filtro): accion masiva en servidor, SIN tope
// ---------------------------------------------------------------------------

/** Todos los ids del alcance (mas recientes primero). Sin tope: la memoria solo guarda ids. */
export async function selectScopeIds(scope: MailListScope, filter: MailFilterKey, own: string[]): Promise<string[]> {
    return withOptions(async (opt) => {
        const p = new SqlParams();
        const sub = buildScopeIdsSubquery(scope, filter, own, opt, p);
        const rows = (await prisma.$queryRawUnsafe(`${sub} ORDER BY e."createdAt" DESC, e."id" DESC`, ...p.values)) as Array<{ id: string }>;
        return rows.map((r) => r.id);
    });
}

/**
 * Cambia carpeta y/o leido/destacado de TODO el alcance en UNA sentencia atomica (UPDATE ... WHERE id IN (subconsulta) RETURNING id):
 * sin tope y sin ventana entre seleccionar y actuar. Fija previousFolder igual que moveEmailsTracked.
 */
export async function updateScope(scope: MailListScope, filter: MailFilterKey, own: string[], changes: { folder?: string; read?: boolean; starred?: boolean }): Promise<string[]> {
    if (changes.folder === undefined && changes.read === undefined && changes.starred === undefined) return [];
    // Spam v2: solo si el movimiento cruza spam/no spam se toma la instantanea (acotada a 200 correos) para aprender.
    let learnRows: Awaited<ReturnType<typeof snapshotForLearning>> = [];
    if (changes.folder === 'spam' || changes.folder === 'inbox' || changes.folder === 'archive') {
        try { learnRows = await snapshotForLearning((await selectScopeIds(scope, filter, own)).slice(0, 200), scope.userIds, changes.folder); } catch { learnRows = []; }
    }
    const moved = await updateScopeInner(scope, filter, own, changes);
    if (learnRows.length > 0) void applyLearning(learnRows, changes.folder as string);
    return moved;
}

async function updateScopeInner(scope: MailListScope, filter: MailFilterKey, own: string[], changes: { folder?: string; read?: boolean; starred?: boolean }): Promise<string[]> {
    return withOptions(async (opt) => {
        const build = (withPrevious: boolean) => {
            const p = new SqlParams();
            const sub = buildScopeIdsSubquery(scope, filter, own, opt, p);
            const sets: string[] = [];
            if (changes.folder !== undefined) {
                const f = `${p.add(changes.folder)}::text`;
                if (withPrevious) {
                    sets.push(`"previousFolder" = CASE WHEN ${f} IN ('archive','trash','spam') THEN (CASE WHEN u."folder" <> ${f} THEN u."folder" ELSE u."previousFolder" END) ELSE NULL END`);
                }
                sets.push(`"folder" = ${f}`);
            }
            if (changes.read !== undefined) sets.push(`"read" = ${p.add(changes.read)}::boolean`);
            if (changes.starred !== undefined) sets.push(`"starred" = ${p.add(changes.starred)}::boolean`);
            return { sql: `UPDATE "Email" AS u SET ${sets.join(', ')} WHERE u."id" IN (${sub}) RETURNING u."id" AS "id"`, values: p.values };
        };
        try {
            const q = build(true);
            return ((await prisma.$queryRawUnsafe(q.sql, ...q.values)) as Array<{ id: string }>).map((r) => r.id);
        } catch (error) {
            if (!isMissingColumn(error)) throw error;
            const q = build(false);
            return ((await prisma.$queryRawUnsafe(q.sql, ...q.values)) as Array<{ id: string }>).map((r) => r.id);
        }
    });
}
