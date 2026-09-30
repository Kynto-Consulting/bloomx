/**
 * Funciones PURAS (sin React, sin fetch, sin servidor) de la seccion Extensiones de la consola:
 * semver, categoria, permisos legibles + riesgo, funcion de prueba, campos de SETTINGS_PANEL, resumen acotado del manifest
 * y orden. Las comparten el servidor (proxy del catalogo), la UI y los tests.
 */
import { describePermissions, KNOWN_MOUNT_POINTS, type PermissionRisk } from '@/lib/expansions/manifest-schema';

export type Json = Record<string, any>;

export function parseTemplate(template: unknown): Json | null {
    if (typeof template === 'string') {
        try {
            const parsed = JSON.parse(template);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }
    return template && typeof template === 'object' && !Array.isArray(template) ? (template as Json) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// semver
// ---------------------------------------------------------------------------------------------------------------------
const SEMVER_RE = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]{1,40}))?(?:\+[0-9A-Za-z.-]{1,40})?$/;

export interface Semver {
    major: number;
    minor: number;
    patch: number;
    pre: string[];
}

export function parseSemver(value: unknown): Semver | null {
    if (typeof value !== 'string') return null;
    const m = SEMVER_RE.exec(value.trim());
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

function comparePre(a: string[], b: string[]): number {
    // Sin pre-release > con pre-release (1.0.0 > 1.0.0-beta).
    if (a.length === 0 && b.length === 0) return 0;
    if (a.length === 0) return 1;
    if (b.length === 0) return -1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i];
        const y = b[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        const xn = /^\d+$/.test(x);
        const yn = /^\d+$/.test(y);
        if (xn && yn) {
            const d = Number(x) - Number(y);
            if (d !== 0) return d < 0 ? -1 : 1;
        } else if (xn !== yn) {
            return xn ? -1 : 1; // numerico < alfanumerico
        } else if (x !== y) {
            return x < y ? -1 : 1;
        }
    }
    return 0;
}

/** -1 / 0 / 1, o null si alguna version no es semver valido (nunca lanza). */
export function compareSemver(a: unknown, b: unknown): -1 | 0 | 1 | null {
    const x = parseSemver(a);
    const y = parseSemver(b);
    if (!x || !y) return null;
    for (const k of ['major', 'minor', 'patch'] as const) {
        if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
    }
    const pre = comparePre(x.pre, y.pre);
    return pre < 0 ? -1 : pre > 0 ? 1 : 0;
}

/** Hay actualizacion si la version del catalogo es ESTRICTAMENTE mayor. Versiones invalidas o ausentes => false. */
export function hasUpdate(installed: unknown, catalog: unknown): boolean {
    return compareSemver(installed, catalog) === -1;
}

// ---------------------------------------------------------------------------------------------------------------------
// Categoria
// ---------------------------------------------------------------------------------------------------------------------
export const CATEGORIES = ['mail', 'calendar', 'contacts', 'ai', 'integrations', 'productivity', 'security', 'other'] as const;
export type ExtensionCategory = (typeof CATEGORIES)[number];

const CATEGORY_ALIASES: Record<string, ExtensionCategory> = {
    mail: 'mail', email: 'mail', correo: 'mail', communication: 'mail', communications: 'mail',
    calendar: 'calendar', calendario: 'calendar', meetings: 'calendar', meeting: 'calendar',
    contacts: 'contacts', contactos: 'contacts', crm: 'contacts',
    ai: 'ai', ia: 'ai', 'artificial-intelligence': 'ai',
    integrations: 'integrations', integration: 'integrations', integraciones: 'integrations', storage: 'integrations',
    productivity: 'productivity', productividad: 'productivity', tools: 'productivity', utilities: 'productivity',
    security: 'security', seguridad: 'security', compliance: 'security',
};

function mountPoints(template: Json | null): string[] {
    const mounts = Array.isArray(template?.mounts) ? template!.mounts : [];
    return mounts.map((m: any) => (m && typeof m.point === 'string' ? m.point : null)).filter((p: string | null): p is string => !!p);
}

