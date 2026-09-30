'use client';

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import type { Locale } from '@/lib/i18n/core';
import {
    resolveDocsVisibility,
    resolveLandingText,
    sanitizeLandingConfig,
    type LandingConfig,
    type LandingLayout,
} from '@/lib/landing-config';
import { landingMessage } from '@/lib/landing-messages';
import { heroSurface, pageSurface } from '@/lib/landing-surface';
import { BrandRow, Hero } from './Hero';
import { Footer } from './Footer';
import { LandingLink } from './LandingLink';
import { FeatureList } from './FeatureList';
import { Stats } from './Stats';
import { TestimonialsBlock } from './TestimonialsBlock';
import { SurfaceBox, toneOf, type ToneInfo } from './Surface';
import { LandingFormContext, type LandingActions } from './FormExtras';
import type { LandingPage, LandingView } from './types';

export interface AuthLandingProps {
    page: LandingPage;
    /** Landing de la empresa (Domain.theme.landing). Se re-sanea aqui: nunca se confia en el origen. */
    config?: unknown;
    brand: { name: string; logo?: string | null };
    /** Idioma del visitante; `config.locale` lo sobreescribe si la empresa lo fuerza. */
    locale?: Locale;
    /** Titulo/subtitulo por defecto (ya traducidos). Los de empresa ganan en login/register. */
    title: string;
    subtitle?: string;
    /** Lema por defecto del hero (diccionario). */
    tagline?: string;
    /** Icono sobre el titulo (paginas de admin). */
    icon?: ReactNode;
    /** Avisos sobre el formulario (p. ej. "cuenta creada"). */
    notice?: ReactNode;
    /** El formulario. */
    children: ReactNode;
    /** Enlace a la pagina hermana ("No tienes cuenta"). En login lo oculta form.showRegisterLink / registration.enabled. */
    altLink?: { href: string; label: string };
    actions?: LandingActions;
    /** Vista previa del editor: sin dvh, enlaces inertes, sin autoavance. */
    preview?: boolean;
    /** Fuerza un layout (las paginas de admin usan 'center'). */
    forceLayout?: LandingLayout;
    /** false = sin bloques de marketing (hero, features, stats, testimonios). Paginas de admin. */
    marketing?: boolean;
}

const SPLIT: LandingLayout[] = ['split-left', 'split-right'];

/**
 * Pantalla de acceso configurable (login, registro y admin). Sin config = diseno historico (hero a la
 * izquierda con el color primario + formulario a la derecha). Solo usa tokens de tema en superficies de tema;
 * en superficies personalizadas el texto se calcula para AA (ver landing-surface.ts).
 *
 * Responsive por CONTAINER queries (@5xl = 64rem, como el antiguo lg): asi la vista previa del editor
 * reproduce el movil/tablet/escritorio dentro de un contenedor.
 */
