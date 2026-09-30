/**
 * contact-notes.ts - el modelo Contact solo guarda email/name/notes: telefonos, organizacion, cargo, direcciones, cumpleanos
 * y webs se serializan en `notes` como un bloque final de lineas "Etiqueta: valor" (formato estable, legible para el usuario).
 *
 *   <notas libres>
 *   <linea en blanco>
 *   Teléfono: +34 600 000 000
 *   Organización: Acme
 *   Cargo: CEO
 *   Dirección: Calle Sol 1, Madrid
 *   Cumpleaños: 1990-05-17
 *   Web: https://example.test
 *
 * El bloque se reconoce solo si es la ULTIMA parte del texto y va precedido de una linea en blanco (o es todo el texto).
 */
import type { PimContact } from './vcard';

export const NOTE_LABELS = {
    phones: 'Teléfono',
    org: 'Organización',
    title: 'Cargo',
    addresses: 'Dirección',
    birthday: 'Cumpleaños',
    urls: 'Web',
} as const;

const LINE_RE = /^(Teléfono|Organización|Cargo|Dirección|Cumpleaños|Web): (.+)$/;
export const MAX_NOTES = 20_000;

type Details = Pick<PimContact, 'notes' | 'phones' | 'org' | 'title' | 'addresses' | 'birthday' | 'urls'>;

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function encodeContactNotes(c: Details): string | null {
    const lines: string[] = [];
    for (const p of c.phones) if (oneLine(p)) lines.push(`${NOTE_LABELS.phones}: ${oneLine(p)}`);
    if (c.org && oneLine(c.org)) lines.push(`${NOTE_LABELS.org}: ${oneLine(c.org)}`);
    if (c.title && oneLine(c.title)) lines.push(`${NOTE_LABELS.title}: ${oneLine(c.title)}`);
    for (const a of c.addresses) if (oneLine(a)) lines.push(`${NOTE_LABELS.addresses}: ${oneLine(a)}`);
    if (c.birthday && oneLine(c.birthday)) lines.push(`${NOTE_LABELS.birthday}: ${oneLine(c.birthday)}`);
    for (const u of c.urls) if (oneLine(u)) lines.push(`${NOTE_LABELS.urls}: ${oneLine(u)}`);
    const free = (c.notes ?? '').replace(/\r\n?/g, '\n').trim();
    const out = [free, lines.join('\n')].filter(Boolean).join('\n\n');
    return out ? out.slice(0, MAX_NOTES) : null;
}

export function decodeContactNotes(notes: string | null | undefined): Details {
    const res: Details = { notes: null, phones: [], org: null, title: null, addresses: [], birthday: null, urls: [] };
    const text = String(notes ?? '').replace(/\r\n?/g, '\n');
    if (!text.trim()) return res;
    const lines = text.split('\n');
    let i = lines.length;
    while (i > 0 && !lines[i - 1].trim()) i--; // ignora blancos finales
    let start = i;
    while (start > 0 && LINE_RE.test(lines[start - 1])) start--;
    const okBoundary = start < i && (start === 0 || !lines[start - 1].trim());
    if (!okBoundary) {
        res.notes = text.trim() || null;
        return res;
    }
    for (const l of lines.slice(start, i)) {
        const m = LINE_RE.exec(l)!;
        const v = m[2].trim();
        switch (m[1]) {
            case NOTE_LABELS.phones: res.phones.push(v); break;
            case NOTE_LABELS.org: res.org ??= v; break;
            case NOTE_LABELS.title: res.title ??= v; break;
            case NOTE_LABELS.addresses: res.addresses.push(v); break;
            case NOTE_LABELS.birthday: res.birthday ??= v; break;
            case NOTE_LABELS.urls: res.urls.push(v); break;
        }
    }
    res.notes = lines.slice(0, start).join('\n').trim() || null;
    return res;
}
