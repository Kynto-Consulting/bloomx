'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDomainConfig } from '@/hooks/useDomainConfig';

const INSTALL_PROMPT_STORAGE_KEY = 'bloomx-pwa-install-prompted';
const PROMPT_STORAGE_KEY = 'bloomx-pwa-notifications-prompted';
const PUSH_SYNC_RETRY_DELAYS_MS = [0, 1500, 5000, 15000];

type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{
        outcome: 'accepted' | 'dismissed';
        platform: string;
    }>;
};

let vapidPublicKeyPromise: Promise<string | null> | null = null;

function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
}

function uint8ArrayToUrlBase64(bytes: Uint8Array) {
    let binary = '';

    bytes.forEach((value) => {
        binary += String.fromCharCode(value);
    });

    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function resetPushPublicKeyCache() {
    vapidPublicKeyPromise = null;
}

function getSerializedSubscription(subscription: PushSubscription) {
    return subscription.toJSON();
}

function hasCompletePushSubscription(subscription: PushSubscription) {
    const serialized = getSerializedSubscription(subscription);
    return Boolean(serialized.endpoint && serialized.keys?.p256dh && serialized.keys?.auth);
}

function hasMatchingApplicationServerKey(subscription: PushSubscription, expectedPublicKey: string) {
    const applicationServerKey = subscription.options?.applicationServerKey;
    if (!applicationServerKey) {
        return false;
    }

    const actualKey = uint8ArrayToUrlBase64(new Uint8Array(applicationServerKey));
    return actualKey === expectedPublicKey;
}

async function syncPushSubscription(options?: {
    forceRefreshKey?: boolean;
    forceResubscribe?: boolean;
}) {
    if (typeof window === 'undefined') {
        throw new Error('Push notifications are only available in the browser.');
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Push notifications are not supported on this device.');
    }

    const vapidPublicKey = await getPushPublicKey(options?.forceRefreshKey);
    if (!vapidPublicKey) {
        throw new Error('Push notifications are not configured for this workspace.');
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (subscription) {
        const shouldResubscribe = options?.forceResubscribe
            || !hasCompletePushSubscription(subscription)
            || !hasMatchingApplicationServerKey(subscription, vapidPublicKey);

        if (shouldResubscribe) {
            await subscription.unsubscribe().catch(() => undefined);
            subscription = null;
        }
    }

    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
    }

    if (!hasCompletePushSubscription(subscription)) {
        if (!options?.forceResubscribe) {
            await subscription.unsubscribe().catch(() => undefined);
            return syncPushSubscription({
                forceRefreshKey: true,
                forceResubscribe: true,
            });
        }

        throw new Error('Push subscription is missing required keys.');
    }

    const serializedSubscription = getSerializedSubscription(subscription);

    const response = await fetch('/api/notifications/subscriptions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(serializedSubscription),
    });

    if (!response.ok) {
        if (!options?.forceResubscribe && (response.status === 400 || response.status === 409)) {
            await subscription.unsubscribe().catch(() => undefined);
            return syncPushSubscription({
                forceRefreshKey: true,
                forceResubscribe: true,
            });
        }

        throw new Error('Failed to save the push subscription.');
    }

    return subscription;
}

async function enablePushNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
        throw new Error('Notifications are not supported on this device.');
    }

    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
        throw new Error('Notifications remain disabled.');
    }

    await syncPushSubscription();
    window.dispatchEvent(new CustomEvent('bloomx:notifications-enabled'));
}

async function getPushPublicKey(forceRefresh = false) {
    if (forceRefresh) {
        resetPushPublicKeyCache();
    }

    if (!vapidPublicKeyPromise) {
        vapidPublicKeyPromise = fetch('/api/notifications/subscriptions', {
            cache: 'no-store',
        })
            .then(async (response) => {
                if (!response.ok) {
                    resetPushPublicKeyCache();
                    return null;
                }

                const data = await response.json();
                const publicKey = typeof data?.publicKey === 'string' ? data.publicKey : null;

                if (!publicKey) {
                    resetPushPublicKeyCache();
                }

                return publicKey;
            })
            .catch(() => {
                resetPushPublicKeyCache();
                return null;
            });
    }

    return vapidPublicKeyPromise;
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
    const pushSyncAttemptRef = useRef(0);
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

        if (!isStandalone && installPromptEvent) {
            return;
        }

        if (Notification.permission === 'granted') {
            let cancelled = false;
            let retryTimeout: number | null = null;

            const runPushSyncAttempt = async (attempt: number) => {
                pushSyncAttemptRef.current = attempt;

                try {
                    await syncPushSubscription({
                        forceRefreshKey: attempt > 0,
                    });
                    pushSyncAttemptRef.current = 0;
                } catch (error) {
                    if (cancelled) {
                        return;
                    }

                    const nextAttempt = attempt + 1;
                    const nextDelay = PUSH_SYNC_RETRY_DELAYS_MS[nextAttempt];

                    console.error(`[pwa] Failed to sync push subscription (attempt ${attempt + 1}/${PUSH_SYNC_RETRY_DELAYS_MS.length}):`, error);

                    if (typeof nextDelay === 'number') {
                        retryTimeout = window.setTimeout(() => {
                            void runPushSyncAttempt(nextAttempt);
                        }, nextDelay);
                    }
                }
            };

            void runPushSyncAttempt(0);

            return () => {
                cancelled = true;
                if (retryTimeout !== null) {
                    window.clearTimeout(retryTimeout);
                }
            };

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
                        await enablePushNotifications();
                        toast.success('Notifications enabled.', { id: toastId });
                    } catch (error) {
                        console.error('[pwa] Failed to enable notifications:', error);
                        toast.error(error instanceof Error ? error.message : 'Could not enable notifications.', { id: toastId });
                    }
                },
            },
        });
    }, [brandName, installPromptEvent, isLoading, isStandalone]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleEnableRequest = async () => {
            try {
                await enablePushNotifications();
                toast.success('Notifications enabled.');
            } catch (error) {
                console.error('[pwa] Failed to enable notifications from event:', error);
                toast.error(error instanceof Error ? error.message : 'Could not enable notifications.');
            }
        };

        window.addEventListener('bloomx:enable-notifications', handleEnableRequest);
        return () => window.removeEventListener('bloomx:enable-notifications', handleEnableRequest);
    }, []);

    return null;
}
