import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { env } from '@/lib/env';
import { getRegistrationPolicy } from '@/lib/domain-registration';
import { auditLog, BCRYPT_COST, getClientIp, isProduction, rateLimitAsync, safeEqual, validateNewPassword } from '@/lib/security';
import { emitUserCreated } from '@/lib/expansions/lifecycle-v2';

export async function POST(req: NextRequest) {
    const ip = getClientIp(req);
    try {
        const rl = await rateLimitAsync(`register:ip:${ip}`, 5, 60 * 60_000);
        if (!rl.ok) {
            return NextResponse.json(
                { error: 'Too many attempts. Try again later.' },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
            );
        }

        const { email, password, name, key } = await req.json();

        // Politica del dominio activo (landing.registration): el servidor la aplica aunque el formulario se manipule.
        const policy = await getRegistrationPolicy(req);
        if (!policy.enabled) {
            auditLog('auth.register.closed', { ip });
            return NextResponse.json({ error: 'Registration is closed' }, { status: 403 });
        }

        if (policy.requireKey) {
            // En produccion el registro queda deshabilitado si REGISTRATION_KEY no se configuro explicitamente
            // (evita registro abierto con la clave por defecto "dev-secret").
            const configuredKey = env.REGISTRATION_KEY;
            if (isProduction() && (!configuredKey || configuredKey === 'dev-secret')) {
                auditLog('auth.register.disabled', { ip });
                return NextResponse.json({ error: 'Invalid registration secret' }, { status: 403 });
            }

            if (!safeEqual(typeof key === 'string' ? key : '', configuredKey)) {
                auditLog('auth.register.bad_key', { ip });
                return NextResponse.json({ error: 'Invalid registration secret' }, { status: 403 });
            }
        }

        if (!email || !password || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return NextResponse.json({ error: 'Missing or invalid email or password' }, { status: 400 });
        }

        const passwordError = validateNewPassword(password, email);
        if (passwordError) {
            return NextResponse.json({ error: passwordError }, { status: 400 });
        }

        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            return NextResponse.json({ error: 'User already exists' }, { status: 400 });
        }

        const hashedPassword = await bcrypt.hash(password, BCRYPT_COST);

        const user = await prisma.user.create({
            data: {
                email,
                name: typeof name === 'string' ? name.slice(0, 200) : undefined,
                password: hashedPassword,
            },
        });

        auditLog('auth.register.success', { userId: user.id, email: user.email, ip });
        emitUserCreated(user, 'register'); // asincrono, nunca bloquea ni falla el registro
        return NextResponse.json({ success: true, user: { id: user.id, email: user.email } });
    } catch (error) {
        console.error('Registration error:', error instanceof Error ? error.message : 'unknown');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
