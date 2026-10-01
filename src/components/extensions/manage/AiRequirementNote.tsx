'use client';

import * as React from 'react';
import Link from 'next/link';
import type { ExtensionRow } from '@/lib/expansions/manage/model';
import { useI18n } from '@/components/I18nProvider';
import { fmt, useManageStrings, type ManageStrings } from './strings';

/** Id de la extension "Asistente de redaccion" (Composer Helper): la UNICA via de redaccion con IA. */
export const COMPOSER_HELPER_ID = 'core-composer-helper';

/** Texto del motivo del bloqueo (tooltip/nota). */
export function aiBlockReasonText(s: ManageStrings, row: Pick<ExtensionRow, 'ai'>): string {
    return row.ai.reason ? s[`aiReason_${row.ai.reason}` as keyof ManageStrings] : '';
}

/** Resumen (una linea pequena + enlace a /admin/ai) de las funciones de IA que pide la extension y si estan habilitadas. */
export function AiRequirementNote({ row }: { row: ExtensionRow }) {
    const { s } = useManageStrings();
    const { locale } = useI18n();
    const purposeText = (locale === 'en' ? row.ai.purpose.en : row.ai.purpose.es) || row.ai.purpose.es || row.ai.purpose.en;
    const composer = row.id === COMPOSER_HELPER_ID;
    if (!row.ai.requiresAi && !composer) return null;
    return (
        <div className="space-y-1 text-xs text-muted-foreground" data-testid="ai-requirement">
            {row.ai.requiresAi && (
                <p>
                    <span className="font-medium text-foreground">{s.aiRequiresTitle}. </span>
                    {row.ai.features.length > 0 ? fmt(s.aiFeaturesAsk, { features: row.ai.features.join(', ') }) : s.aiFeaturesNone}{' '}
                    {purposeText && <>{purposeText}{' '}</>}
                    {row.ai.blocked ? <>{aiBlockReasonText(s, row)}{row.ai.disabledFeatures.length > 0 && <> {fmt(s.aiEnabledNo, { features: row.ai.disabledFeatures.join(', ') })}</>} {s.aiBlockedNote}</> : row.ai.optional ? s.aiOptionalNote : s.aiEnabledYes}{' '}
                    <Link href="/admin/ai" className="underline">{s.aiManageLink}</Link>
                </p>
            )}
            {composer && <p data-testid="composer-helper-note">{s.composerHelperNote}</p>}
        </div>
    );
}
