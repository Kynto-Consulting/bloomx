/**
 * pst-testkit.ts - generador de PST minimos VALIDOS (formato Unicode, version 23) por codigo, solo para pruebas.
 *
 * Escribe las tres capas de MS-PST que lee pst-extractor:
 *   - NDB: cabecera, bloques de datos (con cola de 16 bytes, alineados a 64), XBLOCK para datos > 8176 bytes, SLBLOCK de
 *     subnodos, paginas de 512 bytes del arbol de nodos (NBT) y de bloques (BBT), con ramas multi-nivel.
 *   - LTP: heap-on-node (HN), BTH de un nivel, Property Context (PC) y Table Context (TC).
 *   - Mensajeria: carpetas (PC + tablas de jerarquia/contenido/asociados), mensajes (PC + tabla de adjuntos + tabla de
 *     destinatarios como subnodos), adjuntos por valor y MENSAJES ADJUNTOS INCRUSTADOS (attachMethod 5, PtypObject).
 *
 * El resultado se describe como segmentos dispersos (`SparsePst`): permite fabricar un PST "de cientos de MB" con los bloques
 * repartidos por todo el archivo (`scatterStride`) sin reservar esa memoria, y servirlo por trozos de forma perezosa.
 *
 * Lo que NO se genera (y por que no hace falta para pst-extractor): CRC de cabecera/paginas/bloques (la libreria no los
 * valida; Outlook si), mapas de asignacion AMap/PMap/DList, cifrado permutativo ni compresion. Es un PST valido para pst-extractor,
 * no garantizado para Outlook.
 */

const W = (b: Buffer, off: number, n: number | bigint) => { b.writeBigUInt64LE(BigInt(n), off); };
const align = (n: number, a: number) => Math.ceil(n / a) * a;
const FILETIME_EPOCH_MS = BigInt('11644473600000');

export interface Segment { offset: number; data: Buffer }

export class SparsePst {
    constructor(public readonly size: number, public readonly segments: Segment[]) {}

    /** Trozo i de `chunkSize` bytes (relleno con ceros donde no hay segmentos). */
    chunk(i: number, chunkSize: number): Buffer {
        const start = i * chunkSize;
        const len = Math.max(0, Math.min(chunkSize, this.size - start));
        const out = Buffer.alloc(len);
        const end = start + len;
        for (const s of this.segments) {
            const sEnd = s.offset + s.data.length;
            if (sEnd <= start || s.offset >= end) continue;
            const from = Math.max(start, s.offset);
            const to = Math.min(end, sEnd);
            s.data.copy(out, from - start, from - s.offset, to - s.offset);
        }
        return out;
    }

    /** Archivo completo (solo para tamanos moderados). */
    toBuffer(): Buffer {
        if (this.size > 256 * 1024 * 1024) throw new Error('pst_too_big_for_buffer');
        return this.chunk(0, this.size);
    }
}

// --- Especificacion ------------------------------------------------------------------------------------------------------
export interface PstAttachmentSpec {
    name?: string;
    mime?: string;
    data?: Buffer;
    cid?: string;
    /** Mensaje incrustado (attachMethod 5). */
    embedded?: PstMessageSpec;
}
export interface PstMessageSpec {
    subject: string;
    body?: string;
    html?: string;
    messageClass?: string;
    senderName?: string;
    senderEmail?: string;
    /** Destinatarios (tabla de destinatarios). */
    to?: string[];
    cc?: string[];
    /** Cabeceras SMTP (PR_TRANSPORT_MESSAGE_HEADERS). */
    headers?: string;
    messageId?: string;
    date?: Date;
    read?: boolean;
    attachments?: PstAttachmentSpec[];
}
export interface PstFolderSpec {
    name: string;
    containerClass?: string;
    messages?: PstMessageSpec[];
    children?: PstFolderSpec[];
}
export interface PstBuildOptions {
    /** Cada bloque de datos empieza en un multiplo de este paso (reparte el contenido por todo el archivo). */
    scatterStride?: number;
    /** Tamano minimo del archivo (relleno de ceros al final). */
    padTo?: number;
}

