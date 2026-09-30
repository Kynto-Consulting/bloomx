import type { Locale } from '@/lib/i18n/core';
import type { LandingConfig, LandingTextKey } from '@/lib/landing-config';
import type { resolveDocsVisibility } from '@/lib/landing-config';
import type { LandingMessageKey } from '@/lib/landing-messages';

export type LandingPage = 'login' | 'register' | 'admin-login' | 'admin-register';

/** Contexto de render compartido por los subcomponentes (todo ya resuelto: sin acceso a red ni a hooks). */
export interface LandingView {
    cfg: LandingConfig;
    locale: Locale;
    page: LandingPage;
    preview: boolean;
    brand: { name: string; logo?: string | null };
    docs: ReturnType<typeof resolveDocsVisibility>;
    /** Texto de empresa (i18n[locale] > base) o undefined. */
    text: (key: LandingTextKey) => string | undefined;
    /** Cadena por defecto de la landing. */
    m: (key: LandingMessageKey, params?: Record<string, string | number>) => string;
}
