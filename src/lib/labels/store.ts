/**
 * Acceso a datos de etiquetas jerarquicas (servidor). SQL crudo parametrizado: las columnas nuevas (parentId, behavior,
 * sortOrder, icon, showInSidebar, showUnread, fullPath) son ADITIVAS y no estan en el modelo Prisma, asi el resto de la
 * aplicacion (findMany de etiquetas) sigue funcionando aunque la BD aun no se haya migrado. Si faltan, las lecturas caen
 * al esquema plano antiguo (todas raiz, comportamiento 'tag').
 *
 * Toda operacion filtra por userId (propiedad): un id ajeno equivale a "no existe".
 */
import { prisma } from '@/lib/prisma';
import {
    MAX_LABELS_PER_USER, MAX_LABEL_DEPTH, MAX_LABEL_NAME, PATH_SEPARATOR, checkMove, depthOf, descendantsOf, isLabelBehavior, isLabelIcon,
    isValidColor, pathOf, splitPath, validateSegment,
    type LabelBehavior, type LabelIcon, type LabelRow,
} from './model';
import { validateUserRegex } from '@/lib/rules/regex-safety';

type Db = Pick<typeof prisma, '$queryRawUnsafe' | '$executeRawUnsafe'>;

export class LabelError extends Error {
    constructor(public code: 'not_found' | 'conflict' | 'invalid' | 'limit' | 'cycle' | 'depth' | 'parent_missing' | 'self', message: string) {
        super(message);
        this.name = 'LabelError';
    }
}

const FULL_COLS = `"id","name","color","userId","parentId","behavior","sortOrder","icon","showInSidebar","showUnread","fullPath","aliasSuffix","filterRegex","createdAt","updatedAt"`;
const LEGACY_COLS = `"id","name","color","userId","aliasSuffix","filterRegex","createdAt","updatedAt"`;

const isMissingColumn = (e: unknown) => /42703|column .* does not exist/i.test(`${(e as any)?.code ?? ''} ${(e as any)?.meta?.code ?? ''} ${(e as any)?.message ?? ''}`);
const isUniqueViolation = (e: unknown) => /23505|P2002|unique/i.test(`${(e as any)?.code ?? ''} ${(e as any)?.meta?.code ?? ''} ${(e as any)?.message ?? ''}`);

function mapRow(r: any): Omit<LabelRow, 'fullPath'> & { fullPathStored: string | null } {
    return {
        id: r.id,
        name: r.name,
        color: r.color ?? '#6366f1',
        userId: r.userId,
        parentId: r.parentId ?? null,
        behavior: isLabelBehavior(r.behavior) ? r.behavior : 'tag',
        sortOrder: Number(r.sortOrder) || 0,
        icon: isLabelIcon(r.icon) ? r.icon : null,
        showInSidebar: r.showInSidebar !== false,
        showUnread: r.showUnread !== false,
        fullPathStored: r.fullPath ?? null,
        aliasSuffix: r.aliasSuffix ?? null,
        filterRegex: r.filterRegex ?? null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
    };
}

/** Todas las etiquetas del usuario con su ruta completa calculada desde la jerarquia (fuente de verdad). */
export async function listLabels(userId: string, db: Db = prisma): Promise<LabelRow[]> {
    let rows: any[];
    try {
        rows = await db.$queryRawUnsafe(`SELECT ${FULL_COLS} FROM "Label" WHERE "userId" = $1`, userId);
    } catch (e) {
        if (!isMissingColumn(e)) throw e;
        rows = await db.$queryRawUnsafe(`SELECT ${LEGACY_COLS} FROM "Label" WHERE "userId" = $1`, userId);
    }
    const mapped = rows.map(mapRow);
    const byId = new Map(mapped.map((l) => [l.id, l]));
    return mapped.map(({ fullPathStored: _s, ...l }) => ({ ...l, fullPath: pathOf(l.id, byId) }));
}

