import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { uploadToStorage } from '@/lib/storage';
import { rateLimit } from '@/lib/security';
import { stripControlChars } from '@/lib/mail-validation';
import { encrypt } from '@/lib/encryption';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const rl = rateLimit(`secure-msg:${user.email}`, 30, 60 * 60 * 1000);
        if (!rl.ok) {
            return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
        }

        const body = await req.json();
        const content = typeof body?.content === 'string' ? body.content : '';
        const subject = typeof body?.subject === 'string' ? stripControlChars(body.subject).slice(0, 300) : '';

        if (!content.trim()) {
            return NextResponse.json({ error: 'Content is required' }, { status: 400 });
        }
        if (content.length > 1_000_000) {
            return NextResponse.json({ error: 'Content too large' }, { status: 413 });
        }

        // 1. Generate ID and secure payload (con caducidad)
        const id = uuidv4();
        const ttlDays = Number.parseInt(process.env.SECURE_MESSAGE_TTL_DAYS || '30', 10) || 30;
        const payload = JSON.stringify({
            subject,
            content,
            sender: user.email,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
        });

        // 2. Encrypt locally before storage (Double encryption, why not?)
        // Actually encryption.ts uses a server key. Storage might be public/private.
        // Let's encrypt it so even if storage is leaked, it's safe without the app key.
        const encryptedPayload = encrypt(payload);

        // 3. Upload
        // We assume 'bloomx-secure' bucket or prefix
        await uploadToStorage(`secure/${id}.msg`, encryptedPayload, 'text/plain');

        // 4. Construct URL
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://bloomx.arubik.dev';
        const viewUrl = `${baseUrl}/secure/${id}`;

        return NextResponse.json({ success: true, viewUrl });

    } catch (e) {
        console.error('Secure Message Error', e);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
}
