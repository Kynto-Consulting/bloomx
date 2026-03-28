'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDomainConfig } from '@/hooks/useDomainConfig';

const INSTALL_PROMPT_STORAGE_KEY = 'bloomx-pwa-install-prompted';
const PROMPT_STORAGE_KEY = 'bloomx-pwa-notifications-prompted';

type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{
        outcome: 'accepted' | 'dismissed';
        platform: string;
    }>;
};

function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
}

async function syncPushSubscription() {
    if (typeof window === 'undefined') {
        throw new Error('Push notifications are only available in the browser.');
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Push notifications are not supported on this device.');
    }

    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
        throw new Error('Push notifications are not configured for this workspace.');
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
    }

    const response = await fetch('/api/notifications/subscriptions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(subscription),
    });

    if (!response.ok) {
        throw new Error('Failed to save the push subscription.');
    }

    return subscription;
}

function isStandaloneMode() {
    if (typeof window === 'undefined') {
        return false;
    }

    return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || (window.navigator as Navigator & {
        standalone?: boolean;
    }).standalone === true;
}

export function PwaManager() {
    const hasPromptedRef = useRef(false);
    const hasInstallPromptedRef = useRef(false);
    const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
    const [isStandalone, setIsStandalone] = useState(false);
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

        const mediaQuery = window.matchMedia('(display-mode: standalone)');

        const updateStandalone = () => {
            setIsStandalone(isStandaloneMode());
        };

        const handleBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            setInstallPromptEvent(event as BeforeInstallPromptEvent);
            updateStandalone();
        };

        const handleAppInstalled = () => {
            setInstallPromptEvent(null);
            setIsStandalone(true);
            toast.success(`${brandName} installed.`);
        };

        updateStandalone();
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);
        mediaQuery.addEventListener?.('change', updateStandalone);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
            mediaQuery.removeEventListener?.('change', updateStandalone);
        };
    }, [brandName]);

    useEffect(() => {
        if (typeof window === 'undefined' || !installPromptEvent || isStandalone) {
            return;
        }

        if (hasInstallPromptedRef.current) {
            return;
        }

        if (window.localStorage.getItem(INSTALL_PROMPT_STORAGE_KEY) === '1') {
            return;
        }

        hasInstallPromptedRef.current = true;
        window.localStorage.setItem(INSTALL_PROMPT_STORAGE_KEY, '1');

        const toastId = toast(`Install ${brandName}`, {
            description: `Install ${brandName} on this device to get a dedicated app experience and reliable notifications.`,
            duration: 14000,
            action: {
                label: 'Install',
                onClick: async () => {
                    try {
                        await installPromptEvent.prompt();
                        const choice = await installPromptEvent.userChoice;

                        setInstallPromptEvent(null);

                        if (choice.outcome === 'accepted') {
                            toast.success(`${brandName} installation started.`, { id: toastId });
                            return;
                        }

                        toast(`${brandName} can still be installed later from the browser menu.`, { id: toastId });
                    } catch (error) {
                        console.error('[pwa] Failed to prompt installation:', error);
                        toast.error('Could not open the install prompt.', { id: toastId });
                    }
                },
            },
        });

        return () => {
            toast.dismiss(toastId);
        };
    }, [brandName, installPromptEvent, isStandalone]);

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

        if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
            return;
        }

        if (!isStandalone && installPromptEvent) {
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
                        toast.error(error instanceof Error ? error.message : 'Could not enable notifications.', { id: toastId });
                    }
                },
            },
        });
    }, [brandName, installPromptEvent, isLoading, isStandalone]);

    return null;
}
