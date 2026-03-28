'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useDomainConfig } from '@/hooks/useDomainConfig';

const PROMPT_STORAGE_KEY = 'bloomx-pwa-notifications-prompted';

function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
}

async function syncPushSubscription() {
    if (typeof window === 'undefined') {
        return;
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return;
    }

    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
        return;
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
    }

    await fetch('/api/notifications/subscriptions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(subscription),
    });
}

export function PwaManager() {
    const hasPromptedRef = useRef(false);
    const { config, isLoading } = useDomainConfig();
    const brandName = config?.displayName || config?.name || 'Mail';
    const brandLogo = config?.logo || null;

    useEffect(() => {
        if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
            return;
        }

        navigator.serviceWorker.register('/sw.js').then((registration) => {
            registration.active?.postMessage({
                type: 'SET_BRANDING',
                payload: {
                    name: brandName,
                    logo: brandLogo,
                },
            });
        }).catch((error) => {
            console.error('[pwa] Service worker registration failed:', error);
        });
    }, [brandLogo, brandName]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        if (isLoading) {
            return;
        }

        if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
            return;
        }

        if (Notification.permission === 'granted') {
            syncPushSubscription().catch((error) => {
                console.error('[pwa] Failed to sync push subscription:', error);
            });
            return;
        }

        if (Notification.permission !== 'default' || hasPromptedRef.current) {
            return;
        }

        if (window.localStorage.getItem(PROMPT_STORAGE_KEY) === '1') {
            return;
        }

        hasPromptedRef.current = true;
        window.localStorage.setItem(PROMPT_STORAGE_KEY, '1');

        const toastId = toast(`Enable ${brandName} notifications`, {
            description: `Installable alerts for new messages and activity in ${brandName}.`,
            duration: 12000,
            action: {
                label: 'Enable',
                onClick: async () => {
                    try {
                        const permission = await Notification.requestPermission();

                        if (permission !== 'granted') {
                            toast.error('Notifications remain disabled.');
                            return;
                        }

                        await syncPushSubscription();
                        toast.success('Notifications enabled.', { id: toastId });
                    } catch (error) {
                        console.error('[pwa] Failed to enable notifications:', error);
                        toast.error('Could not enable notifications.', { id: toastId });
                    }
                },
            },
        });
    }, [brandName, isLoading]);

    return null;
}