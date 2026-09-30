'use client';

import { useI18n } from '@/components/I18nProvider';
import { PageHeader } from '@/components/admin/console';
import { AuditView } from '@/components/admin/audit/AuditView';

export default function AuditPage() {
    const { t } = useI18n();
    return (
        <div className="mx-auto max-w-7xl">
            <PageHeader title={t('admin.console.account.audit.title')} description={t('admin.console.account.audit.subtitle')} />
            <AuditView />
        </div>
    );
}
