'use client';

import { useI18n } from '@/components/I18nProvider';
import { MailTransferView } from '@/components/admin/mail-transfer/MailTransferView';

/** Ajustes > Mi buzón: cada usuario exporta / importa SOLO su propio buzon (MBOX o EML) con el mismo asistente de la consola. */
export function MyMailboxTransfer() {
    const { t } = useI18n();
    return (
        <div className="space-y-4 animate-in fade-in duration-300">
            <div>
                <h3 className="text-lg font-medium">{t('admin.console.transfer.selfTitle')}</h3>
                <p className="text-sm text-muted-foreground">{t('admin.console.transfer.selfDescription')}</p>
            </div>
            <MailTransferView mode="self" />
        </div>
    );
}