/**
 * Categoria de una extension: `template.category` si es conocida; si no, se deriva de permisos y puntos de montaje
 * (calendario > contactos > IA > correo > integraciones > otra).
 */
export function deriveCategory(template: unknown): ExtensionCategory {
    const t = parseTemplate(template);
    if (!t) return 'other';
    const explicit = typeof t.category === 'string' ? CATEGORY_ALIASES[t.category.trim().toLowerCase()] : undefined;
    if (explicit) return explicit;

    const permissions: string[] = Array.isArray(t.permissions) ? t.permissions.filter((p: unknown): p is string => typeof p === 'string') : [];
    const points = mountPoints(t);
    const intercepts: any[] = [...(Array.isArray(t.intercepts) ? t.intercepts : []), ...(Array.isArray(t.hooks) ? t.hooks : [])];
    const has = (re: RegExp) => permissions.some((p) => re.test(p));
    const onPoint = (re: RegExp) => points.some((p) => re.test(p));

    if (has(/^CALENDAR_/) || onPoint(/^(CALENDAR_|EVENT_LOCATION)/) || intercepts.some((i) => /^CALENDAR_/.test(String(i?.point)))) return 'calendar';
    if (has(/^CONTACTS?_/) || onPoint(/^CONTACT/) || intercepts.some((i) => /^CONTACT_/.test(String(i?.point)))) return 'contacts';
    if (has(/^AI_GENERATE$/)) return 'ai';
    if (has(/^(READ_EMAIL|MAIL_LABEL)$/) || onPoint(/^(EMAIL_|COMPOSER_|SIDEBAR_|CONTEXT_MENU|SLASH_COMMAND)/) || intercepts.some((i) => /^EMAIL_/.test(String(i?.point)))) return 'mail';
    const authType = String(t.auth?.type || '').toUpperCase();
    if (has(/^(HTTP_REQUEST|OAUTH_READ|OAUTH_WRITE)$/) || (authType && authType !== 'NONE')) return 'integrations';
    return 'other';
}

// ---------------------------------------------------------------------------------------------------------------------
// Funcion de prueba (testConnection)
// ---------------------------------------------------------------------------------------------------------------------
const HANDLER_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

/** Nombre de la accion de prueba que declara el manifest, o null. `template.testConnection` puede ser `true` o el nombre. */
export function testConnectionAction(template: unknown): string | null {
    const t = parseTemplate(template);
    if (!t) return null;
    const fns = t.api?.functions;
    if (fns && typeof fns === 'object' && !Array.isArray(fns) && Object.prototype.hasOwnProperty.call(fns, 'testConnection')) return 'testConnection';
    const declared = t.testConnection;
    if (declared === true) return 'testConnection';
    if (typeof declared === 'string' && HANDLER_RE.test(declared)) {
        // Un nombre explicito solo vale si existe como funcion declarada (o no hay lista de funciones que contradecirlo).
        if (fns && typeof fns === 'object' && !Object.prototype.hasOwnProperty.call(fns, declared)) return null;
        return declared;
    }
    return null;
}

