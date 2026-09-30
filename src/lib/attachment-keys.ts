import { randomBytes } from 'crypto';

// Claves de almacenamiento para adjuntos entrantes: unicas aunque haya varios adjuntos con el mismo nombre.
// (Antes `.../attachments/${filename}` sobrescribia el objeto anterior; ISO 27001:2022 A.8.10, integridad de datos.)

/** Nombre seguro para usar dentro de una clave (sin separadores, sin control, longitud acotada, conserva extension). */
export function sanitizeKeyFilename(filename: string, fallback = 'attachment'): string {
    let name = String(filename || '')
        .normalize('NFC')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[\\/]+/g, '_')
        .replace(/\.{2,}/g, '.')
        .trim();
    name = name.replace(/^\.+/, '');
    if (!name) name = fallback;
    if (name.length > 150) {
        const dot = name.lastIndexOf('.');
        const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
        name = name.slice(0, 150 - ext.length) + ext;
    }
    return name;
}

/**
 * Devuelve una clave `${prefix}/${nombre}` que no esta en `used` (y la registra). Si el nombre ya se uso, anade un
 * sufijo unico corto antes de la extension: `foto-3fa9c2d1.jpg`. `used` se compara sin distinguir mayusculas.
 */
export function uniqueAttachmentKey(prefix: string, filename: string, used: Set<string>): string {
    const base = sanitizeKeyFilename(filename);
    const clean = prefix.replace(/\/+$/, '');
    let key = `${clean}/${base}`;
    if (used.has(key.toLowerCase())) {
        const dot = base.lastIndexOf('.');
        const stem = dot > 0 ? base.slice(0, dot) : base;
        const ext = dot > 0 ? base.slice(dot) : '';
        do {
            key = `${clean}/${stem}-${randomBytes(4).toString('hex')}${ext}`;
        } while (used.has(key.toLowerCase()));
    }
    used.add(key.toLowerCase());
    return key;
}

/** Prefijo `emails/<fecha>/<uuid>` de cualquier clave de un correo entrante (para barrer el "directorio" al borrar). */
export function inboundEmailPrefix(key: string | null | undefined): string | null {
    const m = /^(emails\/[^/]+\/[^/]+)\//.exec(String(key || ''));
    return m ? m[1] : null;
}
