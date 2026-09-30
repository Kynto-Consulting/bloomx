'use client';

import { useI18n } from '@/components/I18nProvider';
import { PageHeader } from '@/components/admin/console';
import { SecurityView } from '@/components/admin/security/SecurityView';

export default function SecurityPage() {
    const { t } = useI18n();
    return (
        <div className="mx-auto max-w-7xl">
            <PageHeader title={t('admin.console.account.security.title')} description={t('admin.console.account.security.subtitle')} />
            <SecurityView />
        </div>
    );
}
