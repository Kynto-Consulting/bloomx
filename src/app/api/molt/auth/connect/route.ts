import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createMoltToken } from '@/lib/molt-auth';
import { compare } from 'bcryptjs';
import { auditLog, getClientIp, getDummyBcryptHash, rateLimit, safeEqual } from '@/lib/security';
import { getMfaStatus, mfaRequiredFor, verifyMfa } from '@/lib/mfa';

export async function POST(req: NextRequest) {
    try {
        const ip = getClientIp(req);
        const rl = rateLimit(`molt:${ip}`, 10, 15 * 60_000);
        if (!rl.ok) {
            return NextResponse.json({ error: 'Too many attempts' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
        }
        const body = await req.json();
        const { email, password, secret } = body;

        // 1. Validate Secret (Optional extra layer)
        if (process.env.MOLT_CONNECT_SECRET && !safeEqual(String(secret ?? ''), process.env.MOLT_CONNECT_SECRET)) {
            return NextResponse.json({ error: 'Invalid connect secret' }, { status: 403 });
        }

        if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
            return NextResponse.json({ error: 'Missing email or password' }, { status: 400 });
        }

        // 2. Validate User
        const user = await prisma.user.findUnique({ where: { email } });

        const isValid = await compare(password, user?.password || (await getDummyBcryptHash()));

        if (!user || !user.password || !isValid) {
            auditLog('auth.molt.failure', { email, ip });
            return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
        }

        // 2b. Segundo factor: si la cuenta tiene MFA (o el rol lo exige) la contrasena sola no basta (NIST 800-63B AAL2)
        const mfa = await getMfaStatus(user.id);
        if (mfaRequiredFor(user.email) && !mfa.enabled) {
            auditLog('auth.molt.mfa_enrollment_required', { userId: user.id, ip });
            return NextResponse.json({ error: 'MFA enrollment required. Sign in on the web app first.' }, { status: 403 });
        }
        if (mfa.enabled) {
            const otp = await verifyMfa(user.id, { code: body?.otp, recoveryCode: body?.recoveryCode });
            if (!otp.ok) {
                auditLog('auth.molt.mfa_failed', { userId: user.id, ip });
                return NextResponse.json({ error: 'MFA code required', mfaRequired: true }, { status: 401 });
            }
        }

        // 3. Generate Tokens
        const tokens = await createMoltToken(user.id);

        return NextResponse.json({
            success: true,
            user: { id: user.id, email: user.email, name: user.name },
            ...tokens
        });

    } catch (error: any) {
        console.error('Molt connect error:', error?.message);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