export function declaresTestConnection(template: unknown): boolean {
    return testConnectionAction(template) !== null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Permisos legibles y riesgo
// ---------------------------------------------------------------------------------------------------------------------
const RISK_ORDER: Record<PermissionRisk, number> = { high: 0, medium: 1, low: 2 };

export function overallRisk(template: unknown): PermissionRisk {
    const items = describePermissions(parseTemplate(template)?.permissions);
    if (items.some((i) => i.risk === 'high')) return 'high';
    if (items.some((i) => i.risk === 'medium')) return 'medium';
    return 'low';
}

/** Permisos ordenados de mayor a menor riesgo (estable dentro de cada nivel). */
export function permissionsByRisk(template: unknown) {
    return describePermissions(parseTemplate(template)?.permissions)
        .map((p, index) => ({ p, index }))
        .sort((a, b) => RISK_ORDER[a.p.risk] - RISK_ORDER[b.p.risk] || a.index - b.index)
        .map(({ p }) => p);
}

export function riskCounts(template: unknown): Record<PermissionRisk, number> {
    const counts: Record<PermissionRisk, number> = { high: 0, medium: 0, low: 0 };
    for (const p of describePermissions(parseTemplate(template)?.permissions)) counts[p.risk] += 1;
    return counts;
}

// ---------------------------------------------------------------------------------------------------------------------
// SETTINGS_PANEL: campos declarados
// ---------------------------------------------------------------------------------------------------------------------
export interface SettingsField {
    /** Nombre/clave del campo (props.name | key | id | bind). */
    name: string;
    type: string;
    label: string;
    defaultValue: string | null;
}

const FIELD_TYPES = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'SWITCH', 'CHECKBOX', 'TOGGLE', 'SLIDER', 'DATE_PICKER', 'FILE_UPLOAD']);
const MAX_FIELDS = 50;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null);

/** Campos de formulario del componente del mount SETTINGS_PANEL (recorrido acotado). Solo LECTURA del esquema. */
export function extractSettingsFields(template: unknown): SettingsField[] {
    const t = parseTemplate(template);
    const mounts: any[] = Array.isArray(t?.mounts) ? t!.mounts : [];
    const fields: SettingsField[] = [];
    let visited = 0;
    const walk = (node: any, depth: number) => {
        if (!node || typeof node !== 'object' || depth > 12 || visited++ > 500 || fields.length >= MAX_FIELDS) return;
        const type = typeof node.type === 'string' ? node.type.toUpperCase() : '';
        const props = node.props && typeof node.props === 'object' ? node.props : {};
        if (FIELD_TYPES.has(type)) {
            const name = str(props.name ?? props.key ?? props.bind ?? props.id, 80);
            if (name) {
                fields.push({
                    name,
                    type,
                    label: str(props.label ?? props.title ?? props.placeholder, 120) ?? name,
                    defaultValue: str(props.defaultValue ?? props.default ?? props.value, 120),
                });
            }
        }
        const children = Array.isArray(node.children) ? node.children : [];
        for (const child of children) walk(child, depth + 1);
    };
    for (const mount of mounts) {
        if (mount?.point === 'SETTINGS_PANEL' && mount.component) walk(mount.component, 0);
    }
    return fields;
}

export function declaresSettingsPanel(template: unknown): boolean {
    const t = parseTemplate(template);
    return (Array.isArray(t?.mounts) ? t!.mounts : []).some((m: any) => m?.point === 'SETTINGS_PANEL');
}

// ---------------------------------------------------------------------------------------------------------------------
// Resumen ACOTADO del manifest (lo unico que el proxy del catalogo entrega al navegador)
// ---------------------------------------------------------------------------------------------------------------------
export interface ManifestSummary {
    id?: string;
    name?: string;
    description?: string;
    version?: string;
    manifestVersion?: string;
    category?: string;
    permissions?: string[];
    auth?: { type?: string; provider?: string; scopes?: string[] };
    /** Puntos de montaje declarados (sin componentes). */
    mounts?: { point: string }[];
    api?: { functions: Record<string, Record<string, never>> };
    testConnection?: string | true;
    settingsFields?: SettingsField[];
    intercepts?: { point: string }[];
    /** El manifest se declara OBLIGATORIA para todos los usuarios (`mandatory: true`). */
    mandatory?: boolean;
}

const short = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const MOUNT_POINT_SET = new Set(KNOWN_MOUNT_POINTS);