// --- Bloques de propiedades ----------------------------------------------------------------------------------------------
const T_I2 = 0x02, T_I4 = 0x03, T_BOOL = 0x0b, T_OBJECT = 0x0d, T_TIME = 0x40, T_STR = 0x1f, T_BIN = 0x102;
const INLINE_MAX = 2400;

type PropVal = number | Buffer;
interface Prop { tag: number; type: number; v: PropVal }
interface SubnodeSpec { nid: number; data: Buffer; subs?: SubnodeSpec[] }

const str = (s: string) => Buffer.from(s, 'utf16le');
const filetime = (d: Date) => { const b = Buffer.alloc(8); b.writeBigUInt64LE((BigInt(d.getTime()) + FILETIME_EPOCH_MS) * BigInt(10000)); return b; };
const i4 = (tag: number, n: number): Prop => ({ tag, type: T_I4, v: n });
const s16 = (tag: number, s: string): Prop => ({ tag, type: T_STR, v: str(s) });

/** Heap-on-node: asignaciones contiguas (sin relleno: pst-extractor toma la longitud como la distancia hasta la siguiente). */
function buildHeap(clientSig: number, allocs: Buffer[], userRootIdx: number): Buffer {
    let off = 12;
    const starts: number[] = [];
    for (const a of allocs) { starts.push(off); off += a.length; }
    starts.push(off);
    const head = Buffer.alloc(12);
    head.writeUInt16LE(off, 0); // ibHnpm
    head[2] = 0xec;
    head[3] = clientSig;
    head.writeUInt32LE(((userRootIdx + 1) << 5) >>> 0, 4);
    const map = Buffer.alloc(4 + 2 * starts.length);
    map.writeUInt16LE(allocs.length, 0);
    map.writeUInt16LE(0, 2);
    starts.forEach((s, i) => map.writeUInt16LE(s, 4 + 2 * i));
    const heap = Buffer.concat([head, ...allocs, map]);
    if (heap.length > 8176) throw new Error('pst_testkit_heap_too_big');
    return heap;
}
const hid = (allocIdx: number) => ((allocIdx + 1) << 5) >>> 0;

/** Property Context: BTH de un nivel (clave 2 bytes, entrada 6) + valores en el heap o, si son grandes, en subnodos. */
function buildPc(props: Prop[], newSubNid: () => number): { heap: Buffer; extra: SubnodeSpec[] } {
    const sorted = [...props].sort((a, b) => a.tag - b.tag);
    const allocs: Buffer[] = [Buffer.alloc(8), Buffer.alloc(sorted.length * 8)];
    const extra: SubnodeSpec[] = [];
    sorted.forEach((p, i) => {
        const rec = allocs[1];
        rec.writeUInt16LE(p.tag, i * 8);
        rec.writeUInt16LE(p.type, i * 8 + 2);
        let ref = 0;
        if (typeof p.v === 'number') ref = p.v >>> 0;
        else if (p.v.length === 0) ref = 0;
        else if (p.v.length > INLINE_MAX) { ref = newSubNid(); extra.push({ nid: ref, data: p.v }); }
        else { allocs.push(p.v); ref = hid(allocs.length - 1); }
        rec.writeUInt32LE(ref >>> 0, i * 8 + 4);
    });
    allocs[0].set([0xb5, 2, 6, 0]);
    allocs[0].writeUInt32LE(hid(1), 4);
    return { heap: buildHeap(0xbc, allocs, 0), extra };
}

interface TcCol { tag: number; type: number; size: 1 | 2 | 4 | 8 }
interface TcRow { id: number; vals: Map<number, number | Buffer> }

