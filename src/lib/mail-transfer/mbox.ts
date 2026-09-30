/**
 * mbox.ts - lector en streaming y escritor de mbox (mboxrd; tolera mboxo/mboxcl de Thunderbird, Gmail Takeout, Apple Mail).
 *
 * Lectura: el archivo se consume por bloques desde un `ByteSource` (acceso por rango, p. ej. trozos en el storage), nunca entero
 * en memoria. Un mensaje empieza en una linea `From ` que (a) esta al inicio del archivo o tras una linea en blanco y (b) va
 * seguida de una cabecera (`Nombre:`). Asi un "From " dentro de un cuerpo sin escapar no parte el mensaje. Se devuelve el
 * desplazamiento de cada mensaje: sirve de punto de reanudacion entre invocaciones serverless.
 * Un mensaje mas grande que `maxMessageBytes` se descarta sin acumularlo (`oversize`).
 */

export interface ByteSource {
    readonly size: number;
    /** Lee hasta `length` bytes desde `offset` (menos al final del archivo). */
    read(offset: number, length: number): Promise<Buffer>;
}

export function bufferSource(buf: Buffer): ByteSource {
    return { size: buf.length, read: async (o, l) => buf.subarray(o, Math.min(buf.length, o + l)) };
}

export interface MboxMessage {
    /** Desplazamiento de la linea `From ` (inicio del mensaje). */
    offset: number;
    /** Desplazamiento del siguiente mensaje (o fin de archivo). */
    end: number;
    /** Linea `From ` sin salto de linea. */
    fromLine: string;
    /** Mensaje RFC 822 (desescapado mboxrd). Con `oversize` o `headOnly` puede ser solo el principio. */
    raw: Buffer;
    /** Tamano real del mensaje en el archivo (sin la linea From). */
    size: number;
    oversize: boolean;
}

export interface MboxReaderOptions {
    /** Mensajes mayores se descartan (oversize=true y raw = cabecera). */
    maxMessageBytes?: number;
    /** Si se indica, solo se conservan los primeros N bytes de cada mensaje (analisis rapido). */
    headBytes?: number;
    blockSize?: number;
}

const FROM = Buffer.from('From ');

function isHeaderLineStart(buf: Buffer, pos: number): boolean {
    // Nombre de cabecera: [!-9;-~]+ seguido de ':'
    let i = pos;
    const limit = Math.min(buf.length, pos + 80);
    while (i < limit) {
        const c = buf[i];
        if (c === 0x3a) return i > pos;
        if (c < 0x21 || c > 0x7e) return false;
        i++;
    }
    return false;
}

/** ¿`buf[pos..]` es una linea separadora "From " valida? `needMore` si faltan bytes para decidir. */
function checkSeparator(buf: Buffer, pos: number, atStart: boolean, eof: boolean): 'yes' | 'no' | 'more' {
    if (buf.length < pos + 5) return eof ? 'no' : 'more';
    if (buf.compare(FROM, 0, 5, pos, pos + 5) !== 0) return 'no';
    if (!atStart) {
        // debe ir tras una linea en blanco: "\n\n" o "\n\r\n"
        if (pos < 2) return 'more';
        const p1 = buf[pos - 1];
        if (p1 !== 0x0a) return 'no';
        const p2 = buf[pos - 2];
        if (!(p2 === 0x0a || (p2 === 0x0d && pos >= 3 && buf[pos - 3] === 0x0a))) {
            // linea anterior no vacia: no es separador (salvo mboxo sin blanco previo, que no se soporta)
            return 'no';
        }
    }
    const eol = buf.indexOf(0x0a, pos);
    if (eol < 0) return eof ? 'no' : 'more';
    const next = eol + 1;
    if (next >= buf.length) return eof ? 'no' : 'more';
    if (buf[next] === 0x0a || buf[next] === 0x0d) return 'no'; // From_ seguido de linea vacia: no es un mensaje
    if (!isHeaderLineStart(buf, next)) {
        // la linea siguiente puede ser un continuador "X-Something" cortado; si hay pocos bytes, pide mas
        if (!eof && buf.length - next < 80) return 'more';
        return 'no';
    }
    return 'yes';
}

