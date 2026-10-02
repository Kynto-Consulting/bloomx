/**
 * Archivos de una extension en el editor del portal: clasificacion por nombre, limites de tamano (espejo de `limits` del overview) y lectura
 * en el navegador. Puro salvo readSlot (usa FileReader/File). El backend vuelve a validar todo: esto solo da respuesta inmediata.
 */

export type SlotId = 'manifest' | 'serverJs' | 'readme' | 'icon';
export const SLOTS: readonly SlotId[] = ['manifest', 'serverJs', 'readme', 'icon'];

/** Respaldo si `limits` del overview no trae README/icono (el backend los publica como maxReadmeBytes / maxIconBytes); coinciden con los topes del proxy. */
export const CLIENT_LIMITS = { maxReadmeBytes: 200 * 1024, maxIconBytes: 400 * 1024 } as const;

export interface DevLimits { maxServerBytes: number; maxManifestBytes: number; maxIconBytes?: number; maxReadmeBytes?: number }

export function slotForFileName(name: string): SlotId | null {
    const n = name.trim().toLowerCase();
    if (n === 'manifest.json') return 'manifest';
    if (n === 'server.js') return 'serverJs';
    if (n === 'readme.md') return 'readme';
    if (/^[^/\\]+\.(png|svg|webp)$/.test(n)) return 'icon';
    return null;
}

export function limitFor(slot: SlotId, limits: DevLimits): number {
    switch (slot) {
        case 'manifest': return limits.maxManifestBytes;
        case 'serverJs': return limits.maxServerBytes;
        case 'readme': return limits.maxReadmeBytes ?? CLIENT_LIMITS.maxReadmeBytes;
        case 'icon': return limits.maxIconBytes ?? CLIENT_LIMITS.maxIconBytes;
    }
}

export function withinLimit(bytes: number, slot: SlotId, limits: DevLimits): boolean {
    return Number.isFinite(bytes) && bytes >= 0 && bytes <= limitFor(slot, limits);
}

export interface LoadedFile { name: string; bytes: number; content: string }
export type FileState = Partial<Record<SlotId, LoadedFile>>;

export function toPayload(files: FileState): { manifest: string; serverJs?: string; readme?: string; icon?: string } | null {
    if (!files.manifest) return null;
    return {
        manifest: files.manifest.content,
        ...(files.serverJs ? { serverJs: files.serverJs.content } : {}),
        ...(files.readme ? { readme: files.readme.content } : {}),
        ...(files.icon ? { icon: files.icon.content } : {}),
    };
}

/** id y version declarados en el manifest (para rellenar el formulario); null si no es JSON valido. */
export function manifestHints(text: string): { id: string | null; version: string | null } {
    try {
        const m = JSON.parse(text);
        return {
            id: typeof m?.id === 'string' && m.id.length <= 200 ? m.id : null,
            version: typeof m?.version === 'string' && m.version.length <= 64 ? m.version : null,
        };
    } catch {
        return { id: null, version: null };
    }
}

/** Lee el archivo en el navegador: texto para manifest/server/readme y data URL para el icono. */
export function readSlot(file: File, slot: SlotId): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('read_failed'));
        reader.onload = () => resolve(String(reader.result ?? ''));
        if (slot === 'icon') reader.readAsDataURL(file);
        else reader.readAsText(file);
    });
}

export function formatBytesShort(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round((bytes / 1024) * 10) / 10} KB`;
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}