/** Table Context: BTH del indice de filas + TCINFO + matriz de filas (filas contiguas, sin relleno de bloque). */
function buildTc(cols: TcCol[], rows: TcRow[]): Buffer {
    const nBitmap = Math.ceil(cols.length / 8);
    let o = 4;
    const ib = cols.map((c) => { const at = o; o += c.size; return at; });
    const oneB = o;
    const bm = o + nBitmap;
    const allocs: Buffer[] = [Buffer.alloc(8), Buffer.alloc(22 + 8 * cols.length)];
    let rowIndexIdx = -1;
    let rowsIdx = -1;
    if (rows.length > 0) {
        const idx = Buffer.alloc(rows.length * 8);
        rows.forEach((r, i) => { idx.writeUInt32LE(r.id >>> 0, i * 8); idx.writeUInt32LE(i, i * 8 + 4); });
        allocs.push(idx); rowIndexIdx = allocs.length - 1;
        allocs.push(Buffer.alloc(rows.length * bm)); rowsIdx = allocs.length - 1;
    }
    rows.forEach((r, ri) => {
        const row = allocs[rowsIdx].subarray(ri * bm, (ri + 1) * bm);
        row.writeUInt32LE(r.id >>> 0, 0);
        cols.forEach((c, ci) => {
            const v = r.vals.get(c.tag);
            if (v === undefined) return;
            row[oneB + (ci >> 3)] |= 0x80 >> (ci & 7);
            if (Buffer.isBuffer(v)) {
                if (c.size === 8) v.copy(row, ib[ci], 0, 8);
                else if (v.length === 0) row.writeUInt32LE(0, ib[ci]);
                else { allocs.push(v); row.writeUInt32LE(hid(allocs.length - 1), ib[ci]); }
            } else if (c.size === 4) row.writeUInt32LE(v >>> 0, ib[ci]);
            else if (c.size === 2) row.writeUInt16LE(v & 0xffff, ib[ci]);
            else row[ib[ci]] = v & 0xff;
        });
    });
    allocs[0].set([0xb5, 4, 4, 0]);
    allocs[0].writeUInt32LE(rowIndexIdx >= 0 ? hid(rowIndexIdx) : 0, 4);
    const info = allocs[1];
    info[0] = 0x7c;
    info[1] = cols.length;
    info.writeUInt16LE(o, 2); info.writeUInt16LE(o, 4); info.writeUInt16LE(oneB, 6); info.writeUInt16LE(bm, 8);
    info.writeUInt32LE(rowIndexIdx >= 0 ? hid(rowIndexIdx) : 0, 10);
    info.writeUInt32LE(rowsIdx >= 0 ? hid(rowsIdx) : 0, 14);
    cols.forEach((c, i) => {
        info.writeUInt16LE(c.type, 22 + i * 8);
        info.writeUInt16LE(c.tag, 22 + i * 8 + 2);
        info.writeUInt16LE(ib[i], 22 + i * 8 + 4);
        info[22 + i * 8 + 6] = c.size;
        info[22 + i * 8 + 7] = i;
    });
    return buildHeap(0x7c, allocs, 1);
}

const ROW_COLS: TcCol[] = [{ tag: 0x67f2, type: T_I4, size: 4 }, { tag: 0x67f3, type: T_I4, size: 4 }];
const idRows = (ids: number[]): TcRow[] => ids.map((id) => ({ id, vals: new Map<number, number | Buffer>([[0x67f2, id], [0x67f3, 0]]) }));
const RECIP_COLS: TcCol[] = [
    { tag: 0x0c15, type: T_I4, size: 4 }, { tag: 0x3001, type: T_STR, size: 4 }, { tag: 0x3002, type: T_STR, size: 4 },
    { tag: 0x3003, type: T_STR, size: 4 }, { tag: 0x39fe, type: T_STR, size: 4 },
];
const ATT_COLS: TcCol[] = [{ tag: 0x0e21, type: T_I4, size: 4 }];

// --- Almacen de bloques y arboles ----------------------------------------------------------------------------------------
class Store {
    segments: Segment[] = [];
    cursor = 0x1000;
    private bidIdx = 1;
    bbt: Array<{ bid: number; ib: number; cb: number }> = [];
    nbt: Array<{ nid: number; bidData: number; bidSub: number; parent: number }> = [];
    constructor(private scatter: number) {}

