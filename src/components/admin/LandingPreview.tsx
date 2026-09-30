'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Monitor, Moon, Smartphone, Sun, Tablet } from 'lucide-react';
import { getTranslator, LOCALES, type Locale } from '@/lib/i18n';
import { resolveLandingText, sanitizeLandingConfig } from '@/lib/landing-config';
import { AuthLanding } from '@/components/landing/AuthLanding';
import { LandingFormExtras } from '@/components/landing/FormExtras';
import type { DomainThemeConfig } from '@/lib/theme-config';
import { previewCssVars } from './theme-editor/preview-style';

export type PreviewDevice = 'desktop' | 'tablet' | 'mobile';
export type PreviewMode = 'light' | 'dark';

/** Tamano logico de cada dispositivo (los @container queries del render responden a este ancho). */
export const PREVIEW_DEVICES: Record<PreviewDevice, { width: number; height: number }> = {
    desktop: { width: 1280, height: 800 },
    tablet: { width: 820, height: 1024 },
    mobile: { width: 390, height: 780 },
};

const UI = {
    es: { device: 'Dispositivo', mode: 'Modo', desktop: 'Escritorio', tablet: 'Tablet', mobile: 'Móvil', light: 'Claro', dark: 'Oscuro', page: 'Pantalla', login: 'Inicio de sesión', register: 'Registro', lang: 'Idioma', frame: 'Vista previa de la pantalla de acceso' },
    en: { device: 'Device', mode: 'Mode', desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile', light: 'Light', dark: 'Dark', page: 'Screen', login: 'Sign in', register: 'Register', lang: 'Language', frame: 'Sign-in screen preview' },
} as const;

/**
 * Variables CSS del tema (claro/oscuro) + marca de la empresa, aisladas en el contenedor de la vista previa.
 * Usa el motor actual (buildBrandThemes): mismos tokens, radio y fuentes que la app real.
 */
export function previewThemeStyle(mode: PreviewMode, themeConfig?: DomainThemeConfig | null, brandName?: string): CSSProperties {
    return previewCssVars(mode, themeConfig, brandName);
}

interface Props {
    /** Landing en edicion (se sanea dentro de AuthLanding). */
    value: unknown;
    locale?: Locale;
    brandName?: string;
    brandLogo?: string | null;
    /** Colores/tipografia de marca de la empresa (Domain.theme) para que la vista previa se vea como la real. */
    themeConfig?: DomainThemeConfig | null;
    device?: PreviewDevice;
    mode?: PreviewMode;
    onDeviceChange?: (d: PreviewDevice) => void;
    onModeChange?: (m: PreviewMode) => void;
    hideControls?: boolean;
    className?: string;
}

const fieldClass = 'flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm';

/** Vista previa en vivo: el MISMO AuthLanding que ve el visitante, con datos de demostracion y enlaces inertes. */
export function LandingPreview({
    value, locale = 'es', brandName, brandLogo, themeConfig, device: deviceProp, mode: modeProp,
    onDeviceChange, onModeChange, hideControls, className,
}: Props) {
    const [deviceState, setDevice] = useState<PreviewDevice>('desktop');
    const [modeState, setMode] = useState<PreviewMode>('light');
    const [pageState, setPage] = useState<'login' | 'register'>('login');
    const [lang, setLang] = useState<Locale>(locale);
    const [remember, setRemember] = useState(false);
    useEffect(() => { setLang(locale); }, [locale]);
    const device = deviceProp ?? deviceState;
    const mode = modeProp ?? modeState;
    const ui = UI[locale] || UI.es;
    const cfg = useMemo(() => sanitizeLandingConfig(value), [value]);
    // Si la empresa fuerza un idioma (landing.locale), la vista previa tambien lo fuerza.
    const effLang: Locale = cfg.locale ?? lang;
    const t = getTranslator(effLang).t;

    const outerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);
    const dims = PREVIEW_DEVICES[device];
    useEffect(() => {
        const el = outerRef.current;
        if (!el) return;
        const measure = () => setScale(Math.min(1, el.clientWidth / dims.width) || 1);
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [dims.width]);

    const themeStyle = useMemo(() => previewThemeStyle(mode, themeConfig, brandName), [mode, themeConfig, brandName]);
    const brand = useMemo(() => ({ name: brandName || 'Tu empresa', logo: brandLogo }), [brandName, brandLogo]);
    const setDev = (d: PreviewDevice) => { setDevice(d); onDeviceChange?.(d); };
    const setMod = (m: PreviewMode) => { setMode(m); onModeChange?.(m); };

    const seg = (active: boolean) => `inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`;
    const isLogin = pageState === 'login';

    return (
        <div className={className}>
            {!hideControls && (
                <div className="mb-3 flex flex-wrap items-center gap-3">
                    <div role="group" aria-label={ui.device} className="inline-flex rounded-lg border border-border bg-card p-1">
                        {([['desktop', Monitor, ui.desktop], ['tablet', Tablet, ui.tablet], ['mobile', Smartphone, ui.mobile]] as const).map(([id, Icon, label]) => (
                            <button key={id} type="button" aria-pressed={device === id} onClick={() => setDev(id)} className={seg(device === id)}>
                                <Icon className="h-4 w-4" aria-hidden="true" />{label}
                            </button>
                        ))}
                    </div>
                    <div role="group" aria-label={ui.mode} className="inline-flex rounded-lg border border-border bg-card p-1">
                        <button type="button" aria-pressed={mode === 'light'} onClick={() => setMod('light')} className={seg(mode === 'light')}><Sun className="h-4 w-4" aria-hidden="true" />{ui.light}</button>
                        <button type="button" aria-pressed={mode === 'dark'} onClick={() => setMod('dark')} className={seg(mode === 'dark')}><Moon className="h-4 w-4" aria-hidden="true" />{ui.dark}</button>
                    </div>
                    <div role="group" aria-label={ui.page} className="inline-flex rounded-lg border border-border bg-card p-1">
                        <button type="button" aria-pressed={isLogin} onClick={() => setPage('login')} className={seg(isLogin)}>{ui.login}</button>
                        <button type="button" aria-pressed={!isLogin} onClick={() => setPage('register')} className={seg(!isLogin)}>{ui.register}</button>
                    </div>
                    <div role="group" aria-label={ui.lang} className="inline-flex rounded-lg border border-border bg-card p-1">
                        {LOCALES.map((l) => (
                            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={seg(lang === l)}>{l.toUpperCase()}</button>
                        ))}
                    </div>
                </div>
            )}

            <div ref={outerRef} className="w-full overflow-hidden rounded-lg border border-border bg-muted" style={{ height: dims.height * scale }}>
                <div
                    role="group"
                    aria-label={ui.frame}
                    data-scheme={mode}
                    data-preview-device={device}
                    style={{
                        ...themeStyle,
                        width: dims.width,
                        height: dims.height,
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left',
                        backgroundColor: 'var(--color-background)',
                        color: 'var(--color-foreground)',
                        overflow: 'auto',
                    }}
                >
                    <AuthLanding
                        preview
                        page={pageState}
                        config={value}
                        brand={brand}
                        locale={lang}
                        title={isLogin ? t('auth.login.title') : t('auth.register.title')}
                        subtitle={isLogin ? t('auth.login.subtitle') : t('auth.register.subtitle')}
                        tagline={isLogin ? t('auth.login.tagline') : t('auth.register.tagline')}
                        altLink={isLogin
                            ? { href: '/register', label: t('auth.login.noAccount') }
                            : { href: '/login', label: t('auth.register.haveAccount') }}
                        actions={{ forgotHref: '#', onGoogle: () => { }, remember: { checked: remember, onChange: setRemember } }}
                    >
                        <form onSubmit={(e) => e.preventDefault()} className="grid gap-4" aria-hidden="true">
                            <div className="grid gap-2">
                                <span className="text-sm font-medium leading-none">{t('auth.login.email')}</span>
                                <input tabIndex={-1} disabled className={fieldClass} placeholder={t('auth.login.emailPlaceholder')} />
                            </div>
                            <div className="grid gap-2">
                                <span className="text-sm font-medium leading-none">{t('auth.login.password')}</span>
                                <input tabIndex={-1} disabled type="password" className={fieldClass} placeholder="••••••••" />
                            </div>
                            <LandingFormExtras />
                            <button type="button" tabIndex={-1} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow">
                                {resolveLandingText(cfg, effLang, isLogin ? 'submitLabel' : 'registerSubmitLabel') ?? (isLogin ? t('auth.login.submit') : t('auth.register.submit'))}
                            </button>
                        </form>
                    </AuthLanding>
                </div>
            </div>
        </div>
    );
}
