import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/auth/check-scopes?provider=google&scopes=scope1+scope2
 *
 * Returns which of the requested scopes are granted and which are missing
 * for the current user's linked provider account.
 */
export async function GET(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ granted: [], missing: [] });
    }

    const provider = req.nextUrl.searchParams.get('provider') || '';
    const scopesParam = req.nextUrl.searchParams.get('scopes') || '';
    const requested = scopesParam.split(/[\s,]+/).filter(Boolean);

    if (!provider || !requested.length) {
        return NextResponse.json({ granted: [], missing: [] });
    }

    const account = await prisma.account.findFirst({
        where: { userId: user.id, provider },
        select: { scope: true },
    });

    const grantedAll = account?.scope ? account.scope.split(/[\s,]+/).filter(Boolean) : [];
    const granted = requested.filter(s => grantedAll.includes(s));
    const missing = requested.filter(s => !grantedAll.includes(s));

    return NextResponse.json({ granted, missing });
}