export function AuthLanding(props: AuthLandingProps) {
    const {
        page, brand, title, subtitle, tagline = '', icon, notice, children, altLink, actions = {},
        preview = false, forceLayout, marketing = true,
    } = props;
    const cfg: LandingConfig = useMemo(() => sanitizeLandingConfig(props.config), [props.config]);
    const locale: Locale = cfg.locale ?? props.locale ?? 'es';
    const docs = useMemo(() => resolveDocsVisibility(cfg), [cfg]);

    const view: LandingView = useMemo(() => ({
        cfg, locale, page, preview, brand, docs,
        text: (key) => resolveLandingText(cfg, locale, key),
        m: (key, params) => landingMessage(locale, key, params),
    }), [cfg, locale, page, preview, brand, docs]);

    const layout: LandingLayout = forceLayout ?? cfg.layout ?? 'split-right';
    const isSplit = SPLIT.includes(layout);
    const hasHero = marketing && (isSplit || layout === 'fullscreen-bg');
    const mobileHero = cfg.hero?.mobile ?? 'hidden';
    const posCfg = cfg.logo?.position ?? 'hero';
    const logoPos: 'header' | 'hero' | 'panel' = posCfg === 'header' ? 'header' : posCfg === 'hero' && hasHero ? 'hero' : 'panel';
    const panelWidth = cfg.panelWidth ?? 350;
    const panelVars = { '--landing-panel': `${panelWidth}px` } as CSSProperties;
    const align = cfg.form?.alignment === 'left' ? 'text-left' : 'text-center';
    const imageAlt = view.text('imageAlt');

    // ---- Textos del panel ----
    const isLogin = page === 'login';
    const isRegister = page === 'register';
    const heading = (isLogin ? view.text('formTitle') : isRegister ? view.text('registerTitle') : undefined) ?? title;
    const sub = (isLogin ? view.text('formSubtitle') : isRegister ? view.text('registerSubtitle') : undefined) ?? subtitle;
    const registrationClosed = isRegister && cfg.registration?.enabled === false;
    const closedMessage = view.text('registrationMessage') || view.m('registrationClosed');
    const showAlt = !!altLink && !(isLogin && (cfg.form?.showRegisterLink === false || cfg.registration?.enabled === false));
    const showGoogle = cfg.form?.showGoogle === true && !!actions.onGoogle && !registrationClosed;

    // ---- Superficies ----
    const hs = heroSurface(cfg);
    const ht = toneOf(hs, 'primary');
    const ps = pageSurface(cfg);
    const pt = toneOf(ps, 'background');
    const fsSurface = ps ?? hs;
    const fst = toneOf(fsSurface, 'primary');

    const rootClass = `@container relative ${preview ? 'h-full' : 'min-h-dvh'}`;
    const hClass = preview ? 'min-h-full' : 'min-h-dvh';

    // ---- Pieza: cuerpo del panel (funcion, no componente: no remonta el formulario en cada render) ----
    const panelBody = (opts: { card: boolean; mobileBrand?: { tone: ToneInfo; onSurface: boolean } | null }) => (
        <div
            style={panelVars}
            className={`mx-auto flex w-full flex-col justify-center space-y-6 @md:w-[var(--landing-panel)] ${opts.card ? 'rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm' : ''}`}
        >
            {opts.mobileBrand && (
                <div className="mb-4 flex flex-col items-center @5xl:hidden">
                    <BrandRow view={view} tone={opts.mobileBrand.tone} size="lg" onSurface={opts.mobileBrand.onSurface} />
                </div>
            )}
            {logoPos === 'panel' && (
                <div className={`flex justify-center ${opts.card ? '' : 'mb-4'}`}>
                    <BrandRow view={view} tone={{ className: '', style: {}, on: 'theme' }} size="lg" onSurface={false} />
                </div>
            )}
            {icon && <div className="flex justify-center" aria-hidden="true">{icon}</div>}
            <div className={`flex flex-col space-y-2 ${align}`}>
                <h1 id="landing-title" className="text-2xl font-semibold tracking-tight">{heading}</h1>
                {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
            </div>
            {notice}
            {registrationClosed ? (
                <p role="status" className="rounded-md border border-border bg-muted p-3 text-center text-sm text-foreground">{closedMessage}</p>
            ) : children}
            {showGoogle && (
                <button
                    type="button"
                    onClick={actions.onGoogle}
                    className="inline-flex h-9 w-full items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {view.m('google')}
                </button>
            )}
            {showAlt && altLink && (
                <p className="text-center text-sm text-muted-foreground">
                    <LandingLink href={altLink.href} preview={preview} className="rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {altLink.label}
                    </LandingLink>
                </p>
            )}
        </div>
    );

    const themeHeader = logoPos === 'header' && (
        <header className="relative z-10 flex items-center px-6 py-4">
            <BrandRow view={view} tone={{ className: '', style: {}, on: 'theme' }} size="sm" onSurface={false} />
        </header>
    );
    const surfaceHeader = (tone: ToneInfo) => logoPos === 'header' && (
        <header className="relative z-10 flex items-center px-6 py-4">
            <BrandRow view={view} tone={tone} size="sm" onSurface />
        </header>
    );
    const skip = !preview && (
        <a
            href="#landing-form"
            className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:text-foreground focus:ring-2 focus:ring-ring"
        >
            {view.m('skipToForm')}
        </a>
    );
    const mobileBrandNeeded = hasHero && logoPos === 'hero' && mobileHero === 'hidden';

    let body: ReactNode;

    if (isSplit) {
        const left = layout === 'split-left';
        const columnWidth = cfg.panelWidth ? '@5xl:w-[calc(var(--landing-panel)+8rem)] @5xl:flex-none' : '@5xl:flex-1';
        body = (
            <div className={`flex ${hClass} flex-col`}>
                {themeHeader}
                <div className="flex flex-1 flex-col @5xl:flex-row">
                    {hasHero && (
                        <SurfaceBox
                            as="section"
                            ariaLabel={brand.name}
                            surface={hs}
                            tokenClass="bg-primary"
                            pattern={cfg.hero?.pattern}
                            imageAlt={imageAlt}
                            eager
                            className={`${mobileHero === 'banner' ? 'flex' : 'hidden @5xl:flex'} min-h-48 flex-col @5xl:min-h-0 @5xl:flex-1 ${left ? '@5xl:order-2' : ''} ${ht.className}`}
                        >
                            <Hero view={view} tone={ht} tagline={tagline} showBrand={logoPos === 'hero'} compactOnMobile />
                        </SurfaceBox>
                    )}
                    <div className={`flex flex-col bg-background text-foreground ${columnWidth} ${left ? '@5xl:order-1' : ''}`}>
                        <main id="landing-form" tabIndex={-1} className="flex flex-1 flex-col justify-center p-8 outline-none">
                            {panelBody({ card: false, mobileBrand: mobileBrandNeeded ? { tone: toneOf(null, 'background'), onSurface: false } : null })}
                        </main>
                        <Footer view={view} className="w-full px-6 py-4 text-center text-xs text-muted-foreground" />
                    </div>
                </div>
            </div>
        );
    } else if (layout === 'fullscreen-bg') {
        body = (
            <SurfaceBox
                surface={fsSurface}
                tokenClass="bg-primary"
                pattern={cfg.hero?.pattern}
                imageAlt={imageAlt}
                eager
                className={`flex ${hClass} flex-col ${fst.className}`}
            >
                {surfaceHeader(fst)}
                <div className="relative z-10 grid flex-1 @5xl:grid-cols-2">
                    {hasHero && (
                        <section aria-label={brand.name} className={mobileHero === 'banner' ? 'block' : 'hidden @5xl:block'}>
                            <Hero view={view} tone={fst} tagline={tagline} showBrand={logoPos === 'hero'} compactOnMobile />
                        </section>
                    )}
                    <main id="landing-form" tabIndex={-1} className={`flex items-center justify-center p-4 outline-none @5xl:p-10 ${hasHero ? '' : '@5xl:col-span-2'}`}>
                        {panelBody({ card: true, mobileBrand: mobileBrandNeeded ? { tone: fst, onSurface: true } : null })}
                    </main>
                </div>
                <Footer view={view} style={fst.style} className="relative z-10 w-full px-6 py-4 text-center text-xs" />
            </SurfaceBox>
        );
    } else {
        // center | minimal
        const showMarketing = marketing && layout === 'center';
        const hasHeroText = !!(view.text('heroTitle') || view.text('heroSubtitle') || view.text('heroBadge'));
        const features = showMarketing ? cfg.features || [] : [];
        const stats = showMarketing ? cfg.stats || [] : [];
        const items = showMarketing && cfg.testimonials?.enabled ? cfg.testimonials.items || [] : [];
        body = (
            <SurfaceBox surface={ps} tokenClass="bg-background" pattern={undefined} className={`flex ${hClass} flex-col ${pt.className}`}>
                {surfaceHeader(pt)}
                <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8 px-4 py-10">
                    {showMarketing && hasHeroText && (
                        <div className="w-full max-w-2xl">
                            <Hero view={view} tone={pt} tagline="" showBrand={false} compactOnMobile={false} centered blocks={{ features: false, stats: false, testimonials: false }} className="h-auto p-0" />
                        </div>
                    )}
                    <main id="landing-form" tabIndex={-1} className="w-full outline-none">
                        {panelBody({ card: true, mobileBrand: null })}
                    </main>
                    {(features.length > 0 || stats.length > 0 || items.length > 0) && (
                        <div className="grid w-full max-w-4xl gap-8 @3xl:grid-cols-2">
                            {features.length > 0 && <FeatureList features={features} label={view.m('features')} />}
                            {stats.length > 0 && <Stats stats={stats} label={view.m('stats')} className="grid grid-cols-2 content-start gap-x-6 gap-y-4" />}
                            {items.length > 0 && (
                                <div className="@3xl:col-span-2">
                                    <TestimonialsBlock view={view} items={items} style={cfg.testimonials?.style || 'cards'} />
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <Footer
                    view={view}
                    style={pt.style}
                    className={`relative z-10 w-full px-6 py-4 text-center text-xs ${ps ? '' : 'text-muted-foreground'}`}
                />
            </SurfaceBox>
        );
    }

    return (
        <LandingFormContext.Provider value={{ view, actions }}>
            <div className={rootClass} data-landing-layout={layout} data-landing-page={page} lang={locale}>
                {skip}
                {body}
            </div>
        </LandingFormContext.Provider>
    );
}
