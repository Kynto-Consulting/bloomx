
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from "@/lib/session";
import { uploadToStorage } from '@/lib/storage';
import { hasDangerousExtension, isActiveContentType } from '@/lib/mail-validation';

export async function POST(req: NextRequest) {
    try {
        const user = await getCurrentUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
        const timestamp = Date.now();
        // Sanitize filename
        const safeFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.{2,}/g, '_').slice(0, 200);
        const key = `attachments/${user.email}/${timestamp}-${safeFilename}`;

        // Tipos activos (html/svg/js) se guardan como binario opaco para que nunca se rendericen.
        const storedType = isActiveContentType(file.type) ? 'application/octet-stream' : (file.type || 'application/octet-stream');
        await uploadToStorage(key, buffer, storedType);

        // Generate Proxy URL for the Private Bucket
        let protocol = 'https';
        //curent url
        let host = req.url.split('/api')[0].split('://')[1];


        // If localhost, force http might be needed if SSL not set up locally, but typically Next.js handles relative URLs fine on frontend.
        // However, Editor needs a full URL often, or at least absolute path.
        // Also, for EMAILS sent to others, we MUST use the absolute public URL (ulima.dev).

        if (host.includes('localhost')) protocol = 'http';

        const url = `${protocol}://${host}/api/assets/${key}`;

        if (!url) {
            return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 });
        }

        return NextResponse.json({
            url,
            key,
            filename: file.name,
            size: file.size,
            mimeType: file.type
        });

    } catch (error) {
        console.error('Upload failed:', error);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}
