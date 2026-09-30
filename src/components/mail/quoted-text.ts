// Plegado del historial citado para TEXTO PLANO y utilidades de deteccion compartidas con quoted-html.ts (puro, sin DOM).
//
// Cubre: bloques ">" anidados (">>", "> >"), linea de atribucion multilingue previa ("El ..., X escribio:"), separadores
// "-----Original Message-----" / "-------- Mensaje reenviado --------", el guion bajo de Outlook seguido de un bloque de
// cabeceras (De:/Enviado el:/Para:/Asunto: y sus traducciones) y la firma RFC 3676 ("-- ").
//
// REGLA DE ORO: nunca dejar el mensaje sin texto legible. Si tras quitar la cita no queda texto (ignorando la firma) se
// devuelve null y el mensaje se muestra completo.

/** Minusculas y sin marcas diacriticas: "Escribió" -> "escribio". */
export function foldText(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Una linea de atribucion es corta; un parrafo largo que casualmente termina en "escribio:" no se toca. */
export const ATTRIBUTION_MAX_LEN = 300;

// Verbos "escribio" por idioma, ya sin acentos (ver foldText). Los ideogramas no llevan limite de palabra.
const ATTR_VERBS_LATIN = [
    'wrote', 'escribio', 'a ecrit', 'ont ecrit', 'ha scritto', 'hanno scritto', 'scrisse', 'schrieb', 'schreef', 'skrev', 'skrivit',
    'escreveu', 'napisa[lł](?:a|i|o)?', 'napsal', 'napisao', 'yazd[iı]', 'kirjoitti', 'irta', 'a scris',
    'написал', 'написала', 'написали', 'напísал', 'εγραψε',
];
const ATTR_VERBS_CJK = ['写道', '寫道', '書きました', '書いています', '작성'];
const ATTR_VERB_RE = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${ATTR_VERBS_LATIN.map(foldText).join('|')})(?![\\p{L}\\p{N}])|(?:${ATTR_VERBS_CJK.map(foldText).join('|')})`,
    'u',
);
/** Atribuciones sin verbo (Gmail ja/ko/otros): "2025年1月1日(水) 10:00 Ana <ana@example.test>:" */
const ATTR_ADDRESS_RE = /\d.*<[^<>\s]+@[^<>\s]+>\s*(?:님이 작성|さん)?\s*[:：]$/u;

/** true si la linea (o varias unidas) es "El <fecha>, <persona> escribio:" en cualquiera de los idiomas soportados. */
export function isAttributionLine(raw: string): boolean {
    const original = (raw || '').replace(/\s+/g, ' ').trim();
    if (!original || original.length > ATTRIBUTION_MAX_LEN) return false;
    const dashed = /^[-–—_=*]{2,}/.test(original); // Zoho: "---- On Mon, ... wrote ----"
    const f = foldText(original.replace(/^[-–—_=*>\s]+|[-–—_=*\s]+$/g, ''));
    if (!f) return false;
    const endsColon = /[:：]$/.test(f);
    if (ATTR_VERB_RE.test(f) && (endsColon || dashed || /(写道|寫道|書きました)$/.test(f))) return true;
    return ATTR_ADDRESS_RE.test(f);
}

// --- Separadores ---------------------------------------------------------------------------------------------------
const SEP_TITLES = [
    'original message', 'reply message', 'mensaje original', 'message d\'origine', 'message original', 'ursprungliche nachricht',
    'original-nachricht', 'original nachricht', 'messaggio originale', 'mensagem original', 'oorspronkelijk bericht', 'ursprungligt meddelande',
    'oryginalna wiadomosc', 'исходное сообщение', 'исходное письмо', '原始邮件', '原邮件', '原始郵件', '元のメッセージ', '원본 메시지',
    'forwarded message', 'mensaje reenviado', 'message transfere', 'message reexpedie', 'weitergeleitete nachricht', 'messaggio inoltrato',
    'mensagem encaminhada', 'mensagem reencaminhada', 'doorgestuurd bericht', 'vidarebefordrat meddelande', 'przekazana wiadomosc',
    'пересланное сообщение', '转发的邮件', '轉寄的郵件', '転送されたメッセージ', '転送メッセージ', 'forwarded',
];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEP_DASHED_RE = new RegExp(`^[-_=*#\\s]{2,}(?:${SEP_TITLES.map((t) => escapeRe(foldText(t))).join('|')})\\s*[-_=*#\\s]*:?$`, 'u');
/** Apple Mail y otros: sin guiones, con dos puntos. */
const SEP_PLAIN_RE = /^(?:begin forwarded message|inicio del mensaje reenviado|debut du message reexpedie|anfang der weitergeleiteten nachricht|inizio messaggio inoltrato|inicio da mensagem reencaminhada|begin doorgestuurd bericht|forwarded message)\s*:$/u;

export function isSeparatorLine(raw: string): boolean {
    const f = foldText((raw || '').replace(/\s+/g, ' ').trim());
    if (!f || f.length > 120) return false;
    return SEP_DASHED_RE.test(f) || SEP_PLAIN_RE.test(f);
}

/** Linea de subrayado que Outlook pone antes del bloque de cabeceras. */
export function isUnderscoreRule(raw: string): boolean {
    return /^\s*(?:_{8,}|─{8,})\s*$/.test(raw || '');
}

// --- Cabeceras De:/From:/Sent:/To:/Subject: -----------------------------------------------------------------------
type HeaderKind = 'from' | 'sent' | 'to' | 'cc' | 'subject';
const HEADER_LABELS: Record<HeaderKind, string[]> = {
    from: ['from', 'de', 'von', 'da', 'van', 'fran', 'fra', 'od', 'expediteur', 'remitente', 'от', 'от кого', 'отправитель', '发件人', '寄件者', '寄件人', '差出人', '送信者', '보낸 사람', 'lahettaja', 'gonderen', 'felado'],
    sent: ['sent', 'date', 'enviado', 'enviado el', 'fecha', 'envoye', 'envoyee', 'date d\'envoi', 'gesendet', 'datum', 'inviato', 'data', 'data invio', 'enviada', 'verzonden', 'skickat', 'skickat den', 'sendt', 'wyslano', 'отправлено', 'дата', '发送时间', '发送日期', '日期', '寄件日期', '傳送時間', '送信日時', '日付', '보낸 날짜', 'lahetetty', 'gonderim tarihi'],
    to: ['to', 'para', 'a', 'à', 'an', 'aan', 'till', 'til', 'do', 'кому', '收件人', '宛先', '宛て', '받는 사람', 'vastaanottaja', 'alici'],
    cc: ['cc', 'kopie', 'kopia', 'копия', '抄送', '副本', '参考'],
    subject: ['subject', 'asunto', 'objet', 'betreff', 'oggetto', 'assunto', 'onderwerp', 'amne', 'temat', 'тема', '主题', '主題', '主旨', '件名', '제목', 'aihe', 'konu', 'emne'],
};
const KIND_LIST = Object.keys(HEADER_LABELS) as HeaderKind[];
const LABEL_RES: Record<HeaderKind, RegExp> = Object.fromEntries(
    KIND_LIST.map((k) => [k, new RegExp(`^(?:${HEADER_LABELS[k].map((l) => escapeRe(foldText(l))).join('|')})\\s*[:：]`, 'u')]),
) as Record<HeaderKind, RegExp>;
const ALL_LABELS_INLINE = new RegExp(
    `(?:^|\\s)(${KIND_LIST.flatMap((k) => HEADER_LABELS[k]).map((l) => escapeRe(foldText(l))).sort((a, b) => b.length - a.length).join('|')})\\s*[:：]`, 'gu',
);

/** Tipo de cabecera si la linea EMPIEZA con una etiqueta (con posible *negrita* o '>' delante). */
export function headerKindOfLine(raw: string): HeaderKind | null {
    const f = foldText((raw || '').replace(/^[\s>*]+/, '').replace(/\*/g, ''));
    for (const k of KIND_LIST) if (LABEL_RES[k].test(f)) return k;
    return null;
}
function inlineKinds(raw: string): Set<HeaderKind> {
    const out = new Set<HeaderKind>();
    const f = foldText(raw || '');
    ALL_LABELS_INLINE.lastIndex = 0;
    for (let m = ALL_LABELS_INLINE.exec(f); m; m = ALL_LABELS_INLINE.exec(f)) {
        const label = m[1];
        for (const k of KIND_LIST) if (HEADER_LABELS[k].some((l) => foldText(l) === label)) out.add(k);
    }
    return out;
}

/** true si en `lines[i]` empieza un bloque de cabeceras de correo reenviado/respondido (De + al menos dos mas). */
export function isHeaderBlockAt(lines: readonly string[], i: number): boolean {
    if (headerKindOfLine(lines[i]) !== 'from') return false;
    const kinds = new Set<HeaderKind>();
    for (let j = i; j < Math.min(lines.length, i + 8); j++) {
        if (j > i && headerKindOfLine(lines[j]) === 'from') break; // otro bloque
        const first = j === i ? inlineKinds(lines[j]) : new Set<HeaderKind>([headerKindOfLine(lines[j])].filter(Boolean) as HeaderKind[]);
        first.forEach((k) => { if (k !== 'from') kinds.add(k); });
    }
    return kinds.size >= 2;
}

// --- Firma ---------------------------------------------------------------------------------------------------------
/** Delimitador RFC 3676 ("-- " con espacio; muchos clientes lo recortan a "--"). */
export function isSignatureDelimiter(raw: string): boolean {
    return /^--\s*$/.test(raw || '');
}
const MOBILE_SIG_RE = /^(?:sent from my |sent from (?:yahoo|outlook|mail|proton|samsung|galaxy)|get outlook for |enviado desde mi |enviado desde (?:outlook|yahoo|correo)|envoye de mon |envoye depuis |gesendet von meinem |von meinem .* gesendet|inviato da |enviado do meu |verzonden vanaf mijn |skickat fran min |wyslano z |отправлено с |来自我的|从我的|發自我的|iphoneから|androidから|스마트폰에서)/u;
/** "Enviado desde mi iPhone", "Get Outlook for iOS"... (firma automatica de movil, no es contenido propio). */
export function isMobileSignatureLine(raw: string): boolean {
    const f = foldText((raw || '').replace(/\s+/g, ' ').trim());
    return f.length > 0 && f.length < 90 && MOBILE_SIG_RE.test(f);
}

const READABLE = /[\p{L}\p{N}]/u;
/** true si el texto tiene algo legible ignorando el bloque de firma (desde "-- " o firma movil). */
export function hasReadableOutsideSignature(lines: readonly string[]): boolean {
    for (const line of lines) {
        if (isSignatureDelimiter(line)) break;
        if (isMobileSignatureLine(line)) continue;
        if (READABLE.test(line)) return true;
    }
    return false;
}

// --- Plegado de texto plano ----------------------------------------------------------------------------------------
export interface QuotedTextSplit {
    /** Texto sin el historial citado (y sin su linea de atribucion). */
    main: string;
    /** Texto citado retirado (bloques separados por linea en blanco). */
    quoted: string;
    /** Cantidad de bloques citados plegados. */
    blocks: number;
    /** Profundidad maxima del historial (">>" = 2; cada mensaje anterior anidado suma 1). */
    levels: number;
    /** Firma que se conserva en `main` (desde "-- "), si la hay. */
    signature: string;
}

const QUOTE_PREFIX_RE = /^[ \t]{0,3}(?:>[ \t]?)+/;
const quoteDepth = (line: string) => { const m = QUOTE_PREFIX_RE.exec(line); return m ? (m[0].match(/>/g) || []).length : 0; };
const isBlank = (line: string) => !line.trim();

/** Cuenta cuantos mensajes (atribucion, separador o bloque de cabeceras) empiezan en estas lineas; un separador y su cabecera cuentan uno. */
export function countMessageStarts(lines: readonly string[]): number {
    let n = 0;
    let afterSeparator = false;
    for (let i = 0; i < lines.length; i++) {
        if (isSeparatorLine(lines[i]) || isAttributionLine(lines[i])) { n++; afterSeparator = true; continue; }
        if (isUnderscoreRule(lines[i])) continue;
        if (isHeaderBlockAt(lines, i)) { if (!afterSeparator) n++; afterSeparator = false; continue; }
        if (lines[i].trim()) afterSeparator = false;
    }
    return n;
}
export function splitQuotedText(text: string): QuotedTextSplit | null {
    if (!text || text.length < 8) return null;
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const n = lines.length;
    const removed = new Array<boolean>(n).fill(false);
    const blocksOut: string[][] = [];
    let levels = 0;

    let i = 0;
    while (i < n) {
        // 1) Bloque ">" (con lineas en blanco intercaladas entre lineas citadas)
        if (quoteDepth(lines[i]) > 0) {
            let j = i;
            let last = i;
            let depth = 0;
            let nonBlank = 0;
            while (j < n) {
                const d = quoteDepth(lines[j]);
                if (d > 0) {
                    last = j; depth = Math.max(depth, d);
                    if (lines[j].replace(QUOTE_PREFIX_RE, '').trim()) nonBlank++;
                    j++;
                } else if (isBlank(lines[j]) && j + 1 < n && (quoteDepth(lines[j + 1]) > 0 || (isBlank(lines[j + 1]) && j + 2 < n && quoteDepth(lines[j + 2]) > 0))) {
                    j++;
                } else break;
            }
            // Linea de atribucion previa (hasta 3 lineas unidas, saltando blancos)
            let start = i;
            let e = i - 1;
            while (e >= 0 && !removed[e] && isBlank(lines[e]) && i - e <= 2) e--;
            let hasAttr = false;
            if (e >= 0 && !removed[e] && !isBlank(lines[e])) {
                for (let k = 1; k <= 3 && e - k + 1 >= 0; k++) {
                    const from = e - k + 1;
                    if (removed[from] || (k > 1 && isBlank(lines[from]))) break;
                    if (isAttributionLine(lines.slice(from, e + 1).join(' '))) { start = from; hasAttr = true; break; }
                }
            }
            if (nonBlank >= 1 || hasAttr) {
                for (let x = start; x <= last; x++) removed[x] = true;
                blocksOut.push(lines.slice(start, last + 1));
                levels = Math.max(levels, depth);
            }
            i = last + 1;
            continue;
        }
        // 2) Separadores / cabeceras: todo lo que sigue es historial
        const startsTail = isSeparatorLine(lines[i])
            || (isUnderscoreRule(lines[i]) && i + 1 < n && isHeaderBlockAt(lines, isBlank(lines[i + 1]) && i + 2 < n ? i + 2 : i + 1))
            || isHeaderBlockAt(lines, i);
        if (startsTail) {
            for (let x = i; x < n; x++) removed[x] = true;
            const tail = lines.slice(i);
            blocksOut.push(tail);
            levels = Math.max(levels, 1 + Math.max(0, countMessageStarts(tail.map((l) => l.replace(QUOTE_PREFIX_RE, ''))) - 1));
            break;
        }
        i++;
    }

    if (blocksOut.length === 0) return null;

    const kept = lines.filter((_, idx) => !removed[idx]);
    while (kept.length && isBlank(kept[kept.length - 1])) kept.pop();
    // Regla de oro: debe quedar texto legible propio (la firma sola no cuenta)
    if (!hasReadableOutsideSignature(kept)) return null;

    const sigAt = kept.findIndex(isSignatureDelimiter);
    const signature = sigAt >= 0 ? kept.slice(sigAt).join('\n').trim() : '';
    const quoted = blocksOut.map((b) => b.join('\n').replace(/\s+$/, '')).join('\n\n');
    return {
        main: kept.join('\n').replace(/^\s*\n/, ''),
        quoted,
        blocks: blocksOut.length,
        levels: Math.max(1, levels),
        signature,
    };
}
