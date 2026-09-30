'use client';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useI18n } from '@/components/I18nProvider';

/** Confirmacion antes de abrir un enlace que sale del dominio del remitente (externo no confiable). El destino completo va visible. */
export function LinkConfirmDialog({ href, sender, onOpen, onCancel }: { href: string | null; sender: string; onOpen: (href: string) => void; onCancel: () => void }) {
    const { t } = useI18n();
    return (
        <ConfirmDialog
            open={href !== null}
            destructive
            title={t('spamUser.link.title')}
            description={
                <div className="space-y-2" data-link-confirm>
                    <p>{t('spamUser.link.body', { sender })}</p>
                    <p className="text-xs font-medium text-foreground">{t('spamUser.link.destination')}</p>
                    <code data-link-destination className="block max-h-32 overflow-auto break-all rounded-md bg-code p-2 text-xs text-code-foreground">{href}</code>
                </div>
            }
            confirmLabel={t('spamUser.link.open')}
            cancelLabel={t('spamUser.link.cancel')}
            onConfirm={() => { if (href) onOpen(href); }}
            onCancel={onCancel}
        />
    );
}

/** Aviso antes de descargar un adjunto de un remitente externo no confiable. */
export function AttachmentConfirmDialog({ name, onProceed, onCancel }: { name: string | null; onProceed: () => void; onCancel: () => void }) {
    const { t } = useI18n();
    return (
        <ConfirmDialog
            open={name !== null}
            destructive
            title={t('spamUser.attachment.title')}
            description={
                <div className="space-y-2" data-attachment-confirm>
                    <p>{t('spamUser.attachment.body')}</p>
                    <p className="text-xs"><span className="font-medium text-foreground">{t('spamUser.attachment.file')}: </span><span className="break-all">{name}</span></p>
                </div>
            }
            confirmLabel={t('spamUser.attachment.download')}
            cancelLabel={t('spamUser.attachment.cancel')}
            onConfirm={onProceed}
            onCancel={onCancel}
        />
    );
}
