import { normalizeMount } from '@/lib/expansions/manifest-schema';

/**
 * Comandos con barra ("/") del editor de correo, declarados por las extensiones instaladas en
 * `manifest.slashCommands[]` ({ key, description, arguments?, action }).
 *
 * Todo lo puro vive aqui (parseo del texto, filtrado, teclado y construccion desde manifests) para poder probarlo
 * sin TipTap ni DOM. El editor (Editor.tsx) solo conecta esto con ProseMirror y `SlashMenu.tsx` lo pinta.
 */

export interface SlashCommand {
    key: string;
    description: string;
    /** Pista de argumentos, p. ej. "Event Title". */
    arguments?: string;
    extensionId?: string;
    extensionName?: string;
    /** Accion declarativa del manifest (la ejecuta SlashActionRunner con JsonRenderer). */
    action?: unknown;
    /** Ejecuta el comando; `args` es el texto escrito tras la clave. */
    execute?: (args: string) => void;
}

export interface SlashInput {
    /** Texto tras "/" y antes del primer espacio. */
    query: string;
    /** Texto tras la clave (solo si la clave es un comando exacto). */
    args: string;
    /** `query` coincide exactamente con una clave (sin distinguir mayusculas). */
    exactMatch: boolean;
    /** Desplazamiento de la "/" dentro de `textBefore`. */
    start: number;
}

const SLASH_RE = /(?:^|\s)\/([a-zA-Z0-9_-]*)(?:\s+(.*))?$/;
export const SLASH_KEY_RE = /^[a-zA-Z0-9_-]{1,32}$/;

/**
 * Detecta un comando en el texto de la linea hasta el cursor.
 * "/tr" y "/" abren el menu; "/translate algo" solo si `translate` existe (los argumentos solo tienen sentido
 * para un comando real: "1 / 2" o "and / or" no deben abrir el menu ni robar el Enter).
 */
export function parseSlashInput(textBefore: string, commands: readonly Pick<SlashCommand, 'key'>[]): SlashInput | null {
    const match = SLASH_RE.exec(textBefore);
    if (!match) return null;

    const query = match[1];
    const hasArgsPart = match[2] !== undefined;
    const exact = commands.some((c) => c.key.toLowerCase() === query.toLowerCase());
    if (hasArgsPart && !exact) return null;

    const start = match.index + (match[0].startsWith('/') ? 0 : 1);
    return { query, args: match[2] ?? '', exactMatch: exact, start };
}

/** Comandos cuya clave empieza por la consulta o cuya descripcion la contiene (claves primero). */
export function filterSlashCommands<T extends Pick<SlashCommand, 'key' | 'description'>>(commands: readonly T[], query: string): T[] {
    const q = query.toLowerCase();
    if (!q) return [...commands];
    const byKey = commands.filter((c) => c.key.toLowerCase().startsWith(q));
    const byDescription = commands.filter((c) => !c.key.toLowerCase().startsWith(q) && String(c.description || '').toLowerCase().includes(q));
    return [...byKey, ...byDescription];
}

export type SlashKeyAction =
    | { type: 'none' }
    | { type: 'move'; index: number }
    | { type: 'execute'; index: number }
    | { type: 'complete'; index: number }
    | { type: 'close' };

/**
 * Decide que hace una tecla con el menu abierto.
 * - Modo lista (varios candidatos): flechas navegan (con vuelta), Enter ejecuta, Tab completa la clave, Esc cierra.
 * - Modo comando exacto (se estan escribiendo argumentos): solo Enter ejecuta y Esc cierra; el resto pasa al editor.
 * - Sin candidatos: nada se intercepta (Enter inserta un salto de linea normal), salvo Esc.
 */
export function slashKeyAction(key: string, state: { exactMatch: boolean; count: number; index: number }): SlashKeyAction {
    const { exactMatch, count, index } = state;
    if (key === 'Escape') return { type: 'close' };

    if (exactMatch) {
        return key === 'Enter' && count > 0 ? { type: 'execute', index: Math.min(index, count - 1) } : { type: 'none' };
    }
    if (count === 0) return { type: 'none' };

    switch (key) {
        case 'ArrowDown': return { type: 'move', index: (index + 1) % count };
        case 'ArrowUp': return { type: 'move', index: (index - 1 + count) % count };
        case 'Home': return { type: 'move', index: 0 };
        case 'End': return { type: 'move', index: count - 1 };
        case 'Enter': return { type: 'execute', index };
        case 'Tab': return { type: 'complete', index };
        default: return { type: 'none' };
    }
}

function parseTemplate(template: unknown): any {
    if (typeof template === 'string') {
        try {
            return JSON.parse(template);
        } catch {
            return null;
        }
    }
    return template && typeof template === 'object' ? template : null;
}

/**
 * Comandos de todas las extensiones instaladas y no deshabilitadas. Se descartan (sin romper el resto):
 * claves invalidas, sin descripcion o sin accion. Si dos extensiones declaran la misma clave gana la primera
 * (orden de instalacion) y la repetida se ignora, para que "/hr" nunca sea ambiguo.
 */
export function collectSlashCommands(extensions: readonly any[] | null | undefined): SlashCommand[] {
    const out: SlashCommand[] = [];
    const seen = new Set<string>();
    for (const extension of extensions ?? []) {
        const template = parseTemplate(extension?.template);
        if (!template || template.status === 'disabled' || !Array.isArray(template.slashCommands)) continue;
        const extensionId = String(template.id || extension?.id || '').trim();
        if (!extensionId) continue;

        for (const raw of template.slashCommands) {
            if (!raw || typeof raw !== 'object') continue;
            if (typeof raw.key !== 'string' || !SLASH_KEY_RE.test(raw.key)) continue;
            if (typeof raw.description !== 'string' || !raw.action || typeof raw.action !== 'object') continue;
            const id = raw.key.toLowerCase();
            if (seen.has(id)) continue;
            seen.add(id);
            out.push({
                key: raw.key,
                description: raw.description,
                arguments: typeof raw.arguments === 'string' ? raw.arguments : undefined,
                extensionId,
                extensionName: typeof template.name === 'string' ? template.name : undefined,
                action: raw.action,
            });
        }
    }
    return out;
}

/** Overlays declarados por la extension (mounts OVERLAY + `overlays`), para OPEN_OVERLAY desde un comando. */
export function collectOverlays(extension: any): Record<string, any> {
    const template = parseTemplate(extension?.template);
    const overlays: Record<string, any> = { ...(template?.overlays || {}) };
    for (const mount of Array.isArray(template?.mounts) ? template.mounts : []) {
        if (mount?.point !== 'OVERLAY') continue;
        const normalized = normalizeMount(mount);
        if (typeof normalized?.id === 'string' && normalized.component) overlays[normalized.id] = normalized.component;
    }
    return overlays;
}
