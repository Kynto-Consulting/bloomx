'use client';

import Link from 'next/link';
import { useI18n } from '@/components/I18nProvider';
import type { ExtensionRow } from '@/lib/admin/extensions-view';

/** Textos es/en autocontenidos (no tocan los catalogos de mensajes compartidos). */
const T = {
    es: {
        blocked: 'Requiere IA · deshabilitada', paused: 'Pausada: IA desactivada', optional: 'IA opcional',
        ai_disabled: 'La IA esta desactivada en esta instancia.', feature_disabled: 'Una funcion de IA que necesita esta extension esta desactivada.', extension_disabled: 'La IA esta desactivada para esta extension.',
        blockedHelp: 'No se puede instalar ni activar hasta reactivar la IA. Si ya estaba activa queda pausada (sigue instalada, sin desinstalar nada).',
        asks: 'Funciones de IA que pide', none: 'servicio de IA de la instancia', on: 'habilitadas', off: 'deshabilitadas', optionalHelp: 'La IA es opcional: sin ella funciona con funciones reducidas.', link: 'Ajustes de IA',
    },
    en: {
        blocked: 'Requires AI · disabled', paused: 'Paused: AI turned off', optional: 'AI optional',
        ai_disabled: 'AI is turned off on this instance.', feature_disabled: 'An AI feature this extension needs is turned off.', extension_disabled: 'AI is turned off for this extension.',
        blockedHelp: 'It cannot be installed or enabled until AI is turned back on. If it was already active it is paused (still installed, nothing uninstalled).',
        asks: 'AI features requested', none: 'the instance AI service', on: 'enabled', off: 'disabled', optionalHelp: 'AI is optional: without it the extension runs with reduced features.', link: 'AI settings',
    },
} as const;

export function useAiText() {
    const { locale } = useI18n();
    return T[locale === 'en' ? 'en' : 'es'];
}

/** Motivo legible del bloqueo (tooltip del boton deshabilitado); '' si no esta bloqueada. */
export function aiBlockTitle(t: ReturnType<typeof useAiText>, row: Pick<ExtensionRow, 'aiBlock'>): string {
    return row.aiBlock.blocked ? `${t[row.aiBlock.reason ?? 'ai_disabled']} ${t.blockedHelp}` : '';
}

/** Insignias de IA de una fila (se usan junto a StatusBadges). */
export function aiBadgeLabel(t: ReturnType<typeof useAiText>, row: ExtensionRow): { label: string; tone: 'warning' | 'info' } | null {
    if (row.aiBlock.blocked) return { label: row.enabled ? t.paused : t.blocked, tone: 'warning' };
    if (row.aiBlock.optional) return { label: t.optional, tone: 'info' };
    return null;
}

/** Resumen de una linea (+ enlace a /admin/ai) de las funciones de IA que pide la extension; nada si no requiere IA. */
export function AiRequirementSummary({ row }: { row: ExtensionRow }) {
    const t = useAiText();
    if (!row.requiresAi) return null;
    const b = row.aiBlock;
    return (
        <p className="text-xs text-muted-foreground" data-testid="ai-requirement">
            <span className="font-medium text-foreground">{t.asks}: </span>
            {b.features.length ? b.features.join(', ') : t.none}
            {' · '}{b.blocked ? `${t.off}${b.disabledFeatures.length ? ` (${b.disabledFeatures.join(', ')})` : ''}. ${t[b.reason ?? 'ai_disabled']} ${t.blockedHelp}` : b.optional ? t.optionalHelp : `${t.on}.`}{' '}
            <Link href="/admin/ai" className="underline">{t.link}</Link>
        </p>
    );
}
