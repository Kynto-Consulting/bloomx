'use client';

import * as React from 'react';
import { Printer } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { Modal } from '@/components/ui/Modal';
import { btnOutline, btnPrimary, buildQuery, formatDateTime, useAdminQuery } from '@/components/admin/console';
import { QueryBoundary, useMoney } from './shared';
import type { Receipt } from './types';

/** Recibo de una compra: vista imprimible (solo el recibo sale en la impresion, el resto de la pagina se oculta). */
export function ReceiptDialog({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
    const { t, locale } = useI18n();
    const money = useMoney();
    const q = useAdminQuery<{ receipt: Receipt }>(orderId ? `/api/admin/billing/receipt${buildQuery({ orderId })}` : null);
    return (
        <Modal open={!!orderId} onClose={onClose} panelClassName="w-full max-w-lg rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl">
            {({ titleId }) => (
                <div>
                    <style>{'@media print { body * { visibility: hidden !important; } #bx-receipt, #bx-receipt * { visibility: visible !important; } #bx-receipt { position: fixed; inset: 0; padding: 24px; background: Canvas; color: CanvasText; } .bx-no-print { display: none !important; } }'}</style>
                    <QueryBoundary q={q} ns="billing">
                        {({ receipt }) => (
                            <div id="bx-receipt">
                                <h2 id={titleId} className="text-lg font-semibold text-foreground">{t('admin.console.billing.receipt.title', { number: receipt.number })}</h2>
                                <dl className="mt-4 grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
                                    <dt className="text-muted-foreground">{t('admin.console.billing.receipt.issuedAt')}</dt><dd>{formatDateTime(receipt.issuedAt, locale)}</dd>
                                    <dt className="text-muted-foreground">{t('admin.console.billing.receipt.buyer')}</dt><dd className="break-all">{receipt.buyerDomain}</dd>
                                    <dt className="text-muted-foreground">{t('admin.console.billing.receipt.extension')}</dt><dd className="break-all">{receipt.extensionName} ({receipt.extensionId})</dd>
                                    <dt className="text-muted-foreground">{t('admin.console.billing.receipt.order')}</dt><dd className="break-all">{receipt.orderId}</dd>
                                    <dt className="text-muted-foreground">{t('admin.console.billing.receipt.amount')}</dt><dd className="font-semibold">{money(receipt.amountCents, receipt.currency)}</dd>
                                    <dt className="text-muted-foreground">{t('admin.console.billing.receipt.status')}</dt><dd>{t(`admin.console.billing.status.${receipt.status}`) === `admin.console.billing.status.${receipt.status}` ? receipt.status : t(`admin.console.billing.status.${receipt.status}`)}</dd>
                                    <dt className="text-muted-foreground">{t('admin.console.billing.receipt.reference')}</dt><dd className="break-all">{receipt.providerRef}</dd>
                                </dl>
                                <p className="mt-4 text-xs text-muted-foreground">{t('admin.console.billing.receipt.note')}</p>
                            </div>
                        )}
                    </QueryBoundary>
                    {!q.data && !q.error && <h2 id={titleId} className="sr-only">{t('admin.console.billing.receipt.loading')}</h2>}
                    {q.error && !q.data && <h2 id={titleId} className="sr-only">{t('admin.console.billing.purchases.receipt')}</h2>}
                    <div className="bx-no-print mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button type="button" className={btnOutline} onClick={onClose}>{t('admin.console.billing.receipt.close')}</button>
                        <button type="button" className={btnPrimary} onClick={() => window.print()} disabled={!q.data}><Printer className="h-4 w-4" aria-hidden="true" />{t('admin.console.billing.receipt.print')}</button>
                    </div>
                </div>
            )}
        </Modal>
    );
}

