'use client';

import { useI18n } from '@/components/I18nProvider';
import { PageHeader } from '@/components/admin/console';
import { MailTransferView } from '@/components/admin/mail-transfer/MailTransferView';

export default function TransferPage() {
    const { t } = useI18n();
    return (
        <div className="mx-auto max-w-6xl">
            <PageHeader title={t('admin.console.transfer.title')} description={t('admin.console.transfer.description')} />
            <MailTransferView mode="admin" />
        </div>
    );
}