/** Desescapa mboxrd: `>From `, `>>From `... -> se quita un `>` inicial. */
export function unescapeMboxrd(buf: Buffer): Buffer {
    if (buf.indexOf(0x3e) < 0) return buf;
    const out: Buffer[] = [];
    let start = 0;
    let i = 0;
    const len = buf.length;
    while (i < len) {
        // inicio de linea en i
        if (buf[i] === 0x3e) {
            let j = i;
            while (j < len && buf[j] === 0x3e) j++;
            if (buf.compare(FROM, 0, 5, j, Math.min(len, j + 5)) === 0 && j + 5 <= len) {
                out.push(buf.subarray(start, i));
                start = i + 1; // omite un '>'
            }
        }
        const nl = buf.indexOf(0x0a, i);
        if (nl < 0) break;
        i = nl + 1;
    }
    if (start === 0) return buf;
    out.push(buf.subarray(start));
    return Buffer.concat(out);
}

export class MboxReader {
    private buf: Buffer = Buffer.alloc(0);
    /** Desplazamiento de archivo de buf[0]. */
    private bufStart: number;
    private eof = false;
    private started = false;
    private readonly maxMessage: number;
    private readonly head: number;
    private readonly block: number;

    constructor(private src: ByteSource, startOffset = 0, opts: MboxReaderOptions = {}) {
        this.bufStart = startOffset;
        this.maxMessage = opts.maxMessageBytes ?? 50 * 1024 * 1024;
        this.head = opts.headBytes ?? 0;
        this.block = opts.blockSize ?? 1024 * 1024;
    }

    private async fill(): Promise<boolean> {
        if (this.eof) return false;
        const at = this.bufStart + this.buf.length;
        if (at >= this.src.size) { this.eof = true; return false; }
        const chunk = await this.src.read(at, this.block);
        if (chunk.length === 0) { this.eof = true; return false; }
        this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
        if (this.bufStart + this.buf.length >= this.src.size) this.eof = true;
        return true;
    }

    private drop(n: number): void {
        this.buf = this.buf.subarray(n);
        this.bufStart += n;
    }

    /** Salta BOM y lineas en blanco iniciales. */
    private async skipLeading(): Promise<void> {
        for (;;) {
            if (this.buf.length < 3) await this.fill();
            if (this.buf.length >= 3 && this.buf[0] === 0xef && this.buf[1] === 0xbb && this.buf[2] === 0xbf && this.bufStart === 0) this.drop(3);
            let skip = 0;
            while (skip < this.buf.length && (this.buf[skip] === 0x0a || this.buf[skip] === 0x0d)) skip++;
            if (skip > 0) this.drop(skip);
            if (this.buf.length === 0 && !this.eof) { await this.fill(); continue; }
            return;
        }
    }

    /** Siguiente mensaje o null al final. */
    async next(): Promise<MboxMessage | null> {
        if (!this.started) {
            this.started = true;
            await this.skipLeading();
        }
        while (this.buf.indexOf(0x0a) < 0 && (await this.fill())) { /* completa la primera linea */ }
        if (this.buf.length === 0) return null;
        let bodyStart = 0;
        if (this.buf.length >= 5 && this.buf.compare(FROM, 0, 5, 0, 5) === 0) {
            const eol = this.buf.indexOf(0x0a);
            bodyStart = eol < 0 ? this.buf.length : eol + 1;
        }
        return this.readBody(bodyStart);
    }

