/**
 * Modelo puro de etiquetas jerarquicas con comportamiento (sin BD): tipos, validacion de nombres/iconos,
 * arbol, ciclos, profundidad y utilidades de ruta. Lo comparten el servidor (store.ts) y la interfaz (LabelTree).
 *
 * - `name` es el SEGMENTO; la ruta completa ("Trabajo/Proyecto A") se compone con la jerarquia (`fullPath`).
 * - behavior 'tag' (estilo Gmail): el correo conserva su carpeta y gana la etiqueta.
 *   behavior 'folder' (estilo Outlook/Hotmail): al asignarla el correo sale de Entrada (folder='archive',
 *   previousFolder='inbox') y la etiqueta es su ubicacion visible; al quitarla vuelve a Entrada.
 */

export const MAX_LABEL_DEPTH = 5;
export const MAX_LABEL_NAME = 50;
export const MAX_LABELS_PER_USER = 500;
export const LABEL_BEHAVIORS = ['tag', 'folder'] as const;
export type LabelBehavior = (typeof LABEL_BEHAVIORS)[number];
export const PATH_SEPARATOR = '/';

/** Lista blanca de iconos (ids; la interfaz los asocia a un icono concreto). null = el predeterminado del comportamiento. */
export const LABEL_ICONS = [
    'tag', 'folder', 'briefcase', 'star', 'heart', 'home', 'cart', 'receipt', 'plane', 'book', 'user', 'users',
    'bell', 'flag', 'inbox', 'mail', 'archive', 'shield', 'wallet', 'graduation', 'code', 'camera', 'music', 'gift',
] as const;
export type LabelIcon = (typeof LABEL_ICONS)[number];

export interface LabelRow {
    id: string;
    name: string;
    color: string;
    userId: string;
    parentId: string | null;
    behavior: LabelBehavior;
    sortOrder: number;
    icon: LabelIcon | null;
    showInSidebar: boolean;
    showUnread: boolean;
    /** Ruta completa; siempre presente en lo que devuelve el servidor. */
    fullPath: string;
    aliasSuffix?: string | null;
    filterRegex?: string | null;
    createdAt?: string | Date;
    updatedAt?: string | Date;
}

export interface LabelTreeNode<T extends LabelRow = LabelRow> {
    label: T;
    depth: number;
    children: LabelTreeNode<T>[];
}

const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export const isValidColor = (c: unknown): c is string => typeof c === 'string' && COLOR_RE.test(c);
export const isLabelIcon = (v: unknown): v is LabelIcon => typeof v === 'string' && (LABEL_ICONS as readonly string[]).includes(v);
export const isLabelBehavior = (v: unknown): v is LabelBehavior => v === 'tag' || v === 'folder';

/** Valida un SEGMENTO de nombre (sin '/', ni comas, ni caracteres de control). Devuelve el nombre limpio o un error. */
export function validateSegment(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
    const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (!name) return { ok: false, error: 'El nombre es obligatorio' };
    if (name.length > MAX_LABEL_NAME) return { ok: false, error: `El nombre supera ${MAX_LABEL_NAME} caracteres` };
    if (/[\u0000-\u001f\u007f,]/.test(name)) return { ok: false, error: 'El nombre contiene caracteres no permitidos' };
    if (name.includes(PATH_SEPARATOR)) return { ok: false, error: 'El nombre no puede contener "/" (usa subetiquetas)' };
    if (name === '.' || name === '..') return { ok: false, error: 'Nombre no permitido' };
    return { ok: true, name };
}

