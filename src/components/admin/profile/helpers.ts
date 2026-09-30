import { ApiError, apiErrorKey } from '@/components/admin/console';

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Mensaje traducido para un error de API: primero la clave `admin.console.profile.<ns>.errors.<code>` (codigo estable
 * de la ruta), si no existe el mensaje generico por estado HTTP (admin.console.common.errors.*).
 */
export function errorText(t: T, error: unknown, ns: string): string {
    if (error instanceof ApiError && error.code) {
        const key = `admin.console.profile.${ns}.errors.${error.code}`;
        const v = t(key);
        if (v !== key) return v;
    }
    return t(apiErrorKey(error));
}

export function errorCode(error: unknown): string | undefined {
    return error instanceof ApiError ? error.code : undefined;
}

/** Copia texto al portapapeles (best-effort). Devuelve si se pudo. */
export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

/** Descarga un texto como archivo (best-effort, sin red). */
export function downloadText(filename: string, text: string): void {
    try {
        const href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = href;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
        /* sin soporte de descarga */
    }
}
