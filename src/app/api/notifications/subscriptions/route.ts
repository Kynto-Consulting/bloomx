import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deletePushSubscription, savePushSubscription } from '@/lib/db/push-subscriptions';
import { getVapidPublicKey } from '@/lib/notifications/web-push-config';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const publicKey = await getVapidPublicKey();
        return NextResponse.json({ publicKey, enabled: true });
    } catch (error) {
        console.error('[push] Failed to load VAPID public key:', error);
        return NextResponse.json({ enabled: false }, { status: 503 });
    }
}

export async function POST(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const subscription = await req.json();

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return NextResponse.json({ error: 'Invalid push subscription' }, { status: 400 });
    }

    const stored = await savePushSubscription(user.id, {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime ?? null,
        keys: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
        },
        userAgent: req.headers.get('user-agent'),
    });

    return NextResponse.json({ success: true, subscription: stored });
}

export async function DELETE(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { endpoint } = await req.json();
    if (!endpoint) {
        return NextResponse.json({ error: 'Endpoint is required' }, { status: 400 });
    }

    await deletePushSubscription(user.id, endpoint);
    return NextResponse.json({ success: true });
}