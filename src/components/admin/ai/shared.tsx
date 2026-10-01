'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { ApiError, apiErrorKey, adminFetch } from '@/components/admin/console';
import type { AiSettingsView } from '@/lib/ai/settings';
import type { AiFeature, AiPublicState } from '@/lib/ai/types';
import { aiErrorKey, capsForLevel, disabledReason, patchNeedsCritical, type Capability, type Caps } from './logic';

export type { AiSettingsView };
export interface AiExtensionInfo { id: string; name: string; features: AiFeature[] | string[]; blocked: boolean; reason: string | null; degraded: boolean }
export type AiStateResponse = AiPublicState;

export interface TabProps {
    settings: AiSettingsView;
    extensions: AiExtensionInfo[];
    level: number;
    caps: Caps;
    /** Aplica un parche (con step-up si es critico). Devuelve null si fue bien o el texto del error (amable, por code). */
    save: (patch: Record<string, unknown>) => Promise<string | null>;
    /** Texto del motivo cuando un control no esta permitido (o undefined si lo esta). */
    reasonFor: (cap: Capability) => string | undefined;
    refresh: () => void;
}

/** Mensaje amable a partir de un error de la API (por code, si no por estado HTTP). */
export function useErrorText() {
    const { t } = useI18n();
    return React.useCallback((e: unknown): string => {
        if (e instanceof ApiError) {
            const k = aiErrorKey(e.status, e.code);
            if (k) return t(`admin.ai.errors.${k}`);
        }
        return t(apiErrorKey(e));
    }, [t]);
}

export function useReason(level: number) {
    const { t } = useI18n();
    return React.useCallback((cap: Capability) => {
        const r = disabledReason(cap, level);
        return r ? t(`admin.ai.reason.${r}`) : undefined;
    }, [level, t]);
}

export function useAiSave(level: number, guard: (fn: () => Promise<void>) => Promise<void>, refresh: () => Promise<unknown>) {
    const errorText = useErrorText();
    const { t } = useI18n();
    return React.useCallback(async (patch: Record<string, unknown>): Promise<string | null> => {
        const caps = capsForLevel(level);
        if (patchNeedsCritical(patch) ? !caps.critical : !caps.edit) return t(`admin.ai.reason.${patchNeedsCritical(patch) ? 'needCritical' : 'needEdit'}`);
        try {
            await guard(async () => { await adminFetch('/api/admin/ai/settings', { method: 'PUT', body: patch }); });
            await refresh();
            return null;
        } catch (e) {
            return errorText(e);
        }
    }, [level, guard, refresh, errorText, t]);
}

/** Aviso de resultado accesible (role=status / alert). */
export function Notice({ msg }: { msg: { kind: 'ok' | 'error'; text: string } | null }) {
    if (!msg) return null;
    return <p role={msg.kind === 'error' ? 'alert' : 'status'} className={msg.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-success'}>{msg.text}</p>;
}

/** Motivo visible bajo un control deshabilitado. */
export function Why({ reason }: { reason?: string }) {
    return reason ? <p className="text-xs text-muted-foreground">{reason}</p> : null;
}

export const FEATURE_KEYS = ['composer', 'smart-reply', 'summarize', 'translate', 'organizer', 'other'] as const;
