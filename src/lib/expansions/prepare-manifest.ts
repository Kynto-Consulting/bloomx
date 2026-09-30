/**
 * Preparacion de un manifest para renderizar: migra el formato antiguo, valida el UI y aisla los errores.
 *
 *   validateManifest (manifest-schema)            -> si falla, NO se carga nada (status "invalid")
 *   normalizeMount + migrateManifestUi (ui-schema) -> formato antiguo (COLUMN, variant, className...) al kit; avisos
 *   validateManifestUi (ui-schema + expressions)   -> errores con ruta por mount/overlay
 *
 * Un mount cuyo UI tiene errores se sustituye por un componente interno `__EXTENSION_ERROR__` (el renderer pinta un
 * estado de error amable) y el resto de mounts de la extension siguen funcionando. Es PURO (sin React ni efectos):
 * quien lo llama decide como reportar los problemas (ver ExtensionLoader y client/error-log.ts).
 */
import { formatManifestIssues, normalizeMount, validateManifest, type ManifestIssue } from './manifest-schema';
import { migrateManifestUi, validateUi, type UiIssue } from './ui-schema';
import { checkExpression } from './expressions';

export interface PreparedProblem { scope: string; path: string; message: string }

export interface PreparedManifest {
    /** false = manifest invalido: no se monta nada. */
    ok: boolean;
    /** Manifest con el UI migrado (mounts normalizados); los mounts/overlays con errores llevan `__EXTENSION_ERROR__`. */
    template: any;
    /** Errores del manifest (estructura) o del UI. */
    errors: PreparedProblem[];
    /** Avisos de obsolescencia (className eliminado, COLUMN -> STACK...) y del schema. */
    warnings: PreparedProblem[];
    /** Numero de mounts/overlays sustituidos por un estado de error. */
    brokenCount: number;
}

const ERROR_TYPE = '__EXTENSION_ERROR__';

function errorNode(extensionId: string, issues: UiIssue[]) {
    return { type: ERROR_TYPE, props: { extensionId, issues: issues.slice(0, 12).map((issue) => ({ path: issue.path, message: issue.message })) } };
}

const fromManifest = (issues: ManifestIssue[], scope: string): PreparedProblem[] => issues.map((issue) => ({ scope, path: issue.path, message: issue.message }));
const fromUi = (issues: UiIssue[], scope: string): PreparedProblem[] => issues.map((issue) => ({ scope, path: issue.path, message: issue.message }));

export function prepareManifest(extensionId: string, template: any): PreparedManifest {
    if (!template || typeof template !== 'object' || Array.isArray(template)) {
        return { ok: false, template, errors: [{ scope: 'manifest', path: '$', message: 'El manifest debe ser un objeto JSON' }], warnings: [], brokenCount: 0 };
    }

    // Al CARGAR una extension ya publicada, los campos de catalogo (capturas, etiquetas...) solo avisan: /extensions los saniza al mostrarlos.
    const verdict = validateManifest(template, { lenientCatalog: true });
    if (!verdict.ok) {
        return { ok: false, template, errors: fromManifest(verdict.errors, 'manifest'), warnings: fromManifest(verdict.warnings, 'manifest'), brokenCount: 0 };
    }

    // Los tipos de componente del schema del manifest se DERIVAN de ui-schema: un 'componente desconocido' es un aviso real.
    const warnings: PreparedProblem[] = fromManifest(verdict.warnings, 'manifest');
    const errors: PreparedProblem[] = [];

    const normalized = { ...template, mounts: Array.isArray(template.mounts) ? template.mounts.map(normalizeMount) : template.mounts };
    const { ui: migrated, notices } = migrateManifestUi(normalized);
    warnings.push(...fromUi(notices, 'ui'));

    let brokenCount = 0;
    const check = (node: any, root: string, scope: string): { ok: boolean; issues: UiIssue[] } => {
        const result = validateUi(node, { root, checkExpression });
        warnings.push(...fromUi(result.warnings, scope));
        if (!result.ok) errors.push(...fromUi(result.errors, scope));
        return { ok: result.ok, issues: result.errors };
    };

    const mounts = Array.isArray(migrated.mounts)
        ? migrated.mounts.map((mount: any, index: number) => {
            if (!mount || typeof mount !== 'object' || !mount.component || typeof mount.component !== 'object') return mount;
            const result = check(mount.component, `mounts[${index}].component`, `mount:${mount.point ?? index}`);
            if (result.ok) return mount;
            brokenCount++;
            return { ...mount, component: errorNode(extensionId, result.issues) };
        })
        : migrated.mounts;

    let overlays = migrated.overlays;
    if (overlays && typeof overlays === 'object' && !Array.isArray(overlays)) {
        overlays = Object.fromEntries(Object.entries(overlays).map(([id, node]) => {
            const result = check(node, `overlays.${id}`, `overlay:${id}`);
            if (result.ok) return [id, node];
            brokenCount++;
            return [id, errorNode(extensionId, result.issues)];
        }));
    }

    return { ok: true, template: { ...migrated, mounts, overlays }, errors, warnings, brokenCount };
}

/** Texto corto de los problemas (logs). */
export function describeProblems(problems: PreparedProblem[], max = 5): string {
    return formatManifestIssues(problems.map((p) => ({ path: p.path, message: p.message })), max);
}

// Cache por identidad del objeto `template` (SWR devuelve el mismo objeto mientras no cambia) y, como respaldo,
// por huella del contenido: editar un manifest sin cambiar la version (desarrollo) vuelve a prepararlo.
const byObject = new WeakMap<object, PreparedManifest>();
const byFingerprint = new Map<string, PreparedManifest>();

function fingerprint(extensionId: string, template: any): string {
    let text = '';
    try { text = JSON.stringify(template) ?? ''; } catch { text = String(Math.random()); }
    let hash = 5381;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    return `${extensionId}@${template?.version ?? ''}:${text.length}:${hash}`;
}

export function getPreparedManifest(extensionId: string, template: any): PreparedManifest {
    if (template && typeof template === 'object') {
        const cached = byObject.get(template);
        if (cached) return cached;
    }
    const key = fingerprint(extensionId, template);
    let prepared = byFingerprint.get(key);
    if (!prepared) {
        prepared = prepareManifest(extensionId, template);
        if (byFingerprint.size > 200) byFingerprint.clear();
        byFingerprint.set(key, prepared);
    }
    if (template && typeof template === 'object') byObject.set(template, prepared);
    return prepared;
}
