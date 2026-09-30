
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getCurrentUser } from "@/lib/session";
import { uploadToStorage } from '@/lib/storage';
import { hasDangerousExtension } from '@/lib/mail-validation';
import { validateAttachment } from '@/lib/file-type';
import { scanBuffer, avShouldBlock } from '@/lib/av-hook';
import { buildSignedAssetUrl } from '@/lib/asset-url';
import { auditLog, getClientIp, rateLimitAsync } from '@/lib/security';

export async function POST(req: NextRequest) {
    try {
        const user = await getCurrentUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rl = await rateLimitAsync(`upload:${user.id}`, 120, 10 * 60_000);
        if (!rl.ok) {
            return NextResponse.json({ error: 'Too many uploads' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
        }

        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        // 200MB limit
        if (file.size > 200 * 1024 * 1024) {
            return NextResponse.json({ error: 'File size exceeds 200MB limit' }, { status: 400 });
        }

        if (file.size === 0) {
            return NextResponse.json({ error: 'Empty file' }, { status: 400 });
        }

        // Extensiones ejecutables / de script no se aceptan (vector de malware en correo saliente).
        if (hasDangerousExtension(file.name)) {
            return NextResponse.json({ error: 'File type not allowed' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // Tipo REAL por magic-bytes: rechaza ejecutables y contenido activo/contenedores disfrazados de imagen/documento.
        const verdict = validateAttachment({ filename: file.name, declaredMime: file.type, buffer, direction: 'upload' });
        if (verdict.verdict === 'blocked') {
            auditLog('attachment.blocked', { userId: user.id, reason: verdict.reason, direction: 'upload', ip: getClientIp(req) });
            return NextResponse.json({ error: 'File content not allowed' }, { status: 400 });
        }

        // Antivirus opcional (AV_SCAN_URL). Sin configurar: no hace nada.
        const av = await scanBuffer(buffer, file.name, { userId: user.id });
        if (avShouldBlock(av)) {
            return NextResponse.json(
                { error: av.status === 'infected' ? 'File rejected by antivirus' : 'File could not be scanned' },
                { status: av.status === 'infected' ? 422 : 503 }
            );
        }

        const timestamp = Date.now();
        // Sanitize filename
        const safeFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.{2,}/g, '_').slice(0, 200);
        // Componente aleatorio: la clave ya no es adivinable por (email, timestamp).
        // Se mantiene el prefijo attachments/<email>/ porque api/emails/route.ts valida la propiedad por ese prefijo.
        const key = `attachments/${user.email}/${timestamp}-${randomBytes(6).toString('hex')}-${safeFilename}`;

        // Tipos activos (html/svg/js) y contenido sospechoso se guardan como binario opaco para que nunca se rendericen.
        await uploadToStorage(key, buffer, verdict.storeMime);

        // URL FIRMADA (HMAC + caducidad ASSET_UPLOAD_URL_TTL_SECONDS, por defecto 30 dias) del proxy /api/assets.
        // Para correos enviados a terceros se usa la URL publica configurada, no el Host de la peticion.
        const origin = req.url.split('/api')[0];
        const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || origin).replace(/\/$/, '');
        const url = buildSignedAssetUrl(key, { baseUrl, filename: file.name });

        return NextResponse.json({
            url,
            key,
            filename: file.name,
            size: file.size,
            mimeType: verdict.storeMime
        });

    } catch (error) {
        console.error('Upload failed:', error);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}
