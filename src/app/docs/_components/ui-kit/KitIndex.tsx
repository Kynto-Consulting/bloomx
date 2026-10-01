'use client';

import Link from 'next/link';
import { UI_COMPONENTS } from '@/lib/expansions/ui-schema';
import { useI18n } from '@/components/I18nProvider';
import { kitDescription, kitGroups, kitHref } from '../../_content/ui-kit/kit';
import { fill, kitStrings } from './strings';

/**
 * Indice de componentes del kit: rejilla de tarjetas agrupada por categoria, con enlace a /docs/extension-ui/<componente>.
 * Se genera de UI_COMPONENTS (sin mini-preview: renderizar ~75 componentes en la pagina principal costaria mas que aporta;
 * la vista previa viva esta en cada pagina).
 */
export function KitIndex() {
    const { locale } = useI18n();
    const t = kitStrings(locale);
    const groups = kitGroups();
    const total = groups.reduce((n, g) => n + g.types.length, 0);
    return (
        <div className="space-y-6" data-testid="kit-index">
            <p className="text-sm text-muted-foreground">{t.indexIntro} · {fill(t.indexCount, { n: total })}</p>
            <nav aria-label={t.indexTitle} className="flex flex-wrap gap-2">
                {groups.map((g) => (
                    <a key={g.id} href={`#idx-${g.id}`} className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {g.label[locale]} ({g.types.length})
                    </a>
                ))}
            </nav>
            {groups.map((g) => (
                <section key={g.id} aria-labelledby={`idx-${g.id}`} className="space-y-2">
                    <h3 id={`idx-${g.id}`} className="scroll-mt-20 text-lg font-semibold">{g.label[locale]}</h3>
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {g.types.map((type) => (
                            <li key={type}>
                                <Link href={kitHref(type)} className="block h-full rounded-lg border border-border bg-card p-3 text-card-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    <span className="block font-mono text-sm font-semibold">{type}</span>
                                    <span className="mt-1 block text-xs text-muted-foreground">{kitDescription(type, locale)}</span>
                                    <span className="mt-2 block text-[11px] text-muted-foreground">{Object.keys(UI_COMPONENTS[type].props).length} {t.props}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}