/** "Trabajo/Proyecto A/" -> ['Trabajo','Proyecto A'] (segmentos vacios descartados). */
export function splitPath(full: string): string[] {
    return String(full ?? '').split(PATH_SEPARATOR).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
export const joinPath = (segments: string[]) => segments.join(PATH_SEPARATOR);

/** Ruta completa de una etiqueta a partir de la tabla por id (ciclos protegidos). */
export function pathOf(id: string, byId: Map<string, Pick<LabelRow, 'id' | 'name' | 'parentId'>>): string {
    const segs: string[] = [];
    const seen = new Set<string>();
    let cur = byId.get(id);
    while (cur && !seen.has(cur.id) && segs.length <= MAX_LABEL_DEPTH + 2) {
        seen.add(cur.id);
        segs.unshift(cur.name);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return joinPath(segs);
}

export function depthOf(id: string, byId: Map<string, Pick<LabelRow, 'id' | 'parentId'>>): number {
    let d = 0;
    const seen = new Set<string>();
    let cur = byId.get(id);
    while (cur && !seen.has(cur.id) && d <= MAX_LABEL_DEPTH + 2) {
        seen.add(cur.id);
        d++;
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return d;
}

export function descendantsOf(id: string, labels: Array<Pick<LabelRow, 'id' | 'parentId'>>): string[] {
    const kids = new Map<string, string[]>();
    for (const l of labels) if (l.parentId) kids.set(l.parentId, [...(kids.get(l.parentId) ?? []), l.id]);
    const out: string[] = [];
    const stack = [...(kids.get(id) ?? [])];
    const seen = new Set<string>([id]);
    while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        out.push(cur);
        stack.push(...(kids.get(cur) ?? []));
    }
    return out;
}

/** Altura del subarbol de `id` (1 = solo el nodo). */
export function subtreeHeight(id: string, labels: Array<Pick<LabelRow, 'id' | 'parentId'>>): number {
    const kids = new Map<string, string[]>();
    for (const l of labels) if (l.parentId) kids.set(l.parentId, [...(kids.get(l.parentId) ?? []), l.id]);
    const h = (n: string, seen: Set<string>): number => {
        if (seen.has(n)) return 0;
        seen.add(n);
        return 1 + Math.max(0, ...(kids.get(n) ?? []).map((k) => h(k, seen)));
    };
    return h(id, new Set());
}

export type MoveCheck = { ok: true } | { ok: false; code: 'cycle' | 'depth' | 'parent_missing' | 'self'; error: string };

/** Comprueba que mover `id` bajo `newParentId` (null = raiz) no crea ciclos ni supera la profundidad maxima. */
export function checkMove(labels: Array<Pick<LabelRow, 'id' | 'name' | 'parentId'>>, id: string, newParentId: string | null): MoveCheck {
    if (newParentId === null) return { ok: true };
    if (newParentId === id) return { ok: false, code: 'self', error: 'Una etiqueta no puede ser su propio padre' };
    const byId = new Map(labels.map((l) => [l.id, l]));
    if (!byId.has(newParentId)) return { ok: false, code: 'parent_missing', error: 'Etiqueta padre no encontrada' };
    if (descendantsOf(id, labels).includes(newParentId)) return { ok: false, code: 'cycle', error: 'No se puede mover una etiqueta dentro de sus propias subetiquetas' };
    const parentDepth = depthOf(newParentId, byId);
    if (parentDepth + subtreeHeight(id, labels) > MAX_LABEL_DEPTH) {
        return { ok: false, code: 'depth', error: `Profundidad maxima: ${MAX_LABEL_DEPTH} niveles` };
    }
    return { ok: true };
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }) : null;
const byOrderThenName = (a: LabelRow, b: LabelRow) =>
    (a.sortOrder - b.sortOrder) || (collator ? collator.compare(a.name, b.name) : a.name.localeCompare(b.name)) || a.id.localeCompare(b.id);

/** Arbol ordenado (sortOrder, nombre). Las etiquetas huerfanas (padre inexistente o ciclo) se muestran en la raiz. */
export function buildTree<T extends LabelRow>(labels: T[]): LabelTreeNode<T>[] {
    const byId = new Map(labels.map((l) => [l.id, l]));
    const kids = new Map<string | null, T[]>();
    for (const l of labels) {
        let p: string | null = l.parentId && byId.has(l.parentId) && l.parentId !== l.id ? l.parentId : null;
        // Rompe ciclos: si subiendo desde el padre se vuelve a l, va a la raiz.
        if (p) {
            const seen = new Set<string>([l.id]);
            let cur: string | null = p;
            while (cur) {
                if (seen.has(cur)) { p = null; break; }
                seen.add(cur);
                cur = byId.get(cur)?.parentId ?? null;
            }
        }
        kids.set(p, [...(kids.get(p) ?? []), l]);
    }
    const make = (l: T, depth: number): LabelTreeNode<T> => ({
        label: l, depth,
        children: [...(kids.get(l.id) ?? [])].sort(byOrderThenName).map((c) => make(c, depth + 1)),
    });
    return [...(kids.get(null) ?? [])].sort(byOrderThenName).map((l) => make(l, 1));
}

export interface FlatRow<T extends LabelRow = LabelRow> { node: LabelTreeNode<T>; hasChildren: boolean; expanded: boolean; posInSet: number; setSize: number; parentId: string | null }

/** Filas visibles (segun nodos expandidos) en orden de dibujo: base de la navegacion por teclado y de aria-level/posinset. */
export function flattenVisible<T extends LabelRow>(tree: LabelTreeNode<T>[], expanded: ReadonlySet<string>): FlatRow<T>[] {
    const out: FlatRow<T>[] = [];
    const walk = (nodes: LabelTreeNode<T>[], parentId: string | null) => {
        nodes.forEach((n, i) => {
            const open = expanded.has(n.label.id);
            out.push({ node: n, hasChildren: n.children.length > 0, expanded: open, posInSet: i + 1, setSize: nodes.length, parentId });
            if (open && n.children.length > 0) walk(n.children, n.label.id);
        });
    };
    walk(tree, null);
    return out;
}

/** Suma acumulada a los padres (aproximacion cliente; el servidor calcula hilos distintos exactos). */
export function rollupCounts(labels: Array<Pick<LabelRow, 'id' | 'parentId'>>, own: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const l of labels) out[l.id] = own[l.id] ?? 0;
    const byId = new Map(labels.map((l) => [l.id, l]));
    for (const l of labels) {
        const seen = new Set<string>([l.id]);
        let cur = l.parentId ? byId.get(l.parentId) : undefined;
        while (cur && !seen.has(cur.id)) {
            seen.add(cur.id);
            out[cur.id] += own[l.id] ?? 0;
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
    }
    return out;
}

/** Nombre de etiqueta a mostrar: el segmento; la ruta completa en el titulo/tooltip. */
export const labelTitle = (l: Pick<LabelRow, 'name' | 'fullPath'>) => l.fullPath || l.name;

/** Una ruta coincide con un filtro si es igual o desciende de el (sin distinguir mayusculas). */
export function pathMatchesFilter(path: string, filter: string, includeDescendants = true): boolean {
    const p = path.toLowerCase();
    const f = filter.toLowerCase();
    return p === f || (includeDescendants && p.startsWith(f + PATH_SEPARATOR));
}
