// S3 FALSO para pruebas locales de src/lib/storage.ts (path-style /bucket/key). Almacen en memoria; solo 127.0.0.1.
// Uso como libreria: const s3 = await startFakeS3({ port?, bucket?, pageSize?, requireAuth?, secretKey?, minPartSize? })
//   -> { url, port, bucket, stop(), objects, uploads, stats, faults, failDeleteKeys, reset() }
// Uso CLI: node scripts/fake-s3.mjs [--port 9000] [--bucket test-bucket] [--page-size 1000] [--require-auth] [--secret-key K]
//
// Operaciones: PutObject (aws-chunked/streaming + trailer decodificados, valida checksums), GetObject (Range), HeadObject,
// DeleteObject, DeleteObjects (<=1000, Quiet), ListObjectsV2 (prefix, delimiter, max-keys, continuation-token, start-after),
// multipart (Create/UploadPart/Complete/Abort con ETag "md5(md5s)-N" y validacion de partes). Errores XML estandar de S3.
// Con requireAuth exige una firma SigV4 presente (cabecera Authorization o query X-Amz-Signature); si ademas se pasa
// `secretKey`, la firma de cabecera se RECALCULA y se compara (detecta canonizacion incorrecta en el cliente).
// NO valida politicas, ACLs, versionado ni CopyObject (responde NotImplemented). Sin dependencias.
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const MIB = 1024 * 1024;

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const xmlUnesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const md5 = (b) => crypto.createHash('md5').update(b).digest();
const etagOf = (b) => `"${md5(b).toString('hex')}"`;
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

