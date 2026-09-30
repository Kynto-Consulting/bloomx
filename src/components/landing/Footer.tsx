import type { LandingView } from './types';
import { LandingLink } from './LandingLink';

interface Props {
    view: LandingView;
    style?: React.CSSProperties;
    className?: string;
}

/** Pie: texto, enlaces, legales, docs (si la empresa lo activa) y "powered by". Devuelve null si no hay nada. */
export function Footer({ view, style, className }: Props) {
    const { cfg, text, m, preview, docs } = view;
    const footerText = text('footerText');
    const links: { label: string; url: string }[] = [...(cfg.footer?.links || [])];
    if (cfg.legal?.termsUrl) links.push({ label: m('terms'), url: cfg.legal.termsUrl });
    if (cfg.legal?.privacyUrl) links.push({ label: m('privacy'), url: cfg.legal.privacyUrl });
    const showDocs = docs.footer;
    const powered = cfg.footer?.showPoweredBy === true;
    if (!footerText && links.length === 0 && !showDocs && !powered) return null;

    const linkClass = 'underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm';
    return (
        <footer className={className ?? 'w-full px-6 py-4 text-center text-xs'} style={style}>
            {footerText && <p>{footerText}</p>}
            {(links.length > 0 || showDocs) && (
                <nav aria-label={m('footerNav')} className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
                    {showDocs && <LandingLink href="/docs" preview={preview} className={linkClass}>{m('docsLabel')}</LandingLink>}
                    {links.map((l, i) => <LandingLink key={i} href={l.url} preview={preview} className={linkClass}>{l.label}</LandingLink>)}
                </nav>
            )}
            {powered && <p className="mt-1">{m('poweredBy', { name: 'Bloomx' })}</p>}
        </footer>
    );
}
