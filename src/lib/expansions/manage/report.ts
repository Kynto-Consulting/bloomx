/**
 * Informe de errores de extensiones en texto plano para pegar en una incidencia (PURO).
 * No incluye datos personales: se redactan correos, URLs con parametros y cadenas largas tipo token.
 */
import type { ExtensionErrorEntry } from '@/lib/expansions/client/error-log';

export interface ReportExtension { id: string; name?: string; version?: string | null }

/** Quita de un mensaje lo que podria identificar a una persona o dar acceso. */
export function redactMessage(text: string): string {
    return String(text)
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[email]')
        .replace(/\bhttps?:\/\/[^\s"'<>)]+/gi, (url) => { try { const u = new URL(url); return `${u.origin}${u.pathname === '/' ? '' : u.pathname}`; } catch { return '[url]'; } })
        .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
        .slice(0, 500);
}

export function formatErrorReport(input: { extensions: ReportExtension[]; errors: readonly ExtensionErrorEntry[]; generatedAt?: number; app?: string }): string {
    const at = input.generatedAt ?? Date.now();
    const lines: string[] = [];
    lines.push(`Informe de errores de extensiones${input.app ? ` - ${input.app}` : ''}`);
    lines.push(`Generado: ${new Date(at).toISOString()}`);
    const ids = Array.from(new Set(input.errors.map((e) => e.extensionId)));
    if (ids.length === 0) { lines.push('', 'Sin errores registrados.'); return lines.join('\n'); }
    for (const id of ids) {
        const ext = input.extensions.find((e) => e.id === id);
        const list = input.errors.filter((e) => e.extensionId === id);
        lines.push('', `Extension: ${ext?.name ? `${ext.name} (${id})` : id}`, `Version: ${ext?.version || 'desconocida'}`, `Errores: ${list.length}`);
        list.forEach((e, index) => {
            lines.push(`  ${index + 1}. [${e.kind}]${e.path ? ` ${e.path}` : ''} - ${redactMessage(e.message)} (x${e.count}, ultima vez ${new Date(e.at).toISOString()})`);
        });
    }
    return lines.join('\n');
}