export async function getLabel(userId: string, id: string, db: Db = prisma): Promise<LabelRow | null> {
    return (await listLabels(userId, db)).find((l) => l.id === id) ?? null;
}

const newId = () => `lb${crypto.randomUUID().replace(/-/g, '')}`;

export interface LabelCreateInput {
    name: string;
    color?: string;
    parentId?: string | null;
    behavior?: LabelBehavior;
    icon?: LabelIcon | null;
    showInSidebar?: boolean;
    showUnread?: boolean;
    sortOrder?: number;
    aliasSuffix?: string | null;
    filterRegex?: string | null;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function inTx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => fn(tx as unknown as Db), { timeout: 20_000, maxWait: 10_000 }) as Promise<T>;
}

/** Recalcula y guarda fullPath de los nodos indicados (y su subarbol) a partir de la jerarquia actual. */
async function syncPaths(tx: Db, userId: string, ids?: string[]): Promise<void> {
    const labels = await listLabels(userId, tx);
    const targets = ids ? new Set(ids.flatMap((id) => [id, ...descendantsOf(id, labels)])) : null;
    for (const l of labels) {
        if (targets && !targets.has(l.id)) continue;
        await tx.$executeRawUnsafe(`UPDATE "Label" SET "fullPath" = $1 WHERE "id" = $2 AND "userId" = $3 AND "fullPath" IS DISTINCT FROM $1`, l.fullPath, l.id, userId);
    }
}

