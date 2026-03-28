
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getGoogleAccessToken } from '@/lib/google/account';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '@/lib/jwt';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://backend.bloomx.arubik.dev';

async function getLinkedAuthContext(userId: string) {
    const auth: Record<string, any> = {};

    try {
        const google = await getGoogleAccessToken(userId);
        auth.google = {
            accessToken: google.accessToken,
            accountId: google.accountId,
            source: 'user-account'
        };
    } catch {
        // Google is optional for the current user.
    }

    return auth;
}

export async function GET(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    const host = process.env.TOP_DOMAIN || req.headers.get('host') || '';

    const { searchParams } = new URL(req.url);
    const trigger = searchParams.get('trigger');

    try {
        const res = await fetch(`${BACKEND_URL}/api/extensions?trigger=${trigger || ''}`, {
            headers: {
                'Authorization': `Bearer ${token || ''}`,
                'X-User-ID': user.id,
                'X-User-Email': user.email || '',
                'X-BloomX-Domain': host.split(':')[0]
            }
        });

        if (!res.ok) {
            return NextResponse.json({ error: 'Backend error' }, { status: res.status });
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Proxy GET Error", error);
        return NextResponse.json({ error: 'Failed to fetch expansions' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    const host = process.env.TOP_DOMAIN || req.headers.get('host') || '';

    try {
        const body = await req.json();
        const linkedAuth = await getLinkedAuthContext(user.id);
        const enrichedContext = Object.keys(linkedAuth).length > 0
            ? {
                ...(body.context || {}),
                auth: {
                    ...((body.context && body.context.auth) || {}),
                    ...linkedAuth,
                },
            }
            : (body.context || {});
        const payload = {
            ...body,
            context: enrichedContext,
        };

        // Forward to backend execution endpoint
        const res = await fetch(`${BACKEND_URL}/api/extension/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token || ''}`,
                'X-User-ID': user.id,
                'X-User-Email': user.email || '',
                'X-BloomX-Domain': host.split(':')[0]
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        return NextResponse.json(data, { status: res.status });

    } catch (error) {
        console.error("Proxy POST Error", error);
        return NextResponse.json({ error: 'Failed to execute action' }, { status: 500 });
    }
}