    private place(total: number): number {
        let off = align(this.cursor, 64);
        if (this.scatter > 0) off = align(this.cursor, this.scatter);
        this.cursor = off + total;
        return off;
    }
    private writeBlock(data: Buffer, internal: boolean): number {
        if (data.length > 8176) throw new Error('pst_testkit_block_too_big');
        const bid = (this.bidIdx++ << 2) | (internal ? 2 : 0);
        const total = align(data.length + 16, 64);
        const blk = Buffer.alloc(total);
        data.copy(blk, 0);
        blk.writeUInt16LE(data.length, total - 16);
        W(blk, total - 8, bid);
        const ib = this.place(total);
        this.segments.push({ offset: ib, data: blk });
        this.bbt.push({ bid, ib, cb: data.length });
        return bid;
    }
    /** Datos de cualquier tamano: un bloque o un XBLOCK sobre bloques de 8176 bytes. Devuelve el bid. */
    addData(data: Buffer): number {
        if (data.length <= 8176) return this.writeBlock(data, false);
        const parts: number[] = [];
        for (let o = 0; o < data.length; o += 8176) parts.push(this.writeBlock(data.subarray(o, Math.min(data.length, o + 8176)), false));
        if (parts.length > 1000) throw new Error('pst_testkit_data_too_big');
        const x = Buffer.alloc(8 + parts.length * 8);
        x[0] = 0x01; x[1] = 0x01;
        x.writeUInt16LE(parts.length, 2);
        x.writeUInt32LE(data.length, 4);
        parts.forEach((b, i) => W(x, 8 + i * 8, b));
        return this.writeBlock(x, true);
    }
    /** Arbol de subnodos (SLBLOCK). Devuelve el bid del SLBLOCK o 0. */
    addSubs(subs: SubnodeSpec[]): number {
        if (subs.length === 0) return 0;
        const sorted = [...subs].sort((a, b) => a.nid - b.nid);
        const entries = sorted.map((s) => ({ nid: s.nid, data: this.addData(s.data), sub: this.addSubs(s.subs ?? []) }));
        const b = Buffer.alloc(8 + entries.length * 24);
        b[0] = 0x02; b[1] = 0x00;
        b.writeUInt16LE(entries.length, 2);
        entries.forEach((e, i) => { W(b, 8 + i * 24, e.nid); W(b, 8 + i * 24 + 8, e.data); W(b, 8 + i * 24 + 16, e.sub); });
        if (b.length > 8176) throw new Error('pst_testkit_slblock_too_big');
        return this.writeBlock(b, true);
    }
    addNode(nid: number, parent: number, data: Buffer, subs: SubnodeSpec[] = []) {
        this.nbt.push({ nid, bidData: this.addData(data), bidSub: this.addSubs(subs), parent });
    }

    /** Paginas del arbol (hojas + ramas) al final del archivo; devuelve { bid, ib } de la raiz. */
    private buildTree(entries: Array<{ key: number; raw: Buffer }>, entrySize: number, ptype: number): { bid: number; ib: number } {
        const sorted = [...entries].sort((a, b) => a.key - b.key);
        let level = 0;
        let cur: Array<{ key: number; raw: Buffer }> = sorted;
        let cap = Math.floor(488 / entrySize);
        for (;;) {
            const pages: Array<{ key: number; bid: number; ib: number }> = [];
            for (let i = 0; i < Math.max(cur.length, 1); i += cap) {
                const group = cur.slice(i, i + cap);
                const page = Buffer.alloc(512);
                group.forEach((e, j) => e.raw.copy(page, j * entrySize));
                page[488] = group.length; page[489] = cap; page[490] = entrySize; page[491] = level;
                page[496] = ptype; page[497] = ptype;
                const bid = (this.bidIdx++ << 2);
                W(page, 504, bid);
                const ib = align(this.cursor, 512);
                this.cursor = ib + 512;
                this.segments.push({ offset: ib, data: page });
                pages.push({ key: group[0]?.key ?? 0, bid, ib });
            }
            if (pages.length === 1) return pages[0];
            level++;
            cap = Math.floor(488 / 24);
            cur = pages.map((p) => { const raw = Buffer.alloc(24); W(raw, 0, p.key); W(raw, 8, p.bid); W(raw, 16, p.ib); return { key: p.key, raw }; });
            entrySize = 24;
        }
    }

