import { Book } from 'lucide-react';
import type { LandingView } from './types';
import type { ToneInfo } from './Surface';
import { BrandMark } from './BrandMark';
import { FeatureList } from './FeatureList';
import { Stats } from './Stats';
import { TestimonialsBlock } from './TestimonialsBlock';
import { LandingLink } from './LandingLink';

/** Marca + enlace a la documentacion (si la empresa no la oculta). */
export function BrandRow({ view, tone, size = 'sm', onSurface }: { view: LandingView; tone: ToneInfo; size?: 'sm' | 'lg'; onSurface: boolean }) {
    const showDocs = view.docs.landingLink;
    return (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <BrandMark view={view} size={size} on={tone.on} />
            {showDocs && (
                <LandingLink
                    href="/docs"
                    preview={view.preview}
                    className={`flex items-center gap-1 rounded-sm text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${onSurface ? 'border-l border-current/40 pl-6 font-normal' : 'font-medium text-muted-foreground hover:text-primary'}`}
                >
                    <Book className="h-4 w-4" aria-hidden="true" />
                    {view.m('docsLabel')}
                </LandingLink>
            )}
        </div>
    );
}

interface HeroProps {
    view: LandingView;
    tone: ToneInfo;
    /** Texto por defecto (tagline del diccionario) si la empresa no configuro titulo/subtitulo. */
    tagline: string;
    /** Mostrar marca dentro del hero (logo.position === 'hero'). */
    showBrand: boolean;
    /** Movil compacto: oculta features/stats/testimonios por debajo del breakpoint. */
    compactOnMobile: boolean;
    /** true = los bloques van centrados (layout center). */
    centered?: boolean;
    /** Bloques a incluir. */
    blocks?: { features?: boolean; stats?: boolean; testimonials?: boolean };
    className?: string;
}

/** Contenido del hero. Hereda el color del contenedor (tokens o color calculado). */
export function Hero({ view, tone, tagline, showBrand, compactOnMobile, centered, blocks, className }: HeroProps) {
    const { cfg, text, m } = view;
    const title = text('heroTitle');
    const subtitle = text('heroSubtitle');
    const badge = text('heroBadge');
    const features = blocks?.features === false ? [] : cfg.features || [];
    const stats = blocks?.stats === false ? [] : cfg.stats || [];
    const tst = cfg.testimonials;
    const items = blocks?.testimonials === false || !tst?.enabled ? [] : tst.items || [];
    const align = centered ? 'items-center text-center' : 'items-start text-left';
    const extra = `w-full max-w-xl text-left ${compactOnMobile ? 'hidden @5xl:block' : 'block'}`;
    return (
        <div className={`relative z-10 flex h-full flex-col gap-8 p-6 @5xl:p-10 ${className || ''}`}>
            {showBrand && <BrandRow view={view} tone={tone} size="sm" onSurface />}
            <div className={`mt-auto flex flex-col gap-5 ${align}`}>
                {badge && (
                    <span className="inline-flex rounded-full border border-current/50 px-3 py-1 text-xs font-medium">{badge}</span>
                )}
                {title ? (
                    <h2 className="text-3xl font-bold leading-tight tracking-tight @5xl:text-4xl">{title}</h2>
                ) : (
                    !subtitle && tagline && <p className="text-lg">{tagline}</p>
                )}
                {subtitle && <p className="max-w-xl text-base leading-relaxed">{subtitle}</p>}
                {features.length > 0 && <div className={extra}><FeatureList features={features} label={m('features')} /></div>}
                {stats.length > 0 && (
                    <div className={extra}>
                        <Stats stats={stats} label={m('stats')} className="grid grid-cols-2 gap-x-6 gap-y-4 @xl:grid-cols-4" />
                    </div>
                )}
                {items.length > 0 && (
                    <div className={extra}>
                        <TestimonialsBlock view={view} items={items} style={tst?.style || 'cards'} />
                    </div>
                )}
            </div>
        </div>
    );
}