export async function createLabel(userId: string, input: LabelCreateInput): Promise<LabelRow> {
    const seg = validateSegment(input.name);
    if (!seg.ok) throw new LabelError('invalid', seg.error);
    if (input.color !== undefined && input.color !== '' && !isValidColor(input.color)) throw new LabelError('invalid', 'Color invalido (use #RGB o #RRGGBB)');
    if (input.icon != null && !isLabelIcon(input.icon)) throw new LabelError('invalid', 'Icono no permitido');
    if (input.behavior !== undefined && !isLabelBehavior(input.behavior)) throw new LabelError('invalid', 'Comportamiento invalido');
    if (input.filterRegex) {
        const r = validateUserRegex(input.filterRegex);
        if (!r.ok) throw new LabelError('invalid', r.error);
    }

    return inTx(async (tx) => {
        const all = await listLabels(userId, tx);
        if (all.length >= MAX_LABELS_PER_USER) throw new LabelError('limit', 'Label limit reached');
        const parentId = input.parentId ?? null;
        if (parentId) {
            const byId = new Map(all.map((l) => [l.id, l]));
            if (!byId.has(parentId)) throw new LabelError('parent_missing', 'Etiqueta padre no encontrada');
            if (depthOf(parentId, byId) + 1 > MAX_LABEL_DEPTH) throw new LabelError('depth', `Profundidad maxima: ${MAX_LABEL_DEPTH} niveles`);
        }
        const siblings = all.filter((l) => (l.parentId ?? null) === parentId);
        if (siblings.some((l) => sameName(l.name, seg.name))) throw new LabelError('conflict', 'A label with that name already exists');
        const id = newId();
        const sortOrder = input.sortOrder ?? (siblings.length ? Math.max(...siblings.map((s) => s.sortOrder)) + 1 : 0);
        const fullPath = parentId ? `${all.find((l) => l.id === parentId)!.fullPath}${PATH_SEPARATOR}${seg.name}` : seg.name;
        try {
            await tx.$executeRawUnsafe(
                `INSERT INTO "Label" ("id","name","color","userId","parentId","behavior","sortOrder","icon","showInSidebar","showUnread","fullPath","aliasSuffix","filterRegex")
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                id, seg.name, input.color || '#6366f1', userId, parentId, input.behavior ?? 'tag', sortOrder, input.icon ?? null,
                input.showInSidebar !== false, input.showUnread !== false, fullPath, input.aliasSuffix ?? null, input.filterRegex ?? null,
            );
        } catch (e) {
            if (isUniqueViolation(e)) throw new LabelError('conflict', 'A label with that name already exists');
            throw e;
        }
        const created = (await listLabels(userId, tx)).find((l) => l.id === id);
        if (!created) throw new LabelError('not_found', 'Label not found');
        return created;
    });
}

export interface LabelPatch {
    name?: string;
    color?: string;
    parentId?: string | null;
    behavior?: LabelBehavior;
    icon?: LabelIcon | null;
    showInSidebar?: boolean;
    showUnread?: boolean;
    sortOrder?: number;
    aliasSuffix?: string | null;
    filterRegex?: string | null;
}

export async function updateLabel(userId: string, id: string, patch: LabelPatch): Promise<LabelRow> {
    return inTx(async (tx) => {
        const all = await listLabels(userId, tx);
        const cur = all.find((l) => l.id === id);
        if (!cur) throw new LabelError('not_found', 'Label not found');

        let name = cur.name;
        if (patch.name !== undefined) {
            const seg = validateSegment(patch.name);
            if (!seg.ok) throw new LabelError('invalid', seg.error);
            name = seg.name;
        }
        let parentId = cur.parentId;
        if (patch.parentId !== undefined) {
            parentId = patch.parentId;
            const chk = checkMove(all, id, parentId);
            if (!chk.ok) throw new LabelError(chk.code, chk.error);
        }
        if (name !== cur.name || parentId !== cur.parentId) {
            const clash = all.some((l) => l.id !== id && (l.parentId ?? null) === (parentId ?? null) && sameName(l.name, name));
            if (clash) throw new LabelError('conflict', 'A label with that name already exists');
        }
        if (patch.color !== undefined && patch.color !== '' && !isValidColor(patch.color)) throw new LabelError('invalid', 'Color invalido (use #RGB o #RRGGBB)');
        if (patch.icon != null && !isLabelIcon(patch.icon)) throw new LabelError('invalid', 'Icono no permitido');
        if (patch.behavior !== undefined && !isLabelBehavior(patch.behavior)) throw new LabelError('invalid', 'Comportamiento invalido');
        if (patch.filterRegex) {
            const r = validateUserRegex(patch.filterRegex);
            if (!r.ok) throw new LabelError('invalid', r.error);
        }

        const sets: string[] = [];
        const values: unknown[] = [];
        const add = (col: string, v: unknown) => { values.push(v); sets.push(`"${col}" = $${values.length}`); };
        if (patch.name !== undefined) add('name', name);
        if (patch.parentId !== undefined) add('parentId', parentId);
        if (patch.color) add('color', patch.color.toLowerCase());
        if (patch.icon !== undefined) add('icon', patch.icon);
        if (patch.behavior !== undefined) add('behavior', patch.behavior);
        if (patch.showInSidebar !== undefined) add('showInSidebar', !!patch.showInSidebar);
        if (patch.showUnread !== undefined) add('showUnread', !!patch.showUnread);
        if (patch.sortOrder !== undefined) add('sortOrder', Math.trunc(Number(patch.sortOrder)) || 0);
        if (patch.aliasSuffix !== undefined) add('aliasSuffix', patch.aliasSuffix);
        if (patch.filterRegex !== undefined) add('filterRegex', patch.filterRegex);
        if (sets.length === 0) return cur;
        values.push(id, userId);
        try {
            await tx.$executeRawUnsafe(`UPDATE "Label" SET ${sets.join(', ')}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $${values.length - 1} AND "userId" = $${values.length}`, ...values);
        } catch (e) {
            if (isUniqueViolation(e)) throw new LabelError('conflict', 'A label with that name already exists');
            throw e;
        }
        if (patch.name !== undefined || patch.parentId !== undefined) await syncPaths(tx, userId, [id]);
        const updated = (await listLabels(userId, tx)).find((l) => l.id === id);
        if (!updated) throw new LabelError('not_found', 'Label not found');
        return updated;
    });
}

export interface LabelDeleteOptions {
    /** 'reparent': las subetiquetas suben al padre del borrado (por defecto). 'delete': se borra todo el subarbol. */
    children?: 'reparent' | 'delete';
}

export interface LabelDeleteResult { deleted: string[]; reparented: string[] }

/**
 * Borra una etiqueta. Los correos NUNCA se borran; el borrado de una etiqueta-carpeta devuelve a Entrada los correos que
 * solo estaban ahi (lo hace `releaseFolderEmails`, que el llamador ejecuta antes con los ids devueltos por `planDelete`).
 */
export async function planDelete(userId: string, id: string, opts: LabelDeleteOptions = {}): Promise<{ deleteIds: string[]; reparentIds: string[] } | null> {
    const all = await listLabels(userId);
    if (!all.some((l) => l.id === id)) return null;
    const desc = descendantsOf(id, all);
    if (opts.children === 'delete') return { deleteIds: [id, ...desc], reparentIds: [] };
    return { deleteIds: [id], reparentIds: all.filter((l) => l.parentId === id).map((l) => l.id) };
}

export async function deleteLabel(userId: string, id: string, opts: LabelDeleteOptions = {}): Promise<LabelDeleteResult> {
    return inTx(async (tx) => {
        const all = await listLabels(userId, tx);
        const cur = all.find((l) => l.id === id);
        if (!cur) throw new LabelError('not_found', 'Label not found');
        const mode = opts.children === 'delete' ? 'delete' : 'reparent';
        const deleteIds = mode === 'delete' ? [id, ...descendantsOf(id, all)] : [id];
        const reparented: string[] = [];
        if (mode === 'reparent') {
            const kids = all.filter((l) => l.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder);
            const newParent = cur.parentId;
            const taken = new Set(all.filter((l) => (l.parentId ?? null) === (newParent ?? null) && l.id !== id).map((l) => l.name.toLowerCase()));
            for (const k of kids) {
                let nm = k.name;
                let n = 2;
                while (taken.has(nm.toLowerCase())) nm = `${k.name.slice(0, MAX_LABEL_NAME - 6)} (${n++})`;
                taken.add(nm.toLowerCase());
                await tx.$executeRawUnsafe(`UPDATE "Label" SET "parentId" = $1, "name" = $2, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $3 AND "userId" = $4`, newParent, nm, k.id, userId);
                reparented.push(k.id);
            }
        }
        // Las filas de _EmailToLabel y las reglas vinculadas (Rule.labelId) caen por ON DELETE CASCADE.
        await tx.$executeRawUnsafe(`DELETE FROM "Label" WHERE "id" = ANY($1::text[]) AND "userId" = $2`, deleteIds, userId);
        if (reparented.length) await syncPaths(tx, userId, reparented);
        return { deleted: deleteIds, reparented };
    });
}

export interface ReorderItem { id: string; parentId?: string | null; sortOrder?: number }

/** Reordena / re-anida varias etiquetas de una vez, validando cada movimiento en orden (todo o nada). */
export async function reorderLabels(userId: string, items: ReorderItem[]): Promise<LabelRow[]> {
    if (items.length === 0 || items.length > MAX_LABELS_PER_USER) throw new LabelError('invalid', 'Lista de etiquetas invalida');
    return inTx(async (tx) => {
        let all = await listLabels(userId, tx);
        const moved: string[] = [];
        for (const it of items) {
            const cur = all.find((l) => l.id === it.id);
            if (!cur) throw new LabelError('not_found', 'Label not found');
            let parentId = cur.parentId;
            if (it.parentId !== undefined && it.parentId !== cur.parentId) {
                const chk = checkMove(all, it.id, it.parentId);
                if (!chk.ok) throw new LabelError(chk.code, chk.error);
                const clash = all.some((l) => l.id !== it.id && (l.parentId ?? null) === it.parentId && sameName(l.name, cur.name));
                if (clash) throw new LabelError('conflict', 'A label with that name already exists');
                parentId = it.parentId;
                moved.push(it.id);
            }
            const order = it.sortOrder !== undefined ? Math.trunc(Number(it.sortOrder)) || 0 : cur.sortOrder;
            await tx.$executeRawUnsafe(`UPDATE "Label" SET "parentId" = $1, "sortOrder" = $2, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $3 AND "userId" = $4`, parentId, order, it.id, userId);
            all = all.map((l) => (l.id === it.id ? { ...l, parentId, sortOrder: order } : l));
        }
        if (moved.length) await syncPaths(tx, userId, moved);
        return listLabels(userId, tx);
    });
}

/** Sincroniza fullPath de todas las etiquetas del usuario (util tras importaciones o migraciones). */
export async function healPaths(userId: string): Promise<void> {
    await inTx((tx) => syncPaths(tx, userId));
}

export interface EnsurePathOptions {
    behavior?: LabelBehavior;
    /** Comportamiento de los segmentos intermedios que se creen (por defecto, el mismo). */
    intermediateBehavior?: LabelBehavior;
    color?: string;
}

/**
 * Devuelve el id de la etiqueta de una ruta ("Trabajo/Proyecto A"), creando los segmentos que falten.
 * Segmentos > 50 caracteres se recortan; por debajo del nivel maximo el resto se une en el ultimo segmento.
 * Tolerante a carreras (unique_violation -> relee). Lanza LabelError('limit') si se supera el maximo de etiquetas.
 */
export async function ensureLabelPath(userId: string, path: string, opts: EnsurePathOptions = {}): Promise<{ id: string; created: boolean }> {
    let segs = splitPath(path).map((s) => s.replace(/[\u0000-\u001f\u007f,]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_NAME)).filter(Boolean);
    if (segs.length === 0) throw new LabelError('invalid', 'Ruta vacia');
    if (segs.length > MAX_LABEL_DEPTH) {
        segs = [...segs.slice(0, MAX_LABEL_DEPTH - 1), segs.slice(MAX_LABEL_DEPTH - 1).join(' - ').slice(0, MAX_LABEL_NAME)];
    }
    let parentId: string | null = null;
    let created = false;
    for (let i = 0; i < segs.length; i++) {
        const last = i === segs.length - 1;
        const existing = (await listLabels(userId)).find((l) => (l.parentId ?? null) === parentId && sameName(l.name, segs[i]));
        if (existing) { parentId = existing.id; continue; }
        try {
            const l = await createLabel(userId, {
                name: segs[i], parentId,
                behavior: last ? (opts.behavior ?? 'tag') : (opts.intermediateBehavior ?? opts.behavior ?? 'tag'),
                color: opts.color,
            });
            parentId = l.id;
            created = true;
        } catch (e) {
            if (e instanceof LabelError && e.code === 'conflict') {
                const again = (await listLabels(userId)).find((l) => (l.parentId ?? null) === parentId && sameName(l.name, segs[i]));
                if (again) { parentId = again.id; continue; }
            }
            throw e;
        }
    }
    return { id: parentId!, created };
}

/** Ids de las etiquetas (y descendientes, si se pide) cuyo nombre o ruta completa coincide con alguno de los filtros. */
export async function resolveLabelFilter(userId: string, filters: string[], includeDescendants = true): Promise<string[]> {
    const all = await listLabels(userId);
    const wanted = filters.map((f) => f.trim().toLowerCase()).filter(Boolean);
    const out = new Set<string>();
    for (const l of all) {
        const p = l.fullPath.toLowerCase();
        if (wanted.some((w) => p === w || (includeDescendants && p.startsWith(w + PATH_SEPARATOR)))) out.add(l.id);
    }
    return Array.from(out);
}

export { splitPath };
