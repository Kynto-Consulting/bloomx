/**
 * formats.ts - deteccion de formato POR CONTENIDO, mapeo de carpetas/etiquetas (Gmail Takeout, Thunderbird, Outlook, Apple Mail),
 * banderas (Status / X-Status / X-Mozilla-Status) y deteccion del buzon de destino. Puro y probado con fixtures propias.
 */
import { decodeEncodedWords, type Address } from './mime-parse';
import { looksLikeEmlx } from './emlx';
import { isOlmMessagePath, olmFolderOf } from './olm';

export type SourceFormat = 'mbox' | 'eml' | 'emlx' | 'zip' | 'gzip' | 'tar' | 'pst' | 'msg' | 'vcf' | 'ics' | 'filters' | 'bloomx-encrypted' | 'unknown';

const HEADER_NAMES = /^(received|from|to|date|subject|message-id|mime-version|return-path|delivered-to|x-[a-z0-9-]+|content-type|reply-to|cc|authentication-results|dkim-signature|in-reply-to|references)$/i;

/** Formato de un archivo a partir de sus primeros bytes (>= 512 recomendados). La extension solo desempata EML/mbox. */
export function detectFormat(head: Buffer, filename = ''): { format: SourceFormat; reason: string } {
    const b = head;
    if (b.length >= 8 && b.toString('latin1', 0, 8) === 'BLMXENC1') return { format: 'bloomx-encrypted', reason: 'magic:BLMXENC1' };
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) ) return { format: 'zip', reason: 'magic:PK' };
    if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) return { format: 'gzip', reason: 'magic:gzip' };
    if (b.length >= 4 && b.toString('latin1', 0, 4) === '!BDN') return { format: 'pst', reason: 'magic:!BDN' };
    if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return { format: 'msg', reason: 'magic:OLE' };
    if (b.length >= 262 && b.toString('latin1', 257, 262) === 'ustar') return { format: 'tar', reason: 'magic:ustar' };

    // Apple Mail (.emlx): primera linea = longitud en bytes del mensaje
    if (looksLikeEmlx(b, filename)) return { format: 'emlx', reason: 'emlx_length_line' };

    // Texto: salta BOM y blancos
    let s = 0;
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) s = 3;
    while (s < b.length && (b[s] === 0x0a || b[s] === 0x0d || b[s] === 0x20 || b[s] === 0x09)) s++;
    const text = b.toString('latin1', s, Math.min(b.length, s + 4096));
    if (/^From \S+/.test(text)) {
        const lines = text.split(/\r?\n/);
        const next = lines[1] ?? '';
        if (/^[\x21-\x39\x3b-\x7e]+:/.test(next)) return { format: 'mbox', reason: 'from_line+header' };
    }
    if (/^BEGIN:VCARD\b/i.test(text)) return { format: 'vcf', reason: 'vcard' };
    if (/^BEGIN:VCALENDAR\b/i.test(text)) return { format: 'ics', reason: 'icalendar' };
    if (/^(?:<\?xml[^>]*\?>\s*)?<feed[\s>]/i.test(text) && (/apps:property/i.test(text) || /mailFilters|filters?\.xml/i.test(filename))) return { format: 'filters', reason: 'gmail_filters_atom' };
    const first = /^([\x21-\x39\x3b-\x7e]+):/.exec(text);
    if (first && HEADER_NAMES.test(first[1])) {
        const names = text.split(/\r?\n/).map((l) => /^([\x21-\x39\x3b-\x7e]+):/.exec(l)?.[1]).filter(Boolean) as string[];
        if (names.length >= 2 || /\.eml$/i.test(filename)) return { format: 'eml', reason: 'rfc822_headers' };
    }
    return { format: 'unknown', reason: 'no_signature' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Carpetas
// ---------------------------------------------------------------------------------------------------------------------

export type SystemFolder = 'inbox' | 'sent' | 'spam' | 'trash' | 'archive';
export const SYSTEM_FOLDERS: readonly SystemFolder[] = ['inbox', 'sent', 'spam', 'trash', 'archive'];

function norm(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const FOLDER_ALIASES: Array<[SystemFolder | 'drafts', string[]]> = [
    ['inbox', ['inbox', 'recibidos', 'bandeja de entrada', 'entrada', 'recibido', 'boite de reception', 'posteingang']],
    ['sent', ['sent', 'sent mail', 'sent items', 'sent messages', 'enviados', 'elementos enviados', 'correo enviado', 'mensajes enviados', 'gesendet']],
    ['trash', ['trash', 'bin', 'deleted', 'deleted items', 'deleted messages', 'papelera', 'elementos eliminados', 'eliminados', 'papierkorb']],
    ['spam', ['spam', 'junk', 'junk e-mail', 'junk email', 'bulk mail', 'correo no deseado', 'no deseado', 'correo basura', 'basura']],
    ['drafts', ['drafts', 'draft', 'borradores', 'borrador', 'entwuerfe']],
    ['archive', ['archive', 'archived', 'all mail', 'all mail including spam and trash', 'archivo', 'archivados', 'todos', 'todos los mensajes', 'todo el correo', 'todo el correo incluido spam y papelera', 'archiv']],
];

/** ¿El nombre corresponde a una carpeta de sistema conocida (Inbox, Enviados, Papelera...)? */
export function isKnownFolderName(name: string): boolean {
    return aliasOf(name.replace(/^\./, '')) !== null;
}

export interface FolderGuess {
    folder: SystemFolder;
    /** Etiqueta a crear para subcarpetas o carpetas de usuario (null si es una carpeta de sistema pura). */
    label: string | null;
    /** Borradores: se importan como archivo con la etiqueta "Drafts". */
    drafts: boolean;
}

function aliasOf(segment: string): SystemFolder | 'drafts' | null {
    const n = norm(segment).replace(/^\[(gmail|google mail)\]\s*\/?\s*/, '');
    for (const [folder, names] of FOLDER_ALIASES) if (names.includes(n)) return folder;
    return null;
}

/** Interpreta un nombre o ruta de carpeta ("[Gmail]/Enviados", "Inbox.Clientes", "Bandeja de entrada/Clientes"). */
export function mapFolderPath(path: string | string[] | null | undefined): FolderGuess | null {
    let segs = Array.isArray(path) ? path : String(path ?? '').split(/[\\/]+/);
    segs = segs.flatMap((s) => (Array.isArray(path) ? [s] : [s])).map((s) => s.trim()).filter(Boolean);
    // Maildir++ y IMAP con punto como separador: ".Sent" , "INBOX.Clientes"
    if (segs.length === 1 && /^\.?[^.]+(\.[^.]+)+$/.test(segs[0]) && aliasOf(segs[0].replace(/^\./, '').split('.')[0])) {
        segs = segs[0].replace(/^\./, '').split('.');
    } else {
        segs = segs.map((s) => s.replace(/^\./, ''));
    }
    // "[Gmail]" contenedor
    segs = segs.filter((s, i) => !(i < segs.length - 1 && /^\[(gmail|google mail)\]$/i.test(s)));
    segs = segs.map((s) => s.replace(/^\[(gmail|google mail)\]\s*\/?\s*/i, '')).filter(Boolean);
    if (segs.length === 0) return null;
    const head = aliasOf(segs[0]);
    if (head) {
        const rest = segs.slice(1).join('/');
        if (head === 'drafts') return { folder: 'archive', label: 'Drafts', drafts: true };
        return { folder: head, label: rest ? rest.slice(0, 80) : null, drafts: false };
    }
    // Carpeta de usuario: archivo + etiqueta con la ruta completa
    return { folder: 'archive', label: segs.join('/').slice(0, 80), drafts: false };
}

/** Nombre de carpeta para exportar (primera en mayusculas como en los clientes). */
export const FOLDER_EXPORT_NAMES: Record<string, string> = {
    inbox: 'Inbox', sent: 'Sent', spam: 'Spam', trash: 'Trash', archive: 'Archive', drafts: 'Drafts', scheduled: 'Scheduled', snoozed: 'Snoozed',
};

// ---------------------------------------------------------------------------------------------------------------------
// Etiquetas de Gmail
// ---------------------------------------------------------------------------------------------------------------------

/** Lista de X-Gmail-Labels (separada por comas, con comillas y/o RFC 2047). */
export function parseGmailLabels(value: string | undefined | null): string[] {
    if (!value) return [];
    const decoded = decodeEncodedWords(value);
    const out: string[] = [];
    let cur = '';
    let quote = false;
    for (let i = 0; i < decoded.length; i++) {
        const ch = decoded[i];
        if (ch === '"') { quote = !quote; continue; }
        if (ch === '\\' && quote && i + 1 < decoded.length) { cur += decoded[++i]; continue; }
        if (ch === ',' && !quote) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return Array.from(new Set(out)).slice(0, 100);
}

const LABEL_ROLES: Array<[string, string[]]> = [
    ['inbox', ['inbox', 'recibidos', 'bandeja de entrada']],
    ['sent', ['sent', 'enviados', 'sent mail', 'elementos enviados']],
    ['trash', ['trash', 'papelera', 'bin']],
    ['spam', ['spam', 'junk', 'correo no deseado']],
    ['drafts', ['drafts', 'borradores']],
    ['starred', ['starred', 'destacados', 'con estrella', 'destacado']],
    ['unread', ['unread', 'no leidos', 'no leido']],
    ['opened', ['opened', 'abierto', 'abiertos']],
    ['chat', ['chat', 'chats']],
];

export interface GmailLabelDecision {
    folder: SystemFolder | null;
    starred: boolean;
    /** true si la lista de etiquetas incluia "Unread"; false si habia etiquetas pero sin Unread; null si no habia datos. */
    unread: boolean | null;
    drafts: boolean;
    userLabels: string[];
}

export function decideFromGmailLabels(labels: string[]): GmailLabelDecision {
    if (labels.length === 0) return { folder: null, starred: false, unread: null, drafts: false, userLabels: [] };
    const roles = new Set<string>();
    const user: string[] = [];
    for (const l of labels) {
        const n = norm(l);
        const role = LABEL_ROLES.find(([, names]) => names.includes(n))?.[0];
        if (role) roles.add(role);
        else user.push(l.slice(0, 80));
    }
    let folder: SystemFolder | null = null;
    if (roles.has('trash')) folder = 'trash';
    else if (roles.has('spam')) folder = 'spam';
    else if (roles.has('inbox')) folder = 'inbox';
    else if (roles.has('sent')) folder = 'sent';
    else folder = 'archive';
    const drafts = roles.has('drafts');
    if (drafts) user.push('Drafts');
    return { folder, starred: roles.has('starred'), unread: roles.has('unread'), drafts, userLabels: Array.from(new Set(user)) };
}

/** Etiquetas de Gmail equivalentes para EXPORTAR (carpeta + banderas + etiquetas de usuario). */
export function gmailLabelsFor(input: { folder: string; read: boolean; starred: boolean; labels: string[] }): string[] {
    const out: string[] = [];
    const f = input.folder;
    if (f === 'inbox') out.push('Inbox');
    else if (f === 'sent') out.push('Sent');
    else if (f === 'spam') out.push('Spam');
    else if (f === 'trash') out.push('Trash');
    if (input.starred) out.push('Starred');
    if (!input.read) out.push('Unread');
    out.push(...input.labels);
    return Array.from(new Set(out));
}

export function formatGmailLabels(labels: string[]): string {
    return labels.map((l) => (/[",\\]/.test(l) ? `"${l.replace(/(["\\])/g, '\\$1')}"` : l)).join(',');
}

// ---------------------------------------------------------------------------------------------------------------------
// Banderas
// ---------------------------------------------------------------------------------------------------------------------

export interface FlagInfo {
    read: boolean | null;
    starred: boolean;
    deleted: boolean;
    junk: boolean;
    answered: boolean;
    /** Etiquetas de Thunderbird (X-Mozilla-Keys) ya traducidas. */
    tags: string[];
}

const TB_LABELS: Record<string, string> = { $label1: 'Important', $label2: 'Work', $label3: 'Personal', $label4: 'To Do', $label5: 'Later' };

export function flagsFromHeaders(h: Record<string, string[]>): FlagInfo {
    const first = (n: string) => (h[n] && h[n][0]) || '';
    const info: FlagInfo = { read: null, starred: false, deleted: false, junk: false, answered: false, tags: [] };

    const bx = first('x-bloomx-flags');
    if (bx) {
        const set = new Set(bx.toLowerCase().split(/[\s,;]+/).filter(Boolean));
        info.read = set.has('unread') ? false : set.has('read') ? true : null;
        info.starred = set.has('starred') || set.has('flagged');
        info.answered = set.has('answered');
    }
    const status = first('status').trim();
    if (status && info.read === null) info.read = /R/i.test(status);
    const xs = first('x-status').trim();
    if (xs) {
        if (/F/i.test(xs)) info.starred = true;
        if (/A/i.test(xs)) info.answered = true;
        if (/D/i.test(xs)) info.deleted = true;
    }
    const mz = first('x-mozilla-status').trim();
    if (/^[0-9a-f]{1,4}$/i.test(mz)) {
        const v = parseInt(mz, 16);
        if (info.read === null) info.read = (v & 0x0001) !== 0;
        if (v & 0x0004) info.starred = true;
        if (v & 0x0002) info.answered = true;
        if (v & 0x0008) info.deleted = true;
    }
    const keys = first('x-mozilla-keys').trim();
    if (keys) {
        for (const k of keys.split(/\s+/).filter(Boolean)) {
            const lower = k.toLowerCase();
            if (lower === 'junk') info.junk = true;
            else if (TB_LABELS[lower]) info.tags.push(TB_LABELS[lower]);
            else if (!k.startsWith('$') && lower !== 'nonjunk') info.tags.push(k.slice(0, 80));
        }
    }
    return info;
}

// ---------------------------------------------------------------------------------------------------------------------
// Decision completa de un mensaje (carpeta, etiquetas, banderas)
// ---------------------------------------------------------------------------------------------------------------------

export interface MessagePlacement {
    folder: SystemFolder;
    labels: string[];
    /** Subconjunto de `labels` que viene de una CARPETA del origen (Outlook, Thunderbird, ZIP/Maildir): se importan como etiquetas de comportamiento 'folder'. */
    folderLabels?: string[];
    read: boolean;
    starred: boolean;
    /** Carpeta original si el mensaje esta en papelera/spam (para "restaurar"). */
    previousFolder: SystemFolder | null;
    source: 'bloomx' | 'gmail' | 'flags' | 'path' | 'default';
    /** Borrador (X-Bloomx-Draft, etiqueta Drafts de Gmail, carpeta Borradores, bandera D de Maildir): va a la tabla Draft, no a Email. */
    draft: boolean;
}

export function decidePlacement(h: Record<string, string[]>, pathFolder?: string | string[] | null): MessagePlacement {
    const first = (n: string) => (h[n] && h[n][0]) || '';
    const flags = flagsFromHeaders(h);
    const gmail = decideFromGmailLabels(parseGmailLabels(first('x-gmail-labels')));
    const path = pathFolder ? mapFolderPath(pathFolder) : null;
    const labels = new Set<string>();
    let folder: SystemFolder | null = null;
    let source: MessagePlacement['source'] = 'default';

    const bxFolder = norm(first('x-bloomx-folder'));
    if (bxFolder && (SYSTEM_FOLDERS as readonly string[]).includes(bxFolder)) { folder = bxFolder as SystemFolder; source = 'bloomx'; }
    else if (gmail.folder) { folder = gmail.folder; source = 'gmail'; }
    else if (flags.deleted) { folder = 'trash'; source = 'flags'; }
    else if (flags.junk) { folder = 'spam'; source = 'flags'; }
    else if (path) { folder = path.folder; source = 'path'; }
    if (!folder) folder = 'inbox';

    for (const l of gmail.userLabels) labels.add(l);
    for (const l of flags.tags) labels.add(l);
    const folderLabels: string[] = [];
    if (path?.label && source !== 'gmail' && source !== 'bloomx' && !path.drafts) { labels.add(path.label); folderLabels.push(path.label); }
    if (path?.drafts) labels.add('Drafts');

    const starred = flags.starred || gmail.starred;
    let read: boolean;
    if (gmail.unread !== null) read = !gmail.unread;
    else if (flags.read !== null) read = flags.read;
    else read = true;

    const previousFolder: SystemFolder | null = folder === 'trash' || folder === 'spam' ? 'inbox' : null;
    // Un borrador en la papelera/spam de Gmail (etiquetas Drafts+Trash) sigue siendo papelera: solo cuentan los borradores "vivos"
    const bx = first('x-bloomx-draft').trim();
    const draft = (bx !== '' && bx !== '0' && bx.toLowerCase() !== 'false') || ((gmail.drafts || !!path?.drafts) && folder !== 'trash' && folder !== 'spam');
    return { folder, labels: Array.from(labels).slice(0, 30), folderLabels, read, starred, previousFolder, source, draft };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rutas de ZIP / Maildir / PST
// ---------------------------------------------------------------------------------------------------------------------

export type MemberKind = 'mbox' | 'eml' | 'emlx' | 'msg' | 'olm' | 'vcf' | 'ics' | 'filters' | 'maildir' | 'pst' | 'tar' | 'gzip' | 'manifest' | 'ignored';

export interface PathInfo {
    kind: MemberKind;
    /** Direccion de correo detectada en la ruta (buzon@dominio/...). */
    mailbox: string | null;
    /** Carpeta: segmentos relevantes. */
    folder: string[];
    /** Banderas del nombre de archivo Maildir (":2,RS"). */
    maildirFlags: { read?: boolean; starred?: boolean; deleted?: boolean; draft?: boolean } | null;
}

const EMAILISH = /^[^\s@/\\]+@[^\s@/\\]+\.[A-Za-z]{2,}$/;

/** Normaliza una ruta de archivo comprimido: separadores, sin "..", sin absolutas, sin unidad, sin NUL. null si es insegura. */
export function safeArchivePath(name: string): string | null {
    if (!name || name.includes('\0')) return null;
    const unified = name.replace(/\\/g, '/');
    if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified)) return null;
    const out: string[] = [];
    for (const seg of unified.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') return null;
        // eslint-disable-next-line no-control-regex
        if (/[\u0000-\u001f]/.test(seg)) return null;
        out.push(seg.slice(0, 200));
    }
    if (out.length === 0 || out.length > 40) return null;
    return out.join('/');
}

/**
 * Apple Mail: ~/Library/Mail/V10/<UUID>/Clientes.mbox/<UUID>/Data/1/2/Messages/123.emlx. La carpeta es el/los directorios
 * `*.mbox` / `*.imapmbox`; se descartan versiones (V10), UUID, "Data", digitos y "Messages".
 */
export function appleFolderSegments(dirs: string[]): string[] {
    const out: string[] = [];
    for (const d of dirs) {
        if (/^(V\d+|Data|Messages|Attachments|Mailboxes|mail|correo|takeout|backup|export)$/i.test(d)) continue;
        if (/^\d+$/.test(d)) continue;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d)) continue;
        if (EMAILISH.test(d)) continue;
        out.push(d.replace(/\.(mbox|imapmbox|emlxpart)$/i, ''));
    }
    return out.filter(Boolean);
}

export function interpretPath(path: string): PathInfo {
    const segs = path.split('/').filter(Boolean);
    const file = segs[segs.length - 1] || '';
    const lowerFile = file.toLowerCase();
    let mailbox: string | null = null;
    const dirs = segs.slice(0, -1);
    const rest: string[] = [];
    for (const d of dirs) {
        if (!mailbox && EMAILISH.test(d)) mailbox = d.toLowerCase();
        else rest.push(d);
    }
    if (!mailbox && EMAILISH.test(file.replace(/\.(mbox|mbx|pst|zip)$/i, ''))) mailbox = file.replace(/\.(mbox|mbx|pst|zip)$/i, '').toLowerCase();

    // Maildir: .../cur|new|tmp/<archivo>
    const maildirIdx = dirs.findIndex((d) => /^(cur|new|tmp)$/i.test(d));
    if (maildirIdx >= 0) {
        const kind = dirs[maildirIdx].toLowerCase();
        const folder = dirs.slice(0, maildirIdx).filter((d) => d !== mailbox && !/^maildir$/i.test(d));
        if (kind === 'tmp') return { kind: 'ignored', mailbox, folder, maildirFlags: null };
        const flagMatch = /:2,([A-Za-z]*)$/.exec(file);
        const fl = flagMatch ? flagMatch[1] : '';
        return {
            kind: 'maildir',
            mailbox,
            folder,
            maildirFlags: { read: kind === 'cur' ? /S/.test(fl) || !flagMatch : /S/.test(fl), starred: /F/.test(fl), deleted: /T/.test(fl), draft: /D/.test(fl) },
        };
    }
    // Outlook para Mac (.olm = ZIP): mensajes en com.microsoft.__Messages/<carpeta>/*.xml
    if (isOlmMessagePath(path)) return { kind: 'olm', mailbox, folder: olmFolderOf(path), maildirFlags: null };
    const folderSegs = rest.filter((d) => !/^(takeout|mail|maildir|correo|export|backup)$/i.test(d));
    if (/\.eml$/i.test(lowerFile)) return { kind: 'eml', mailbox, folder: folderSegs, maildirFlags: null };
    if (/\.emlx$/i.test(lowerFile)) return { kind: 'emlx', mailbox, folder: appleFolderSegments(dirs), maildirFlags: null };
    if (/\.msg$/i.test(lowerFile)) return { kind: 'msg', mailbox, folder: folderSegs, maildirFlags: null };
    // Datos personales (Google Takeout / esta misma aplicacion): contactos, calendario y filtros
    if (/\.vcf$/i.test(lowerFile)) return { kind: 'vcf', mailbox, folder: [], maildirFlags: null };
    if (/\.ics$/i.test(lowerFile)) return { kind: 'ics', mailbox, folder: [], maildirFlags: null };
    if (/^(mail)?filters?\.xml$/i.test(lowerFile)) return { kind: 'filters', mailbox, folder: [], maildirFlags: null };
    if (/\.(mbox|mbx)$/i.test(lowerFile)) return { kind: 'mbox', mailbox, folder: [...folderSegs, file.replace(/\.(mbox|mbx)$/i, '')], maildirFlags: null };
    // Apple Mail: "Bandeja.mbox/mbox"
    if (lowerFile === 'mbox' && dirs.length > 0) {
        const parent = dirs[dirs.length - 1].replace(/\.mbox$/i, '');
        return { kind: 'mbox', mailbox, folder: [...folderSegs.slice(0, -1), parent], maildirFlags: null };
    }
    if (/\.pst$|\.ost$/i.test(lowerFile)) return { kind: 'pst', mailbox, folder: folderSegs, maildirFlags: null };
    if (/\.tar$/i.test(lowerFile)) return { kind: 'tar', mailbox, folder: folderSegs, maildirFlags: null };
    if (/\.(gz|tgz)$/i.test(lowerFile)) return { kind: 'gzip', mailbox, folder: folderSegs, maildirFlags: null };
    if (lowerFile === 'manifest.json' || lowerFile === 'readme.txt' || lowerFile.endsWith('.csv') || lowerFile.endsWith('.json')) return { kind: 'manifest', mailbox: null, folder: [], maildirFlags: null };
    return { kind: 'ignored', mailbox, folder: folderSegs, maildirFlags: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Buzon de destino
// ---------------------------------------------------------------------------------------------------------------------

export interface MailboxDetectInput {
    headers: Record<string, string[]>;
    from: Address | null;
    to: Address[];
    cc: Address[];
    folder: SystemFolder;
    /** Buzon indicado por la ruta del archivo. */
    pathMailbox?: string | null;
    isInstanceAddress: (email: string) => boolean;
}

function emailsOfHeader(values: string[] | undefined): string[] {
    const out: string[] = [];
    for (const v of values ?? []) {
        const m = v.match(/[^\s<>(),;"]+@[^\s<>(),;"]+/g);
        if (m) for (const a of m) out.push(a.toLowerCase().replace(/^<|>$/g, ''));
    }
    return out;
}

/** Decide el buzon al que pertenece el mensaje. `null` = no se pudo determinar. */
export function detectMailbox(input: MailboxDetectInput): { address: string | null; source: string } {
    const h = input.headers;
    const cands: Array<[string, string]> = [];
    const add = (source: string, list: string[]) => { for (const a of list) if (a.includes('@')) cands.push([a, source]); };
    add('x-bloomx-mailbox', emailsOfHeader(h['x-bloomx-mailbox']));
    if (input.pathMailbox) add('path', [input.pathMailbox.toLowerCase()]);
    if (input.folder === 'sent' && input.from) add('from', [input.from.email]);
    add('delivered-to', emailsOfHeader(h['delivered-to']));
    add('x-original-to', emailsOfHeader(h['x-original-to']));
    add('envelope-to', [...emailsOfHeader(h['envelope-to']), ...emailsOfHeader(h['x-envelope-to'])]);
    add('to', input.to.map((a) => a.email));
    add('cc', input.cc.map((a) => a.email));
    if (input.from) add('from', [input.from.email]);
    if (cands.length === 0) return { address: null, source: 'none' };
    // Las explicitas (bloomx/ruta/enviados) mandan; en el resto se prefiere una direccion del dominio de la instancia
    const explicit = cands.find(([, s]) => s === 'x-bloomx-mailbox' || s === 'path');
    if (explicit) return { address: explicit[0], source: explicit[1] };
    // Cabeceras de entrega (Delivered-To...): identifican el buzon real aunque sea de otro dominio
    const fam = cands.filter(([, s]) => s === 'delivered-to' || s === 'x-original-to' || s === 'envelope-to' || (s === 'from' && input.folder === 'sent'));
    if (fam.length) {
        const pick = fam.find(([a]) => input.isInstanceAddress(a)) ?? fam[0];
        return { address: pick[0], source: pick[1] };
    }
    const own = cands.find(([a]) => input.isInstanceAddress(a));
    if (own) return { address: own[0], source: own[1] };
    return { address: cands[0][0], source: cands[0][1] };
}
