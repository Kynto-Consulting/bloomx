import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';
import { randomBytes } from 'crypto';

function getMoltSecret(): Uint8Array {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
        throw new Error('NEXTAUTH_SECRET is required in production');
    }
    return new TextEncoder().encode(secret || 'dev-secret-key-123');
}
// Los refresh tokens caducan si no se usan en 7 dias (NIST 800-63B 7.2 reautenticacion)
const REFRESH_IDLE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const ACCESS_TOKEN_EXPIRY = '1h'; // 1 hour

export async function createMoltToken(userId: string) {
    const accessToken = await new SignJWT({ sub: userId, type: 'molt_access' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(ACCESS_TOKEN_EXPIRY)
        .sign(getMoltSecret());

    const refreshToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.moltSession.create({
        data: {
            userId,
            accessToken,
            refreshToken,
            expiresAt
        }
    });

    return { accessToken, refreshToken, expiresAt };
}

export async function refreshMoltToken(refreshToken: string) {
    const session = await prisma.moltSession.findFirst({
        where: { refreshToken },
        include: { user: true }
    });

    if (!session || session.expiresAt.getTime() + REFRESH_IDLE_GRACE_MS < Date.now()) {
        throw new Error('Invalid refresh token');
    }

    // Rotate tokens
    const newAccessToken = await new SignJWT({ sub: session.userId, type: 'molt_access' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(ACCESS_TOKEN_EXPIRY)
        .sign(getMoltSecret());

    const newRefreshToken = randomBytes(32).toString('hex');
    const newExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.moltSession.update({
        where: { id: session.id },
        data: {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            expiresAt: newExpiresAt
        }
    });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken, expiresAt: newExpiresAt };
}

export async function verifyMoltToken(accessToken: string) {
    try {
        const { payload } = await jwtVerify(accessToken, getMoltSecret(), { algorithms: ['HS256'] });

        // Also check DB to ensure it hasn't been revoked or replaced
        const session = await prisma.moltSession.findUnique({
            where: { accessToken },
            include: { user: true }
        });

        if (!session || session.expiresAt < new Date()) {
            return null;
        }

        return session.user;
    } catch (e) {
        return null;
    }
}
