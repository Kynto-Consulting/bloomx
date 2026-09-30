'use client';

import { useSession } from '@/components/SessionProvider';
import { useI18n } from '@/components/I18nProvider';
import { useExtensionNotifications } from '@/lib/expansions/client/use-extension-notifications';

/** Muestra como toast las notificaciones que las extensiones emiten con services.notify.toast. Sin UI propia. */
export function ExtensionNotificationsListener() {
    const { status } = useSession();
    const { t } = useI18n();
    useExtensionNotifications({ enabled: status === 'authenticated', openLabel: t('common.open') });
    return null;
}
