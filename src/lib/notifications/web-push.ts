import webpush from 'web-push';
import {
    deletePushSubscriptionsByEndpoints,
    listPushSubscriptions,
    markPushSubscriptionSuccess,
} from '@/lib/db/push-subscriptions';

let vapidConfigured = false;
let vapidWarningShown = false;

function ensureVapidConfiguration() {
    if (vapidConfigured) {
        return true;
    }

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:admin@bloomx.local';

    if (!publicKey || !privateKey) {
        if (!vapidWarningShown) {
            vapidWarningShown = true;
            console.warn('[push] Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY. Push notifications are disabled.');
        }
        return false;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
    return true;
}

export async function sendNewMessagePushNotification(userId: string, payload: {
    title: string;
    body: string;
    url?: string;
    tag?: string;
    icon?: string;
    badge?: string;
}) {
    if (!ensureVapidConfiguration()) {
        return;
    }

    const subscriptions = await listPushSubscriptions(userId);
    if (subscriptions.length === 0) {
        return;
    }

    const invalidEndpoints: string[] = [];
    const message = JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url || '/',
        tag: payload.tag || 'bloomx-message',
        icon: payload.icon,
        badge: payload.badge,
    });

    await Promise.all(subscriptions.map(async (subscription) => {
        try {
            await webpush.sendNotification({
                endpoint: subscription.endpoint,
                expirationTime: subscription.expiration_time,
                keys: {
                    p256dh: subscription.p256dh,
                    auth: subscription.auth,
                },
            }, message);

            await markPushSubscriptionSuccess(subscription.endpoint);
        } catch (error: any) {
            const statusCode = error?.statusCode;
            if (statusCode === 404 || statusCode === 410) {
                invalidEndpoints.push(subscription.endpoint);
                return;
            }

            console.error('[push] Failed to send notification:', error);
        }
    }));

    if (invalidEndpoints.length > 0) {
        await deletePushSubscriptionsByEndpoints(invalidEndpoints);
    }
}