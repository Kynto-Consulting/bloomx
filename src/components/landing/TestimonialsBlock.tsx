'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Quote } from 'lucide-react';
import type { LandingTestimonial, LandingTestimonialStyle } from '@/lib/landing-config';
import type { LandingView } from './types';

interface Props {
    view: LandingView;
    items: LandingTestimonial[];
    style: LandingTestimonialStyle;
}

function Avatar({ t }: { t: LandingTestimonial }) {
    if (t.avatarUrl) {
        return (
            <img
                src={t.avatarUrl}
                alt=""
                width={36}
                height={36}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className="h-9 w-9 shrink-0 rounded-full object-cover"
            />
        );
    }
    const initial = (t.author || '?').trim().charAt(0).toUpperCase();
    return (
        <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
            {initial}
        </span>
    );
}

/** Tarjeta con tokens propios (bg-card): su contraste no depende de la superficie del hero. */
function Card({ t }: { t: LandingTestimonial }) {
    return (
        <figure className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm">
            <blockquote className="text-sm leading-relaxed">{t.quote}</blockquote>
            {(t.author || t.role) && (
                <figcaption className="mt-3 flex items-center gap-3">
                    <Avatar t={t} />
                    <span className="min-w-0 text-sm">
                        {t.author && <span className="block truncate font-semibold">{t.author}</span>}
                        {t.role && <span className="block truncate text-muted-foreground">{t.role}</span>}
                    </span>
                </figcaption>
            )}
        </figure>
    );
}

function reducedMotion(): boolean {
    try {
        return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
            || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return true;
    }
}

function Carousel({ view, items }: { view: LandingView; items: LandingTestimonial[] }) {
    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const [auto, setAuto] = useState(false);
    const count = items.length;

    // Autoavance solo si el usuario NO pide movimiento reducido; se detiene con foco/hover y en la vista previa.
    useEffect(() => { setAuto(!view.preview && !reducedMotion()); }, [view.preview]);
    useEffect(() => {
        if (!auto || paused || count < 2) return;
        const id = window.setInterval(() => setIndex((i) => (i + 1) % count), 7000);
        return () => window.clearInterval(id);
    }, [auto, paused, count]);
    useEffect(() => { if (index >= count) setIndex(0); }, [count, index]);

    const go = (i: number) => setIndex(((i % count) + count) % count);
    const btn = 'inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-card-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
    return (
        <div
            role="region"
            aria-roledescription="carousel"
            aria-label={view.m('testimonials')}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
        >
            <div aria-live={auto && !paused ? 'off' : 'polite'} aria-atomic="true">
                <div role="group" aria-roledescription="slide" aria-label={`${index + 1} / ${count}`}>
                    <Card t={items[Math.min(index, count - 1)]} />
                </div>
            </div>
            {count > 1 && (
                <div className="mt-3 flex items-center justify-between gap-3">
                    <button type="button" className={btn} onClick={() => go(index - 1)} aria-label={view.m('prevTestimonial')}>
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <div className="flex items-center gap-2">
                        {items.map((_, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => go(i)}
                                aria-label={view.m('goToTestimonial', { n: i + 1 })}
                                aria-current={i === index ? 'true' : undefined}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <span className={`h-2 w-2 rounded-full border border-current ${i === index ? 'bg-current' : ''}`} />
                            </button>
                        ))}
                    </div>
                    <button type="button" className={btn} onClick={() => go(index + 1)} aria-label={view.m('nextTestimonial')}>
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>
            )}
        </div>
    );
}

/** Testimonios (solo los que la empresa configuro; nunca hay contenido inventado). */
export function TestimonialsBlock({ view, items, style }: Props) {
    if (!items.length) return null;
    if (style === 'carousel') return <Carousel view={view} items={items} />;
    if (style === 'quote') {
        const t = items[0];
        return (
            <figure aria-label={view.m('testimonials')}>
                <Quote className="mb-2 h-6 w-6 opacity-80" aria-hidden="true" />
                <blockquote className="text-lg font-medium leading-snug">{t.quote}</blockquote>
                {(t.author || t.role) && (
                    <figcaption className="mt-3 flex items-center gap-3 text-sm">
                        <Avatar t={t} />
                        <span className="min-w-0">
                            {t.author && <span className="block truncate font-semibold">{t.author}</span>}
                            {t.role && <span className="block truncate">{t.role}</span>}
                        </span>
                    </figcaption>
                )}
            </figure>
        );
    }
    return (
        <ul aria-label={view.m('testimonials')} className="grid gap-3">
            {items.map((t, i) => <li key={i}><Card t={t} /></li>)}
        </ul>
    );
}
