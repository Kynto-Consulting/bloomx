import { NextRequest, NextResponse } from 'next/server';
import { isActiveContentType } from '@/lib/mail-validation';
import { getObjectStream } from '@/lib/storage';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { canAccessEmail } from '@/lib/mailbox-access';
import { auditLog, getClientIp } from '@/lib/security';
import {
    decideAssetAccess,
    isInboundAttachmentKey,
    isUploadKey,
    normalizeDownloadName,
    resolveUnsignedPolicy,
    verifyAssetSignature,
} from '@/lib/asset-url';

export const runtime = 'nodejs';

/**
 * Proxy de adjuntos. Acceso (NIST AC-3, ISO 27001:2022 A.5.15):
 *  1) URL firmada (HMAC + caducidad, lib/asset-url.ts)  -> permitido (enlaces para terceros: correos enviados)
 *  2) sesion del propietario del objeto                  -> permitido aunque la firma haya caducado
 *  3) sin firma                                          -> segun ASSET_UNSIGNED_INBOUND / ASSET_UNSIGNED_UPLOADS
 * Ademas, allowlist de prefijos: nunca se sirven raw.json, content.html/txt, secure/*.msg ni enviados.
 */
async function isOwner(key: string): Promise<boolean> {
    const user = await getCurrentUser().catch(() => null);
    if (!user) return false;
    if (isUploadKey(key)) {
        const segment = key.split('/')[1] || '';
        return segment.toLowerCase() === String(user.email).toLowerCase() || segment === user.id;
    }
    if (isInboundAttachmentKey(key)) {
        const att = await prisma.attachment.findFirst({
            where: { key },
            select: { email: { select: { userId: true } }, draft: { select: { from: true } } },
        });
        if (att?.email?.userId) return canAccessEmail(user.id, att.email.userId);
        if (att?.draft?.from) return String(att.draft.from).toLowerCase().includes(String(user.email).toLowerCase());
    }
    return false;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
    // 1. Reconstruct Key from catch-all
    const { key: keyPath } = await params;
    // /api/assets/attachments/user/file.png -> key = "attachments/user/file.png"
    const key = keyPath.join('/');

    if (!key) {
        return NextResponse.json({ error: 'Key not provided' }, { status: 400 });
    }

    const inbound = isInboundAttachmentKey(key);
    if (
        key.length > 1024 ||
        key.includes('..') ||
        key.includes('\\') ||
        key.includes('\0') ||
        !(isUploadKey(key) || inbound)
    ) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // 2. Autorizacion
    const sig = verifyAssetSignature(
        key,
        req.nextUrl.searchParams.get('exp'),
        req.nextUrl.searchParams.get('sig'),
    );
    // La consulta de propiedad solo se hace si la firma no basta (evita BD en el camino caliente)
    const needOwner = sig !== 'ok';
    const owner = needOwner ? await isOwner(key) : false;
    const decision = decideAssetAccess({ sig, isOwner: owner, policy: resolveUnsignedPolicy(key) });
    if (!decision.allow) {
        auditLog('assets.denied', { reason: decision.reason, ip: getClientIp(req), prefix: key.split('/')[0] });
        // 404 y no 403: no confirmar la existencia de claves
        return NextResponse.json({ error: 'File not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    if (decision.reason === 'legacy_unsigned') {
        // Trazabilidad de la transicion: cuando esto llegue a ~0 se puede fijar ASSET_UNSIGNED_UPLOADS=owner|deny
        auditLog('assets.legacy_unsigned', { ip: getClientIp(req), prefix: key.split('/')[0] });
    }

    try {
        const obj = await getObjectStream(key, req.headers.get('range'));
        if (!obj) {
            return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }

        const headers = new Headers();
        // Contenido activo (html/svg/xml/js) jamas se sirve con su tipo original: evita XSS almacenado.
        const storedType = obj.contentType || 'application/octet-stream';
        headers.set('Content-Type', isActiveContentType(storedType) ? 'application/octet-stream' : storedType);
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
        headers.set('Referrer-Policy', 'no-referrer');
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin'); // se incrusta en correos enviados
        // Ya no es publico/immutable: la URL es una credencial temporal, no debe vivir en caches compartidas.
        headers.set('Cache-Control', 'private, max-age=3600');

        let filename = req.nextUrl.searchParams.get('filename') || key.split('/').pop() || 'download';
        filename = normalizeDownloadName(filename).slice(0, 200) || 'download';
        headers.set('Content-Disposition', `attachment; filename="${filename}"`);

        if (obj.contentLength !== undefined) headers.set('Content-Length', String(obj.contentLength));
        headers.set('Accept-Ranges', 'bytes');
        if (obj.contentRange) headers.set('Content-Range', obj.contentRange);

        return new NextResponse(obj.body, { status: obj.status, headers });
    } catch (error: any) {
        console.error(`Error proxying asset:`, error?.name || 'unknown');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