/** Recorta un manifest a los campos que la UI necesita. Sin componentes, sin URLs, sin valores de configuracion. */
export function summarizeTemplate(template: unknown): ManifestSummary | null {
    const t = parseTemplate(template);
    if (!t) return null;
    const out: ManifestSummary = {};
    const assign = <K extends keyof ManifestSummary>(key: K, value: ManifestSummary[K] | undefined) => {
        if (value !== undefined) out[key] = value;
    };
    assign('id', short(t.id, 200));
    assign('name', short(t.name, 200));
    assign('description', short(t.description, 1000));
    assign('version', short(t.version, 40));
    assign('manifestVersion', short(t.manifestVersion, 10));
    assign('category', short(t.category, 40));
    if (t.mandatory === true) out.mandatory = true;
    if (Array.isArray(t.permissions)) {
        assign('permissions', t.permissions.filter((p: unknown): p is string => typeof p === 'string' && p.length <= 100).slice(0, 60));
    }
    if (t.auth && typeof t.auth === 'object') {
        out.auth = {
            ...(short(t.auth.type, 30) ? { type: short(t.auth.type, 30) } : {}),
            ...(short(t.auth.provider, 60) ? { provider: short(t.auth.provider, 60) } : {}),
            ...(Array.isArray(t.auth.scopes) ? { scopes: t.auth.scopes.filter((s: unknown): s is string => typeof s === 'string').map((s: string) => s.slice(0, 200)).slice(0, 30) } : {}),
        };
    }
    const points = mountPoints(t);
    if (points.length) out.mounts = Array.from(new Set(points)).slice(0, 60).map((point) => ({ point: point.slice(0, 60) }));
    const fns = t.api?.functions;
    if (fns && typeof fns === 'object' && !Array.isArray(fns)) {
        out.api = { functions: Object.fromEntries(Object.keys(fns).filter((k) => HANDLER_RE.test(k)).slice(0, 60).map((k) => [k, {}])) };
    }
    const test = testConnectionAction(t);
    if (test) out.testConnection = test === 'testConnection' ? true : test;
    const fields = extractSettingsFields(t);
    if (fields.length) out.settingsFields = fields;
    if (declaresSettingsPanel(t) && !fields.length) out.settingsFields = [];
    const intercepts: any[] = [...(Array.isArray(t.intercepts) ? t.intercepts : []), ...(Array.isArray(t.hooks) ? t.hooks : [])];
    const ipoints = intercepts.map((i) => short(i?.point, 60)).filter((p): p is string => !!p);
    if (ipoints.length) out.intercepts = Array.from(new Set(ipoints)).slice(0, 30).map((point) => ({ point }));
    return out;
}

/** Puntos de montaje y si son conocidos (para la traduccion: los desconocidos se muestran tal cual). */
export function describeMounts(template: unknown): { point: string; known: boolean }[] {
    return mountPoints(parseTemplate(template)).filter((p, i, arr) => arr.indexOf(p) === i).map((point) => ({ point, known: MOUNT_POINT_SET.has(point) }));
}

export function declaredFunctions(template: unknown): string[] {
    const fns = parseTemplate(template)?.api?.functions;
    return fns && typeof fns === 'object' && !Array.isArray(fns) ? Object.keys(fns) : [];
}

// ---------------------------------------------------------------------------------------------------------------------
// Orden
// ---------------------------------------------------------------------------------------------------------------------
export const ORDER_STEP = 10;

export interface Orderable {
    id: string;
    name: string;
    order?: number | null;
}

/** Orden estable: por `order` numerico (los sin orden van al final) y luego por nombre. */
export function sortByOrder<T extends Orderable>(items: readonly T[]): T[] {
    return [...items].sort((a, b) => {
        const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
        const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
        return ao - bo || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
}

/** Mueve un elemento una posicion (-1 sube, +1 baja). Devuelve la lista nueva, o la misma si no se puede mover. */
export function moveItem<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
    const to = index + delta;
    if (index < 0 || index >= items.length || to < 0 || to >= items.length) return [...items];
    const next = [...items];
    [next[index], next[to]] = [next[to], next[index]];
    return next;
}

/** Orden normalizado (0, 10, 20...) para enviar al backend tras reordenar la lista. */
export function normalizedOrders(ids: readonly string[]): { extensionId: string; order: number }[] {
    return ids.map((extensionId, i) => ({ extensionId, order: i * ORDER_STEP }));
}
