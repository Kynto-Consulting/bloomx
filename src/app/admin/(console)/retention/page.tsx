'use client';

import { useI18n } from '@/components/I18nProvider';
import { PageHeader } from '@/components/admin/console';
import { RetentionView } from '@/components/admin/retention/RetentionView';

export default function RetentionPage() {
    const { t } = useI18n();
    return (
        <div className="mx-auto max-w-7xl">
            <PageHeader title={t('admin.console.account.retention.title')} description={t('admin.console.account.retention.subtitle')} />
            <RetentionView />
        </div>
    );
}
