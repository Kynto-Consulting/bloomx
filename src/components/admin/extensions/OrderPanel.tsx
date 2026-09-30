'use client';

import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Card, btnOutline } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import { moveItem, sortByOrder } from '@/lib/admin/extensions-manifest';
import type { ExtensionRow } from '@/lib/admin/extensions-view';

/**
 * Orden de paneles/botones de las extensiones instaladas. Botones Subir/Bajar (no solo arrastrar), operables con teclado;
 * el resultado se anuncia en la region aria-live de la pantalla. Se guarda en settings.ui.order (ver la nota visible).
 */
export function OrderPanel({
    rows, busy, onReorder,
}: { rows: readonly ExtensionRow[]; busy: boolean; onReorder: (orderedIds: string[], movedName: string, position: number) => void }) {
    const { t } = useI18n();
    const listRef = useRef<HTMLOListElement>(null);
    const pendingFocus = useRef<string | null>(null);
    const ordered = sortByOrder(rows.filter((r) => r.installed).map((r) => ({ id: r.id, name: r.name, order: r.order })));

    // Al terminar de guardar, el foco vuelve al mismo boton (la lista se reordena y el navegador podria perderlo).
    useEffect(() => {
        if (busy || !pendingFocus.current) return;
        listRef.current?.querySelector<HTMLElement>(`[data-focus-key="${pendingFocus.current}"]`)?.focus();
        pendingFocus.current = null;
    });

    const move = (index: number, delta: -1 | 1) => {
        // aria-disabled (no disabled): el foco se queda en el boton tras mover, para poder repetir con el teclado.
        if (busy || index + delta < 0 || index + delta >= ordered.length) return;
        pendingFocus.current = `${ordered[index].id}:${delta}`;
        const next = moveItem(ordered, index, delta);
        onReorder(next.map((i) => i.id), ordered[index].name, index + delta + 1);
    };

    return (
        <Card title={t('admin.console.extensions.order.title')} description={t('admin.console.extensions.order.description')} id="order">
            <p className="mb-3 text-xs text-muted-foreground">{t('admin.console.extensions.order.limit')}</p>
            {ordered.length < 2 ? (
                <p className="text-sm text-muted-foreground">{t('admin.console.extensions.order.needTwo')}</p>
            ) : (
                <ol ref={listRef} aria-label={t('admin.console.extensions.order.list')} className="space-y-2">
                    {ordered.map((item, index) => (
                        <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 pl-3">
                            <div className="min-w-0">
                                <span className="break-words text-sm font-medium text-foreground">{item.name}</span>
                                <span className="ml-2 text-xs text-muted-foreground">{t('admin.console.extensions.order.position', { position: index + 1, total: ordered.length })}</span>
                            </div>
                            <div className="flex gap-1">
                                <button type="button" className={`${btnOutline} aria-disabled:pointer-events-none aria-disabled:opacity-50`} aria-disabled={busy || index === 0} data-focus-key={`${item.id}:-1`} aria-label={t('admin.console.extensions.order.up', { name: item.name })} onClick={() => move(index, -1)}>
                                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                                    <span className="hidden sm:inline">{t('admin.console.extensions.order.upShort')}</span>
                                </button>
                                <button type="button" className={`${btnOutline} aria-disabled:pointer-events-none aria-disabled:opacity-50`} aria-disabled={busy || index === ordered.length - 1} data-focus-key={`${item.id}:1`} aria-label={t('admin.console.extensions.order.down', { name: item.name })} onClick={() => move(index, 1)}>
                                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                                    <span className="hidden sm:inline">{t('admin.console.extensions.order.downShort')}</span>
                                </button>
                            </div>
                        </li>
                    ))}
                </ol>
            )}
        </Card>
    );
}