    finish(padTo: number): SparsePst {
        // Las paginas del arbol se colocan tras el ultimo bloque
        this.cursor = align(this.cursor, 512);
        const bbtRoot = this.buildTree(this.bbt.map((e) => { const raw = Buffer.alloc(24); W(raw, 0, e.bid); W(raw, 8, e.ib); raw.writeUInt16LE(e.cb, 16); raw.writeUInt16LE(2, 18); return { key: e.bid, raw }; }), 24, 0x80);
        const nbtRoot = this.buildTree(this.nbt.map((e) => { const raw = Buffer.alloc(32); W(raw, 0, e.nid); W(raw, 8, e.bidData); W(raw, 16, e.bidSub); raw.writeUInt32LE(e.parent >>> 0, 24); return { key: e.nid, raw }; }), 32, 0x81);
        // Las hojas de NBT/BBT deben distinguirse de las ramas por cLevel (ya escrito); la cabecera apunta a las raices
        const size = Math.max(padTo, align(this.cursor, 512));
        const h = Buffer.alloc(564);
        h.write('!BDN', 0, 'latin1');
        h.writeUInt16LE(0x4d53, 8); h.writeUInt16LE(23, 10); h.writeUInt16LE(19, 12); h[14] = 1; h[15] = 1;
        W(h, 184, size); W(h, 192, 0);
        W(h, 216, nbtRoot.bid); W(h, 224, nbtRoot.ib);
        W(h, 232, bbtRoot.bid); W(h, 240, bbtRoot.ib);
        h[248] = 2; // fAMapValid
        h[512] = 0x80; // bSentinel
        h[513] = 0; // bCryptMethod: sin cifrado
        W(h, 516, this.bidIdx << 2);
        return new SparsePst(size, [{ offset: 0, data: h }, ...this.segments]);
    }
}

// --- Construccion de carpetas, mensajes y adjuntos -----------------------------------------------------------------------
function buildMessageParts(spec: PstMessageSpec, depth: number): { heap: Buffer; subs: SubnodeSpec[] } {
    let subCounter = 0x10;
    const newSub = () => ((subCounter++) << 5) | 0x1f;
    const props: Prop[] = [
        s16(0x001a, spec.messageClass ?? 'IPM.Note'),
        s16(0x0037, spec.subject),
        i4(0x0e07, (spec.read ? 1 : 0) | ((spec.attachments?.length ?? 0) > 0 ? 0x10 : 0)),
        { tag: 0x0039, type: T_TIME, v: filetime(spec.date ?? new Date(Date.UTC(2020, 0, 2, 3, 4, 5))) },
    ];
    if (spec.body !== undefined) props.push(s16(0x1000, spec.body));
    if (spec.html !== undefined) props.push(s16(0x1013, spec.html));
    if (spec.senderName) props.push(s16(0x0c1a, spec.senderName));
    if (spec.senderEmail) { props.push(s16(0x0c1e, 'SMTP'), s16(0x0c1f, spec.senderEmail)); }
    if (spec.headers) props.push(s16(0x007d, spec.headers));
    if (spec.messageId) props.push(s16(0x1035, spec.messageId));
    const built = buildPc(props, newSub);
    const subs: SubnodeSpec[] = [...built.extra];

    const recips: TcRow[] = [];
    let rid = 1;
    for (const [kind, list] of [[1, spec.to ?? []], [2, spec.cc ?? []]] as const) {
        for (const email of list) recips.push({ id: rid++, vals: new Map<number, number | Buffer>([[0x0c15, kind], [0x3001, str(email.split('@')[0])], [0x3002, str('SMTP')], [0x3003, str(email)], [0x39fe, str(email)]]) });
    }
    if (recips.length) subs.push({ nid: 0x692, data: buildTc(RECIP_COLS, recips) });

    const atts = spec.attachments ?? [];
    if (atts.length) {
        const nids: number[] = [];
        atts.forEach((a, i) => {
            const attNid = ((0x40 + i) << 5) | 0x05;
            nids.push(attNid);
            const aSubs: SubnodeSpec[] = [];
            let aSub = 0x20;
            const aNew = () => ((aSub++) << 5) | 0x1f;
            const ap: Prop[] = [i4(0x3705, a.embedded ? 5 : 1), s16(0x3707, a.name ?? `adjunto-${i + 1}`), s16(0x370e, a.mime ?? 'application/octet-stream')];
            if (a.cid) ap.push(s16(0x3712, a.cid));
            if (a.embedded) {
                if (depth >= 6) throw new Error('pst_testkit_depth');
                const emb = buildMessageParts(a.embedded, depth + 1);
                const embNid = (0x30 << 5) | 0x04;
                aSubs.push({ nid: embNid, data: emb.heap, subs: emb.subs });
                const ref = Buffer.alloc(8);
                ref.writeUInt32LE(embNid, 0);
                ref.writeUInt32LE(emb.heap.length, 4);
                ap.push({ tag: 0x3701, type: T_OBJECT, v: ref });
            } else {
                ap.push({ tag: 0x3701, type: T_BIN, v: a.data ?? Buffer.alloc(0) });
            }
            const apc = buildPc(ap, aNew);
            aSubs.push(...apc.extra);
            subs.push({ nid: attNid, data: apc.heap, subs: aSubs });
        });
        subs.push({ nid: 0x671, data: buildTc(ATT_COLS, nids.map((id, i) => ({ id, vals: new Map<number, number | Buffer>([[0x0e21, i]]) }))) });
    }
    return { heap: built.heap, subs };
}

