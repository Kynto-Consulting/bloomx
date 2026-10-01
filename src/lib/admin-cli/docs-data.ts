import { CLIENT_BUILTINS, publicCatalog, type CatalogEntry } from './catalog';
import { EXCLUDED } from './coverage';
import { LIMITS } from './exec';
import { LEVEL_DOCS } from '../admin-levels';
import { MAX_ACTIVE_TOKENS_PER_ADMIN } from './tokens';

/** Datos que consume la documentacion (/docs/admin-cli). Pura y serializable. */
export interface AdminCliDocsData {
    commands: CatalogEntry[];
    builtins: { name: string; summary: { es: string; en: string } }[];
    excluded: Record<string, { es: string; en: string }>;
    levels: { permission_level: number; es: { name: string; can: string }; en: { name: string; can: string } }[];
    limits: { maxLineBytes: number; maxOutputBytes: number; maxInputBytes: number; timeoutMs: number; perMinute: number; maxActiveTokens: number };
}

export function buildAdminCliDocsData(): AdminCliDocsData {
    return {
        commands: publicCatalog(),
        builtins: CLIENT_BUILTINS,
        excluded: EXCLUDED,
        levels: ([0, 1, 2, 3, 4] as const).map((l) => ({ permission_level: l, es: LEVEL_DOCS[l].es, en: LEVEL_DOCS[l].en })),
        limits: { maxLineBytes: LIMITS.maxLineBytes, maxOutputBytes: LIMITS.maxOutputBytes, maxInputBytes: LIMITS.maxInputBytes, timeoutMs: LIMITS.timeoutMs, perMinute: LIMITS.perMinute, maxActiveTokens: MAX_ACTIVE_TOKENS_PER_ADMIN },
    };
}
