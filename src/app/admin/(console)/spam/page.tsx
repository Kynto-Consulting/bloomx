'use client';

import { useI18n } from '@/components/I18nProvider';
import { PageHeader } from '@/components/admin/console';
import { SpamView } from '@/components/admin/spam/SpamView';

export default function SpamPage() {
    const { t } = useI18n();
    return (
        <div className="mx-auto max-w-7xl">
            <PageHeader title={t('admin.console.spam.title')} description={t('admin.console.spam.subtitle')} />
            <SpamView />
        </div>
    );
}
