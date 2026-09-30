import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";
import { buildSignedAssetUrl } from "@/lib/asset-url";

const s3Client = new S3Client({
    region: env.S3_REGION || env.B2_REGION,
    endpoint: env.S3_ENDPOINT || env.B2_ENDPOINT,
    credentials: {
        accessKeyId: (env.S3_ACCESS_KEY || env.B2_ACCESS_KEY)!,
        secretAccessKey: (env.S3_SECRET_KEY || env.B2_SECRET_KEY)!,
    },
    forcePathStyle: true,
});

const BUCKET = (env.S3_BUCKET || env.B2_BUCKET)!;

const SSE_RAW = String(process.env.S3_SSE || '').trim();
const SSE_MODE: 'AES256' | 'aws:kms' | undefined =
    SSE_RAW === 'AES256' || SSE_RAW === 'aws:kms' ? SSE_RAW : undefined;

// Basic Local Storage Implementation for Dev
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

const isS3Configured = (env.S3_ACCESS_KEY || env.B2_ACCESS_KEY) && (env.S3_BUCKET || env.B2_BUCKET);
const LOCAL_STORAGE_PATH = path.join(process.cwd(), '.gemini', 'storage');

// Evita path traversal en el almacenamiento local (dev): la clave nunca puede salir de LOCAL_STORAGE_PATH.
function localPathFor(key: string): string {
    const full = path.resolve(LOCAL_STORAGE_PATH, key);
    if (full !== LOCAL_STORAGE_PATH && !full.startsWith(LOCAL_STORAGE_PATH + path.sep)) {
        throw new Error('Invalid storage key');
    }
    return full;
}

// Helper to stream to buffer
async function streamToBuffer(stream: ReadableStream | Readable): Promise<Buffer> {
    if (stream instanceof Readable) {
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    }
    // Web Stream
    const reader = (stream as any).getReader();
    const chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

export async function uploadToStorage(key: string, body: Buffer | string | ReadableStream, contentType: string) {
    if (isS3Configured) {
        try {
            const upload = new Upload({
                client: s3Client,
                params: {
                    Bucket: BUCKET,
                    Key: key,
                    Body: body,
                    ContentType: contentType,
                    // Cifrado en reposo del lado del proveedor (opt-in: S3_SSE=AES256 o aws:kms).
                    ...(SSE_MODE ? { ServerSideEncryption: SSE_MODE } : {}),
                },
            });
            await upload.done();
            return key;
        } catch (error) {
            console.error("Error uploading to storage:", error);
            throw error;
        }
    } else {
        // Local Fallback
        const fullPath = localPathFor(key);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });

        let buffer;
        if (typeof body === 'string') buffer = Buffer.from(body);
        else if (Buffer.isBuffer(body)) buffer = body;
        else buffer = await streamToBuffer(body as any);

        await fs.promises.writeFile(fullPath, buffer);
        console.log(`[Storage] Saved locally: ${fullPath}`);
        return key;
    }
}

export async function getFromStorage(key: string) {
    if (isS3Configured) {
        try {
            const command = new GetObjectCommand({
                Bucket: BUCKET,
                Key: key,
            });
            const response = await s3Client.send(command);
            return response.Body?.transformToString();
        } catch (error) {
            console.error("Error getting from storage:", error);
            return null;
        }
    } else {
        // Local Fallback
        try {
            const fullPath = localPathFor(key);
            if (!fs.existsSync(fullPath)) return null;
            const content = await fs.promises.readFile(fullPath, 'utf8');
            return content;
        } catch (e) {
            return null;
        }
    }
}

export async function getBufferFromStorage(key: string): Promise<Buffer | null> {
    if (isS3Configured) {
        try {
            const response = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
            const bytes = await response.Body?.transformToByteArray();
            return bytes ? Buffer.from(bytes) : null;
        } catch (error) {
            console.error("Error getting binary from storage:", error);
            return null;
        }
    }
    try {
        const fullPath = localPathFor(key);
        if (!fs.existsSync(fullPath)) return null;
        return await fs.promises.readFile(fullPath);
    } catch (e) {
        return null;
    }
}

export async function deleteFromStorage(key: string): Promise<boolean> {
    if (isS3Configured) {
        try {
            await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
            return true;
        } catch (error) {
            console.error("Error deleting from storage:", error);
            return false;
        }
    } else {
        try {
            await fs.promises.unlink(localPathFor(key));
            return true;
        } catch (e: any) {
            return e?.code === 'ENOENT'; // ya no existia: objetivo cumplido
        }
    }
}

export interface StorageObjectInfo { key: string; lastModified?: Date; size?: number }