    /** `bodyStart`: posicion (en buf) donde empieza el mensaje tras la linea From. */
    private async readBody(bodyStart: number): Promise<MboxMessage> {
        const offset = this.bufStart;
        const fromLine = this.buf.subarray(0, bodyStart).toString('latin1').replace(/\r?\n$/, '');
        const cap = this.head > 0 ? this.head : this.maxMessage;
        let base = bodyStart; // inicio del mensaje dentro de buf
        let scan = bodyStart;
        let flushed = 0; // bytes del mensaje ya sacados de buf
        let kept: Buffer[] = [];
        let keptBytes = 0;
        let over = false;

        const keep = (slice: Buffer) => {
            if (over) return;
            if (this.head > 0) {
                if (keptBytes < this.head) {
                    const part = slice.subarray(0, this.head - keptBytes);
                    kept.push(part);
                    keptBytes += part.length;
                }
                return;
            }
            if (keptBytes + slice.length <= cap) { kept.push(slice); keptBytes += slice.length; }
            else { over = true; kept = []; keptBytes = 0; }
        };

        for (;;) {
            let found = -1;
            let needMore = false;
            let idx = scan;
            while (idx < this.buf.length) {
                const at = this.buf.indexOf(FROM, idx);
                if (at < 0) break;
                if (at === 0 || this.buf[at - 1] !== 0x0a || at < base) { idx = at + 1; continue; }
                const verdict = checkSeparator(this.buf, at, false, this.eof);
                if (verdict === 'yes') { found = at; break; }
                if (verdict === 'more') { needMore = true; scan = at; break; }
                idx = at + 1;
            }
            if (found >= 0) {
                const slice = this.buf.subarray(base, found);
                keep(slice);
                const total = flushed + slice.length;
                const end = this.bufStart + found;
                this.drop(found);
                return this.finish(offset, end, fromLine, kept, total, over || total > this.maxMessage);
            }
            if (this.eof && !needMore) {
                const slice = this.buf.subarray(base);
                keep(slice);
                const total = flushed + slice.length;
                const end = this.bufStart + this.buf.length;
                this.drop(this.buf.length);
                return this.finish(offset, end, fromLine, kept, total, over || total > this.maxMessage);
            }
            if (this.eof && needMore) {
                // no se pudo decidir y no hay mas datos: lo pendiente es cuerpo
                const slice = this.buf.subarray(base);
                keep(slice);
                const total = flushed + slice.length;
                const end = this.bufStart + this.buf.length;
                this.drop(this.buf.length);
                return this.finish(offset, end, fromLine, kept, total, over || total > this.maxMessage);
            }
            if (!needMore) scan = Math.max(base, this.buf.length - 6);
            // Acota memoria: suelta lo ya revisado y conserva la cola por si el separador cruza el bloque
            if (!needMore && this.buf.length - base > this.block * 2 + 8192) {
                const safe = this.buf.length - 4096;
                const slice = this.buf.subarray(base, safe);
                keep(slice);
                flushed += slice.length;
                this.drop(safe);
                base = 0;
                scan = 0;
            }
            await this.fill();
        }
    }

    private finish(offset: number, end: number, fromLine: string, kept: Buffer[], total: number, oversize: boolean): MboxMessage {
        let raw = kept.length === 1 ? kept[0] : Buffer.concat(kept);
        // El ultimo salto de linea pertenece al separador (la linea en blanco previa a "From ")
        if (!oversize && this.head === 0) {
            if (raw.length >= 2 && raw[raw.length - 1] === 0x0a && raw[raw.length - 2] === 0x0d) raw = raw.subarray(0, raw.length - 2);
            else if (raw.length >= 1 && raw[raw.length - 1] === 0x0a) raw = raw.subarray(0, raw.length - 1);
            raw = unescapeMboxrd(raw);
        }
        return { offset, end, fromLine, raw, size: total, oversize };
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------------------------------------------------

/** Escapa mboxrd: toda linea `^>*From ` recibe un `>` extra. Devuelve Buffer con LF (mbox usa LF). */
export function escapeMboxrd(raw: Buffer): Buffer {
    // Normaliza CRLF -> LF (mbox es de texto por lineas; los lectores vuelven a aceptar ambos)
    let src = raw;
    if (raw.indexOf(0x0d) >= 0) {
        const parts: Buffer[] = [];
        let s = 0;
        for (let i = 0; i < raw.length; i++) {
            if (raw[i] === 0x0d && raw[i + 1] === 0x0a) { parts.push(raw.subarray(s, i)); s = i + 1; }
        }
        parts.push(raw.subarray(s));
        src = Buffer.concat(parts);
    }
    const out: Buffer[] = [];
    let start = 0;
    let i = 0;
    const len = src.length;
    const GT = Buffer.from('>');
    while (i < len) {
        let j = i;
        while (j < len && src[j] === 0x3e) j++;
        if (j + 5 <= len && src.compare(FROM, 0, 5, j, j + 5) === 0) {
            out.push(src.subarray(start, i), GT);
            start = i;
        }
        const nl = src.indexOf(0x0a, i);
        if (nl < 0) break;
        i = nl + 1;
    }
    out.push(src.subarray(start));
    let res = out.length === 1 ? out[0] : Buffer.concat(out);
    if (res.length === 0 || res[res.length - 1] !== 0x0a) res = Buffer.concat([res, Buffer.from('\n')]);
    return res;
}

/** Registro mbox completo: linea From + mensaje escapado + linea en blanco. */
export function mboxRecord(fromLine: string, raw: Buffer): Buffer {
    return Buffer.concat([Buffer.from(fromLine + '\n', 'latin1'), escapeMboxrd(raw), Buffer.from('\n')]);
}
