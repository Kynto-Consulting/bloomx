
import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { isActiveContentType } from '@/lib/mail-validation';

const s3Client = new S3Client({
    region: process.env.B2_REGION,
    endpoint: process.env.B2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.B2_ACCESS_KEY!,
        secretAccessKey: process.env.B2_SECRET_KEY!,
    },
    forcePathStyle: true,
});

const BUCKET = process.env.B2_BUCKET!;

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
    // 1. Reconstruct Key from catch-all
    const { key: keyPath } = await params;
    // /api/assets/attachments/user/file.png -> key = "attachments/user/file.png"
    const key = keyPath.join('/');

    if (!key) {
        return NextResponse.json({ error: 'Key not provided' }, { status: 400 });
    }

    // Allowlist de prefijos servibles publicamente. Esta ruta es publica (los adjuntos se
    // referencian desde correos enviados y desde el proveedor), por lo que NUNCA debe exponer
    // payloads crudos (raw.json), cuerpos (content.html/txt), correos enviados ni secure/*.msg.
    const isUploadKey = key.startsWith('attachments/');
    const isInboundAttachmentKey = /^emails\/[^/]+\/[^/]+\/attachments\/[^/]+$/.test(key);
    if (
        key.length > 1024 ||
        key.includes('..') ||
        key.includes('\\') ||
        key.includes('\0') ||
        !(isUploadKey || isInboundAttachmentKey)
    ) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    try {
        const command = new GetObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Range: req.headers.get('range') || undefined,
        });

        // 2. Fetch from S3
        const response = await s3Client.send(command);

        // 3. Stream to Client
        // We need to convert the ReadableStream from SDK to a Web Response
        const headers = new Headers();
        // Contenido activo (html/svg/xml/js) jamas se sirve con su tipo original: evita XSS almacenado.
        const storedType = response.ContentType || 'application/octet-stream';
        headers.set('Content-Type', isActiveContentType(storedType) ? 'application/octet-stream' : storedType);
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
        headers.set('Referrer-Policy', 'no-referrer');
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin'); // se incrusta en correos enviados
        // Adjuntos de correos recibidos son privados: no cachear en caches compartidas.
        headers.set(
            'Cache-Control',
            isInboundAttachmentKey ? 'private, max-age=3600' : 'public, max-age=31536000, immutable',
        );

        let filename = req.nextUrl.searchParams.get('filename') || key.split('/').pop() || 'download';
        // Normalize filename to prevent Outlook/Acrobat decoding errors
        filename = filename.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9.\-_]/g, '_');
        
        headers.set('Content-Disposition', `attachment; filename="${filename}"`);

        if (response.ContentLength) {
            headers.set('Content-Length', response.ContentLength.toString());
        }

        // Transform the Body (which is a Node stream or Web stream depending on runtime)
        // In Next.js App Router (Node runtime), response.Body is a generic stream.
        // We can pass it directly to NextResponse if it's compatible, or read it.

        // Stream directly instead of buffering in memory
        const stream = response.Body?.transformToWebStream();

        if (!stream) {
            return NextResponse.json({ error: 'Empty file' }, { status: 404 });
        }

        const status = response.$metadata?.httpStatusCode || 200;
        if (response.ContentRange) {
            headers.set('Content-Range', response.ContentRange);
            headers.set('Accept-Ranges', 'bytes');
        }

        return new NextResponse(stream, {
            status,
            headers,
        });

    } catch (error: any) {
        console.error(`Error proxying asset ${key}:`, error);
        if (error.name === 'NoSuchKey') {
            return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