class S3Error extends Error {
    constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

function crc32(buf) {
    if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}
const b64 = (buf) => Buffer.from(buf).toString('base64');
const crcB64 = (buf) => { const b = Buffer.alloc(4); b.writeUInt32BE(crc32(buf)); return b64(b); };

/** Decodifica un cuerpo aws-chunked: `hex[;chunk-signature=..]\r\n data \r\n ... 0\r\n trailers\r\n\r\n`. */
function decodeAwsChunked(raw) {
    const parts = [];
    let pos = 0;
    for (;;) {
        const eol = raw.indexOf('\r\n', pos);
        if (eol < 0) throw new S3Error(400, 'IncompleteBody', 'aws-chunked truncado');
        const header = raw.subarray(pos, eol).toString('latin1');
        const size = parseInt(header.split(';')[0], 16);
        if (!Number.isFinite(size)) throw new S3Error(400, 'InvalidRequest', 'aws-chunked: tamano de trozo invalido');
        pos = eol + 2;
        if (size === 0) break;
        if (pos + size + 2 > raw.length) throw new S3Error(400, 'IncompleteBody', 'aws-chunked truncado');
        parts.push(raw.subarray(pos, pos + size));
        pos += size + 2;
    }
    const trailers = {};
    for (const line of raw.subarray(pos).toString('latin1').split('\r\n')) {
        const i = line.indexOf(':');
        if (i > 0) trailers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    return { body: Buffer.concat(parts), trailers };
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

/** Lee el cuerpo, decodifica aws-chunked y valida Content-MD5 / x-amz-checksum-* (cabecera o trailer). */
async function readPayload(req, stats) {
    let raw = await readBody(req);
    const sha = String(req.headers['x-amz-content-sha256'] || '');
    const enc = String(req.headers['content-encoding'] || '');
    let trailers = {};
    if (sha.startsWith('STREAMING-') || /aws-chunked/i.test(enc)) {
        const d = decodeAwsChunked(raw);
        raw = d.body;
        trailers = d.trailers;
        stats.awsChunkedBodies++;
        const declared = req.headers['x-amz-decoded-content-length'];
        if (declared !== undefined && Number(declared) !== raw.length) throw new S3Error(400, 'IncompleteBody', 'x-amz-decoded-content-length no coincide');
    }
    const h = (n) => req.headers[n] ?? trailers[n];
    let hadChecksum = false;
    const bad = (what) => new S3Error(400, 'BadDigest', `El ${what} indicado no coincide con el recibido`);
    if (req.headers['content-md5']) { hadChecksum = true; if (String(req.headers['content-md5']) !== b64(md5(raw))) throw bad('Content-MD5'); }
    if (h('x-amz-checksum-crc32')) { hadChecksum = true; if (h('x-amz-checksum-crc32') !== crcB64(raw)) throw bad('CRC32'); }
    if (h('x-amz-checksum-sha256')) { hadChecksum = true; if (h('x-amz-checksum-sha256') !== b64(crypto.createHash('sha256').update(raw).digest())) throw bad('SHA256'); }
    if (h('x-amz-checksum-sha1')) { hadChecksum = true; if (h('x-amz-checksum-sha1') !== b64(crypto.createHash('sha1').update(raw).digest())) throw bad('SHA1'); }
    if (hadChecksum) stats.requestsWithChecksum++;
    if (/^[0-9a-f]{64}$/.test(sha) && sha !== crypto.createHash('sha256').update(raw).digest('hex')) throw new S3Error(400, 'XAmzContentSHA256Mismatch', 'x-amz-content-sha256 no coincide');
    return raw;
}

function parseRange(header, size) {
    if (!header) return null;
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
    if (!m || (m[1] === '' && m[2] === '')) return null; // sintaxis invalida: S3 la ignora y devuelve 200 completo
    let start, end;
    if (m[1] === '') {
        const n = Number(m[2]);
        if (n === 0) return 'unsatisfiable';
        start = Math.max(0, size - n); end = size - 1;
    } else {
        start = Number(m[1]);
        end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
        if (m[2] !== '' && Number(m[2]) < start) return null; // a>b: S3 ignora la cabecera
    }
    if (size === 0 || start >= size) return 'unsatisfiable';
    return { start, end };
}

function isoDate(d) { return new Date(d).toISOString().replace(/\.\d{3}Z$/, '.000Z'); }

/** Verificacion SigV4 de cabecera: recalcula la firma con `secretKey`. */
function verifySigV4(req, url, secretKey, payloadHash) {
    const auth = String(req.headers.authorization || '');
    const m = /^AWS4-HMAC-SHA256\s+Credential=([^,\s]+),\s*SignedHeaders=([^,\s]+),\s*Signature=([0-9a-f]{64})$/.exec(auth);
    if (!m) throw new S3Error(403, 'AccessDenied', 'Authorization mal formada');
    const [, cred, signedHeaders, signature] = m;
    const [, date, region, service] = cred.split('/');
    const amzDate = String(req.headers['x-amz-date'] || '');
    const canonHeaders = signedHeaders.split(';').map((n) => `${n}:${String(req.headers[n] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
    const q = [...url.searchParams.entries()].map(([k, v]) => [rfc3986(k), rfc3986(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
    const canonQuery = q.map(([k, v]) => `${k}=${v}`).join('&');
    const rawPath = (req.url || '/').split('?')[0];
    const canonical = [req.method, rawPath, canonQuery, canonHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${date}/${region}/${service}/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonical).digest('hex')].join('\n');
    const hm = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
    const key = hm(hm(hm(hm('AWS4' + secretKey, date), region), service), 'aws4_request');
    const expected = crypto.createHmac('sha256', key).update(toSign).digest('hex');
    if (expected !== signature) throw new S3Error(403, 'SignatureDoesNotMatch', 'La firma calculada no coincide con la enviada');
}

export async function startFakeS3(opts = {}) {
    if (process.env.NODE_ENV === 'production') throw new Error('fake-s3: se niega a arrancar con NODE_ENV=production');
    const host = opts.host ?? '127.0.0.1';
    if (!LOOPBACK.has(host)) throw new Error(`fake-s3: solo se permite loopback (recibido "${host}")`);
    const bucket = opts.bucket ?? 'test-bucket';
    const pageSize = Math.max(1, opts.pageSize ?? 1000);
    const minPartSize = opts.minPartSize ?? 5 * MIB;
    const requireAuth = !!opts.requireAuth;

    /** @type {Map<string, {body: Buffer, contentType: string, etag: string, lastModified: number, sse?: string, headers: Record<string,string>}>} */
    const objects = new Map();
    /** @type {Map<string, {key: string, parts: Map<number, {body: Buffer, etag: string}>, contentType: string, sse?: string}>} */
    const uploads = new Map();
    const newStats = () => ({
        requests: 0, putObject: 0, getObject: 0, headObject: 0, deleteObject: 0, deleteObjectsCalls: 0, deleteObjectsKeys: 0,
        listCalls: 0, createMultipart: 0, uploadPart: 0, completeMultipart: 0, abortMultipart: 0,
        denied: 0, errors: 0, awsChunkedBodies: 0, requestsWithChecksum: 0, sseSeen: [], ranges: [], listPageKeys: [], deleteBatchSizes: [],
    });
    const stats = newStats();
    /** Fallos inyectables: { op: 'getObject'|..., status, code, times, key? } (se consumen). */
    const faults = [];
    /** Claves que DeleteObjects debe reportar como <Error> (AccessDenied). */
    const failDeleteKeys = new Set(opts.failDeleteKeys ?? []);

    const takeFault = (op, key) => {
        const i = faults.findIndex((f) => f.op === op && (!f.key || f.key === key) && (f.times ?? 1) > 0);
        if (i < 0) return null;
        const f = faults[i];
        f.times = (f.times ?? 1) - 1;
        if (f.times <= 0) faults.splice(i, 1);
        return f;
    };

    async function handle(req, res) {
        stats.requests++;
        const url = new URL(req.url || '/', 'http://fake');
        const send = (status, body = '', headers = {}) => {
            const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
            res.writeHead(status, { 'content-length': buf.length, 'x-amz-request-id': crypto.randomBytes(8).toString('hex'), ...headers });
            res.end(req.method === 'HEAD' ? undefined : buf);
        };
        const xml = (status, inner, root, headers = {}) =>
            send(status, `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${inner}</${root}>`, { 'content-type': 'application/xml', ...headers });

        try {
            // --- autenticacion ---
            if (requireAuth) {
                const auth = String(req.headers.authorization || '');
                const presigned = url.searchParams.get('X-Amz-Signature');
                if (!/^AWS4-HMAC-SHA256 /.test(auth) && !presigned) { stats.denied++; throw new S3Error(403, 'AccessDenied', 'Access Denied'); }
                if (opts.secretKey && !presigned) {
                    try { verifySigV4(req, url, opts.secretKey, String(req.headers['x-amz-content-sha256'] || 'UNSIGNED-PAYLOAD')); }
                    catch (e) { stats.denied++; throw e; }
                }
            }

            // --- ruta path-style ---
            const segs = url.pathname.split('/').filter((_, i) => i > 0);
            const bkt = decodeURIComponent(segs[0] || '');
            const key = segs.length > 1 ? decodeURIComponent(url.pathname.slice(1 + segs[0].length + 1)) : '';
            if (!bkt) throw new S3Error(501, 'NotImplemented', 'ListBuckets no soportado');
            if (bkt !== bucket) throw new S3Error(404, 'NoSuchBucket', 'The specified bucket does not exist', { BucketName: bkt });
            const q = url.searchParams;
            const m = req.method;

            const sseHeader = req.headers['x-amz-server-side-encryption'];

            if (!key) {
                // ----- nivel bucket -----
                if (m === 'GET' && (q.get('list-type') === '2' || !q.has('list-type'))) {
                    stats.listCalls++;
                    const f = takeFault('listObjectsV2'); if (f) throw new S3Error(f.status ?? 500, f.code ?? 'InternalError', 'fallo inyectado');
                    const prefix = q.get('prefix') ?? '';
                    const delimiter = q.get('delimiter') ?? '';
                    const maxKeys = Math.min(q.has('max-keys') ? Math.max(0, Number(q.get('max-keys'))) : 1000, pageSize);
                    const tokenRaw = q.get('continuation-token');
                    const startAfter = tokenRaw ? Buffer.from(tokenRaw, 'base64url').toString('utf8') : (q.get('start-after') ?? '');
                    const urlEnc = q.get('encoding-type') === 'url';
                    const enc = (s) => (urlEnc ? rfc3986(s).replace(/%2F/g, '/') : xmlEsc(s));
                    const all = [...objects.keys()].filter((k) => k.startsWith(prefix) && k > startAfter).sort();
                    const contents = []; const commons = []; const seen = new Set();
                    let last = ''; let truncated = false; let count = 0;
                    for (const k of all) {
                        let entry = k;
                        if (delimiter) {
                            const i = k.indexOf(delimiter, prefix.length);
                            if (i >= 0) {
                                const cp = k.slice(0, i + delimiter.length);
                                if (seen.has(cp)) { last = k; continue; }
                                entry = cp;
                            }
                        }
                        if (count >= maxKeys) { truncated = true; break; }
                        count++; last = k;
                        if (entry !== k) { seen.add(entry); commons.push(entry); } else contents.push(k);
                    }
                    stats.listPageKeys.push(count);
                    const body = contents.map((k) => { const o = objects.get(k); return `<Contents><Key>${enc(k)}</Key><LastModified>${isoDate(o.lastModified)}</LastModified><ETag>${xmlEsc(o.etag)}</ETag><Size>${o.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`; }).join('')
                        + commons.map((c) => `<CommonPrefixes><Prefix>${enc(c)}</Prefix></CommonPrefixes>`).join('');
                    return xml(200, `<Name>${xmlEsc(bucket)}</Name><Prefix>${enc(prefix)}</Prefix>${delimiter ? `<Delimiter>${xmlEsc(delimiter)}</Delimiter>` : ''}<MaxKeys>${maxKeys}</MaxKeys>${urlEnc ? '<EncodingType>url</EncodingType>' : ''}<KeyCount>${count}</KeyCount><IsTruncated>${truncated}</IsTruncated>${tokenRaw ? `<ContinuationToken>${xmlEsc(tokenRaw)}</ContinuationToken>` : ''}${truncated ? `<NextContinuationToken>${Buffer.from(last).toString('base64url')}</NextContinuationToken>` : ''}${body}`, 'ListBucketResult');
                }
                if (m === 'POST' && q.has('delete')) {
                    stats.deleteObjectsCalls++;
                    const f = takeFault('deleteObjects'); if (f) throw new S3Error(f.status ?? 500, f.code ?? 'InternalError', 'fallo inyectado');
                    const raw = await readPayload(req, stats);
                    const text = raw.toString('utf8');
                    if (!/^\s*(<\?xml[^>]*\?>\s*)?<Delete[\s>]/.test(text) || !/<\/Delete>\s*$/.test(text)) throw new S3Error(400, 'MalformedXML', 'The XML you provided was not well-formed');
                    const keys = [...text.matchAll(/<Object>\s*<Key>([\s\S]*?)<\/Key>/g)].map((x) => xmlUnesc(x[1]));
                    if (keys.length === 0) throw new S3Error(400, 'MalformedXML', 'The XML you provided was not well-formed or did not validate against our published schema');
                    if (keys.length > 1000) throw new S3Error(400, 'MalformedXML', 'The XML you provided was not well-formed or did not validate against our published schema');
                    const quiet = /<Quiet>\s*true\s*<\/Quiet>/i.test(text);
                    stats.deleteBatchSizes.push(keys.length);
                    stats.deleteObjectsKeys += keys.length;
                    let out = '';
                    for (const k of keys) {
                        if (failDeleteKeys.has(k)) { out += `<Error><Key>${xmlEsc(k)}</Key><Code>AccessDenied</Code><Message>Access Denied</Message></Error>`; continue; }
                        objects.delete(k);
                        if (!quiet) out += `<Deleted><Key>${xmlEsc(k)}</Key></Deleted>`;
                    }
                    return xml(200, out, 'DeleteResult');
                }
                throw new S3Error(501, 'NotImplemented', `Operacion de bucket no soportada: ${m} ${url.search}`);
            }

            // ----- nivel objeto -----
            if (q.has('uploads') && m === 'POST') {
                stats.createMultipart++;
                const f = takeFault('createMultipart', key); if (f) throw new S3Error(f.status ?? 500, f.code ?? 'InternalError', 'fallo inyectado');
                await readBody(req);
                const id = crypto.randomBytes(12).toString('hex');
                uploads.set(id, { key, parts: new Map(), contentType: String(req.headers['content-type'] || 'binary/octet-stream'), sse: sseHeader });
                if (sseHeader) stats.sseSeen.push(String(sseHeader));
                return xml(200, `<Bucket>${xmlEsc(bucket)}</Bucket><Key>${xmlEsc(key)}</Key><UploadId>${id}</UploadId>`, 'InitiateMultipartUploadResult');
            }
            const uploadId = q.get('uploadId');
            if (uploadId) {
                const up = uploads.get(uploadId);
                if (!up || up.key !== key) { await readBody(req); throw new S3Error(404, 'NoSuchUpload', 'The specified upload does not exist', { UploadId: uploadId }); }
                if (m === 'PUT' && q.has('partNumber')) {
                    stats.uploadPart++;
                    const f = takeFault('uploadPart', key); if (f) throw new S3Error(f.status ?? 500, f.code ?? 'InternalError', 'fallo inyectado');
                    const n = Number(q.get('partNumber'));
                    if (!Number.isInteger(n) || n < 1 || n > 10000) throw new S3Error(400, 'InvalidArgument', 'Part number must be an integer between 1 and 10000');
                    const body = await readPayload(req, stats);
                    const etag = etagOf(body);
                    up.parts.set(n, { body, etag });
                    return send(200, '', { etag });
                }
                if (m === 'POST') {
                    stats.completeMultipart++;
                    const f = takeFault('completeMultipart', key); if (f) throw new S3Error(f.status ?? 500, f.code ?? 'InternalError', 'fallo inyectado');
                    const text = (await readBody(req)).toString('utf8');
                    const listed = [...text.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map((x) => ({
                        n: Number(/<PartNumber>\s*(\d+)\s*<\/PartNumber>/.exec(x[1])?.[1]),
                        etag: xmlUnesc(/<ETag>([\s\S]*?)<\/ETag>/.exec(x[1])?.[1] ?? '').trim(),
                    }));
                    if (!listed.length) throw new S3Error(400, 'MalformedXML', 'The XML you provided was not well-formed or did not validate against our published schema');
                    for (let i = 0; i < listed.length; i++) {
                        const p = listed[i];
                        if (i > 0 && p.n <= listed[i - 1].n) throw new S3Error(400, 'InvalidPartOrder', 'The list of parts was not in ascending order');
                        const have = up.parts.get(p.n);
                        const norm = (e) => e.replace(/^"|"$/g, '');
                        if (!have || norm(have.etag) !== norm(p.etag)) throw new S3Error(400, 'InvalidPart', 'One or more of the specified parts could not be found or the specified entity tag did not match', { UploadId: uploadId });
                        if (i < listed.length - 1 && have.body.length < minPartSize) throw new S3Error(400, 'EntityTooSmall', 'Your proposed upload is smaller than the minimum allowed size', { ProposedSize: have.body.length, MinSizeAllowed: minPartSize });
                    }
                    const bodies = listed.map((p) => up.parts.get(p.n).body);
                    const body = Buffer.concat(bodies);
                    const etag = `"${crypto.createHash('md5').update(Buffer.concat(bodies.map(md5))).digest('hex')}-${listed.length}"`;
                    objects.set(key, { body, contentType: up.contentType, etag, lastModified: Date.now(), sse: up.sse, headers: {} });
                    uploads.delete(uploadId);
                    return xml(200, `<Location>${xmlEsc(`http://${req.headers.host}/${bucket}/${key}`)}</Location><Bucket>${xmlEsc(bucket)}</Bucket><Key>${xmlEsc(key)}</Key><ETag>${xmlEsc(etag)}</ETag>`, 'CompleteMultipartUploadResult');
                }
                if (m === 'DELETE') {
                    stats.abortMultipart++;
                    uploads.delete(uploadId);
                    return send(204);
                }
                throw new S3Error(501, 'NotImplemented', 'Operacion multipart no soportada');
            }

            if (m === 'PUT') {
                if (req.headers['x-amz-copy-source']) throw new S3Error(501, 'NotImplemented', 'CopyObject no soportado');
                stats.putObject++;
                const f = takeFault('putObject', key); if (f) { await readBody(req); throw new S3Error(f.status ?? 500, f.code ?? 'InternalError', 'fallo inyectado'); }
                const body = await readPayload(req, stats);
                const meta = {};
                for (const [h, v] of Object.entries(req.headers)) if (h.startsWith('x-amz-meta-')) meta[h] = String(v);
                objects.set(key, { body, contentType: String(req.headers['content-type'] || 'binary/octet-stream'), etag: etagOf(body), lastModified: Date.now(), sse: sseHeader ? String(sseHeader) : undefined, headers: meta });
                if (sseHeader) stats.sseSeen.push(String(sseHeader));
                return send(200, '', { etag: etagOf(body), ...(sseHeader ? { 'x-amz-server-side-encryption': String(sseHeader) } : {}) });
            }
            if (m === 'GET' || m === 'HEAD') {
                const op = m === 'GET' ? 'getObject' : 'headObject';
                stats[op]++;
                const f = takeFault(op, key); if (f) throw new S3Error(f.status ?? 500, f.code ?? 'InternalError', 'fallo inyectado');
                const o = objects.get(key);
                if (!o) throw new S3Error(404, 'NoSuchKey', 'The specified key does not exist.', { Key: key });
                const common = { 'content-type': o.contentType, etag: o.etag, 'last-modified': new Date(o.lastModified).toUTCString(), 'accept-ranges': 'bytes', ...(o.sse ? { 'x-amz-server-side-encryption': o.sse } : {}), ...o.headers };
                const rangeHdr = req.headers.range;
                if (rangeHdr && m === 'GET') stats.ranges.push(String(rangeHdr));
                const r = parseRange(rangeHdr, o.body.length);
                if (r === 'unsatisfiable') {
                    return xml(416, `<Code>InvalidRange</Code><Message>The requested range is not satisfiable</Message><ActualObjectSize>${o.body.length}</ActualObjectSize><RangeRequested>${xmlEsc(String(rangeHdr))}</RangeRequested>`, 'Error', { 'content-range': `bytes */${o.body.length}` });
                }
                if (r) {
                    const slice = o.body.subarray(r.start, r.end + 1);
                    res.writeHead(206, { ...common, 'content-length': slice.length, 'content-range': `bytes ${r.start}-${r.end}/${o.body.length}` });
                    return res.end(m === 'HEAD' ? undefined : slice);
                }
                res.writeHead(200, { ...common, 'content-length': o.body.length });
                return res.end(m === 'HEAD' ? undefined : o.body);
            }
            if (m === 'DELETE') {
                stats.deleteObject++;
                const f = takeFault('deleteObject', key); if (f) throw new S3Error(f.status ?? 500, f.code ?? 'InternalError', 'fallo inyectado');
                objects.delete(key); // idempotente: 204 aunque no exista
                return send(204);
            }
            throw new S3Error(405, 'MethodNotAllowed', 'The specified method is not allowed against this resource.');
        } catch (e) {
            stats.errors++;
            const err = e instanceof S3Error ? e : new S3Error(500, 'InternalError', e instanceof Error ? e.message : 'error');
            if (!req.readableEnded) { try { await readBody(req); } catch { /* ignorado */ } }
            if (res.headersSent) return res.destroy();
            const extra = Object.entries(err.extra).map(([k, v]) => `<${k}>${xmlEsc(v)}</${k}>`).join('');
            return xml(err.status, `<Code>${err.code}</Code><Message>${xmlEsc(err.message)}</Message>${extra}<RequestId>fake</RequestId>`, 'Error');
        }
    }

    const server = http.createServer((req, res) => { handle(req, res).catch(() => { try { res.destroy(); } catch { /* */ } }); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(opts.port ?? 0, host, resolve); });
    const port = server.address().port;
    return {
        url: `http://${host}:${port}`,
        port, bucket, objects, uploads, stats, faults, failDeleteKeys,
        reset() { objects.clear(); uploads.clear(); faults.length = 0; failDeleteKeys.clear(); Object.assign(stats, newStats()); },
        stop() { server.closeAllConnections?.(); return new Promise((r) => server.close(() => r())); },
    };
}

// --- CLI ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
    const s3 = await startFakeS3({
        host: arg('host', '127.0.0.1'), port: Number(arg('port', 0)), bucket: arg('bucket', 'test-bucket'),
        pageSize: Number(arg('page-size', 1000)), requireAuth: process.argv.includes('--require-auth'), secretKey: arg('secret-key', undefined),
    });
    console.log(`fake-s3 escuchando en ${s3.url} (bucket ${s3.bucket})`);
    const bye = () => s3.stop().then(() => process.exit(0));
    process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
