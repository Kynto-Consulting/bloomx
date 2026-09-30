'use client';

import { useI18n } from '@/components/I18nProvider';
import { Badge, type Tone } from '@/components/admin/console';
import type { AccountStatus } from '@/components/admin/users/types';

const STATUS_TONE: Record<AccountStatus, Tone> = { valid: 'success', expired: 'warning', revoked: 'danger' };

/** Estado del token: el significado va en el texto, el color solo lo refuerza. */
export function StatusBadge({ status }: { status: AccountStatus }) {
    const { t } = useI18n();
    return <Badge tone={STATUS_TONE[status]}>{t(`admin.console.users.accounts.tokenStatus.${status}`)}</Badge>;
}
