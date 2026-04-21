import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

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

// Basic Local Storage Implementation for Dev
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

const isS3Configured = (env.S3_ACCESS_KEY || env.B2_ACCESS_KEY) && (env.S3_BUCKET || env.B2_BUCKET);
const LOCAL_STORAGE_PATH = path.join(process.cwd(), '.gemini', 'storage');

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
        const fullPath = path.join(LOCAL_STORAGE_PATH, key);
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
            const fullPath = path.join(LOCAL_STORAGE_PATH, key);
            if (!fs.existsSync(fullPath)) return null;
            const content = await fs.promises.readFile(fullPath, 'utf8');
            return content;
        } catch (e) {
            return null;
        }
    }
}

export async function deleteFromStorage(key: string) {
    if (isS3Configured) {
        try {
            const command = new DeleteObjectCommand({
                Bucket: BUCKET,
                Key: key,
            });
            await s3Client.send(command);
        } catch (error) {
            console.error("Error deleting from storage:", error);
        }
    } else {
        try {
            const fullPath = path.join(LOCAL_STORAGE_PATH, key);
            await fs.promises.unlink(fullPath);
        } catch (e) { }
    }
}

export async function getSignedDownloadUrl(key: string, filename?: string) {
    const baseUrl = env.NEXT_PUBLIC_APP_URL || '';
    // Normalize filename for the URL query param to avoid encoding issues
    const safeFilename = filename ? filename.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9.\-_]/g, '_') : undefined;
    
    // Serve via internal proxy to avoid Outlook Safelinks corrupting long S3 signatures 
    // and to handle byte-range requests properly.
    let url = `${baseUrl.replace(/\/$/, '')}/api/assets/${key}`;
    if (safeFilename) {
        url += `?filename=${encodeURIComponent(safeFilename)}`;
    }
    
    return url;
}