export interface BuiltPst { pst: SparsePst; messageCount: number; folderCount: number }

/** Construye un PST con `folders` bajo la carpeta raiz. */
export function buildPst(folders: PstFolderSpec[], opts: PstBuildOptions = {}): BuiltPst {
    const st = new Store(opts.scatterStride ?? 0);
    let idx = 0x400;
    let messageCount = 0;
    let folderCount = 0;

    // Mapa de nombres (imprescindible: PSTFile lo lee al abrir). Un GUID, flujo de entradas y de cadenas no vacios.
    const n2i = buildPc([
        { tag: 0x0002, type: T_BIN, v: Buffer.alloc(16, 1) },
        { tag: 0x0003, type: T_BIN, v: Buffer.alloc(8) },
        { tag: 0x0004, type: T_BIN, v: Buffer.alloc(4) },
    ], () => 0);
    st.addNode(0x61, 0, n2i.heap);

    const addFolder = (nid: number, parent: number, spec: PstFolderSpec | null) => {
        const kids = spec?.children ?? [];
        const msgs = spec?.messages ?? [];
        const pc = buildPc([
            s16(0x3001, spec?.name ?? 'Top of Personal Folders'),
            i4(0x3602, msgs.length),
            i4(0x3603, 0),
            { tag: 0x360a, type: T_BOOL, v: kids.length ? 1 : 0 },
            s16(0x3613, spec?.containerClass ?? 'IPF.Note'),
        ], () => 0);
        st.addNode(nid, parent, pc.heap);
        const kidNids = kids.map(() => ((idx++) << 5) | 0x02);
        const msgNids = msgs.map(() => ((idx++) << 5) | 0x04);
        st.addNode(nid + 11, nid, buildTc(ROW_COLS, idRows(kidNids)));
        st.addNode(nid + 12, nid, buildTc(ROW_COLS, idRows(msgNids)));
        st.addNode(nid + 13, nid, buildTc(ROW_COLS, []));
        msgs.forEach((m, i) => {
            const parts = buildMessageParts(m, 0);
            st.addNode(msgNids[i], nid, parts.heap, parts.subs);
            messageCount++;
        });
        kids.forEach((k, i) => { folderCount++; addFolder(kidNids[i], nid, k); });
    };
    addFolder(290, 290, { name: 'Top of Personal Folders', children: folders });
    return { pst: st.finish(opts.padTo ?? 0), messageCount, folderCount: folderCount + 1 };
}