/** Lista objetos bajo un prefijo (paginado). Para retencion y barrido de huerfanos. */
export async function listStorageObjects(prefix: string, max = 10_000): Promise<StorageObjectInfo[]> {
    const out: StorageObjectInfo[] = [];
    if (isS3Configured) {
        let token: string | undefined;
        do {
            const res: any = await s3Client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
            for (const o of res.Contents || []) {
                if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified, size: o.Size });
                if (out.length >= max) return out;
            }
            token = res.IsTruncated ? res.NextContinuationToken : undefined;
        } while (token);
        return out;
    }
    const root = localPathFor(prefix.replace(/\/+$/, '') || '.');
    const walk = async (dir: string) => {
        let entries: fs.Dirent[] = [];
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                await walk(full);
            } else {
                const st = await fs.promises.stat(full);
                const key = path.relative(LOCAL_STORAGE_PATH, full).split(path.sep).join('/');
                if (key.startsWith(prefix)) out.push({ key, lastModified: st.mtime, size: st.size });
            }
            if (out.length >= max) return;
        }
    };
    await walk(root);
    return out;
}

/** Borra un conjunto de claves. Devuelve las que fallaron (para reintentar / reportar). */
export async function deleteManyFromStorage(keys: string[]): Promise<{ deleted: number; failed: string[] }> {
    const unique = Array.from(new Set(keys.filter(Boolean)));
    let deleted = 0;
    const failed: string[] = [];
    if (isS3Configured) {
        for (let i = 0; i < unique.length; i += 1000) {
            const batch = unique.slice(i, i + 1000);
            try {
                const res: any = await s3Client.send(new DeleteObjectsCommand({
                    Bucket: BUCKET,
                    Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
                }));
                const errs: any[] = res.Errors || [];
                failed.push(...errs.map((e) => String(e.Key)));
                deleted += batch.length - errs.length;
            } catch (error) {
                console.error("Error bulk deleting from storage:", error);
                failed.push(...batch);
            }
        }
    } else {
        for (const k of unique) {
            if (await deleteFromStorage(k)) deleted++;
            else failed.push(k);
        }
    }
    return { deleted, failed };
}

/** Borra todo lo que cuelga de un prefijo (p. ej. emails/<fecha>/<uuid>/): cubre adjuntos huerfanos o renombrados. */
export async function deleteStoragePrefix(prefix: string): Promise<{ deleted: number; failed: string[] }> {
    if (!prefix || prefix === '/' || prefix.split('/').filter(Boolean).length < 2) {
        throw new Error('Refusing to delete a broad storage prefix');
    }
    const objs = await listStorageObjects(prefix.endsWith('/') ? prefix : prefix + '/');
    return deleteManyFromStorage(objs.map((o) => o.key));
}

export interface StorageObjectStream {
    body: ReadableStream;
    contentType?: string;
    contentLength?: number;
    contentRange?: string;
    status: number;
}

/** Objeto como stream web (con soporte de Range) para el proxy /api/assets. Devuelve null si no existe. */
export async function getObjectStream(key: string, range?: string | null): Promise<StorageObjectStream | null> {
    if (isS3Configured) {
        try {
            const res = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: range || undefined }));
            const body = res.Body?.transformToWebStream();
            if (!body) return null;
            return {
                body: body as ReadableStream,
                contentType: res.ContentType,
                contentLength: res.ContentLength,
                contentRange: res.ContentRange,
                status: res.$metadata?.httpStatusCode || 200,
            };
        } catch (error: any) {
            if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
            throw error;
        }
    }
    try {
        const buf = await getBufferFromStorage(key);
        if (!buf) return null;
        let slice = buf;
        let status = 200;
        let contentRange: string | undefined;
        const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
        if (m && (m[1] || m[2])) {
            const start = m[1] ? Number(m[1]) : Math.max(0, buf.length - Number(m[2]));
            const end = m[1] && m[2] ? Math.min(Number(m[2]), buf.length - 1) : buf.length - 1;
            if (start <= end && start < buf.length) {
                slice = buf.subarray(start, end + 1);
                status = 206;
                contentRange = `bytes ${start}-${end}/${buf.length}`;
            }
        }
        const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(slice)); c.close(); } });
        return { body, contentLength: slice.length, contentRange, status };
    } catch {
        return null;
    }
}

/**
 * URL de descarga FIRMADA (HMAC + caducidad) para el proxy /api/assets. Ver lib/asset-url.ts para TTL y politica.
 * (Antes devolvia una URL permanente sin firma.)
 */
export async function getSignedDownloadUrl(key: string, filename?: string) {
    return buildSignedAssetUrl(key, { baseUrl: env.NEXT_PUBLIC_APP_URL || '', filename });
}
