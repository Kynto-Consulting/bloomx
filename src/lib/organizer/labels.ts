/**
 * Etiquetas del Organizer localizadas (solo para MOSTRAR).
 *
 * La clave interna es estable: el nombre en ingles con el que el Organizer crea la etiqueta (Label.name), que tambien
 * usan las URL, los filtros y las reglas. Aqui solo se traduce lo que ve el usuario; nunca se renombra ni se toca la BD,
 * asi que las etiquetas ya creadas siguen funcionando igual. Una etiqueta cuyo nombre no coincide (p. ej. renombrada por
 * el usuario) se muestra tal cual.
 */
export const ORGANIZER_LABEL_KEYS: Record<string, string> = {
    work: 'work',
    personal: 'personal',
    newsletters: 'newsletter',
    notifications: 'notification',
    finance: 'finance',
    social: 'social',
};

/** Clave i18n `organizer.labels.<cat>` si `name` es una etiqueta del Organizer; si no, null. */
export function organizerLabelKey(name: string | null | undefined): string | null {
    const cat = ORGANIZER_LABEL_KEYS[String(name ?? '').trim().toLowerCase()];
    return cat ? `organizer.labels.${cat}` : null;
}

/** Nombre a mostrar: traducido si es una etiqueta del Organizer, el nombre original en otro caso. */
export function labelDisplayName(name: string, t: (key: string) => string): string {
    const key = organizerLabelKey(name);
    return key ? t(key) : name;
}
