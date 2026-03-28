import webpush from 'web-push';
import {
    deletePushSubscriptionsByEndpoints,
    listPushSubscriptions,
    markPushSubscriptionSuccess,
} from '@/lib/db/push-subscriptions';
import { getOrCreateVapidConfig } from '@/lib/notifications/web-push-config';

let vapidConfigured = false;
let vapidWarningShown = false;

async function ensureVapidConfiguration() {
    if (vapidConfigured) {
        return true;
    }

    try {
        const { publicKey, privateKey, subject } = await getOrCreateVapidConfig();
        webpush.setVapidDetails(subject, publicKey, privateKey);
        vapidConfigured = true;
        return true;
    } catch (error) {
        if (!vapidWarningShown) {
            vapidWarningShown = true;
            console.warn('[push] Failed to configure VAPID keys. Push notifications are disabled.', error);
        }
        return false;
    }
}

export async function sendNewMessagePushNotification(userId: string, payload: {
    title: string;
    body: string;
    url?: string;
    tag?: string;
    icon?: string;
    badge?: string;
}) {
    await sendPushNotification(userId, {
        ...payload,
        tag: payload.tag || 'bloomx-message',
        url: payload.url || '/',
    });
}

export async function sendPushNotification(userId: string, payload: {
    title: string;
    body: string;
    url?: string;
    tag?: string;
    icon?: string;
    badge?: string;
}) {
    if (!await ensureVapidConfiguration()) {
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
        tag: payload.tag || 'bloomx-notification',
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