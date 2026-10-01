'use client';

import { useI18n } from '@/components/I18nProvider';
import { PageHeader } from '@/components/admin/console';
import { AiView } from '@/components/admin/ai/AiView';

export default function AiPage() {
    const { t } = useI18n();
    return (
        <div className="mx-auto max-w-7xl">
            <PageHeader title={t('admin.ai.title')} description={t('admin.ai.subtitle')} />
            <AiView />
        </div>
    );
}
