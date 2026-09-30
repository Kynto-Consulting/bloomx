'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Book, Code, Component, Layers, Home, Menu, Shield, Zap, Database, Palette, X } from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useLandingConfig } from '@/hooks/useLandingConfig';
import { DocsHidden } from '@/components/landing/DocsHidden';
import { useI18n } from '@/components/I18nProvider';
import { useDialog } from '@/components/ui/useDialog';
import { cn } from '@/lib/utils';

type NavItem = { href: string; labelKey: string; icon: typeof Home };
type NavSection = { titleKey: string; items: NavItem[] };

const NAV: NavSection[] = [
    {
        titleKey: 'docs.gettingStarted',
        items: [
            { href: '/docs', labelKey: 'docs.intro', icon: Home },
            { href: '/docs/architecture', labelKey: 'docs.architecture', icon: Layers },
            { href: '/docs/security', labelKey: 'docs.security', icon: Shield },
            { href: '/docs/themes', labelKey: 'docs.themes', icon: Palette },
        ],
    },
    {
        titleKey: 'docs.deepDive',
        items: [
            { href: '/docs/expansions', labelKey: 'docs.expansions', icon: Component },
            { href: '/docs/ai', labelKey: 'docs.ai', icon: Zap },
            { href: '/docs/storage', labelKey: 'docs.storage', icon: Database },
        ],
    },
    {
        titleKey: 'docs.developers',
        items: [{ href: '/docs/api', labelKey: 'docs.api', icon: Code }],
    },
];

export default function DocsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { config } = useDomainConfig();
    const { t } = useI18n();
    const { docs, isLoading: landingLoading } = useLandingConfig();
    const pathname = usePathname();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const { ref: drawerRef, titleId } = useDialog<HTMLDivElement>(drawerOpen, () => setDrawerOpen(false));
    const brand = {
        name: config.displayName || config.name,
        logo: config.logo,
    };

    // Cierra el cajon al navegar.
    useEffect(() => { setDrawerOpen(false); }, [pathname]);

    // La empresa puede ocultar la documentacion (landing.docs.visible = false): pagina amigable y sin enlaces.
    // Mientras se carga la config no se pinta el contenido (evita un parpadeo de docs que luego se ocultan).
    if (landingLoading) return <div role="status" aria-busy="true" className="min-h-screen bg-background" />;
    if (!docs.visible) return <DocsHidden />;

    return (
        <div className="min-h-screen bg-background font-sans flex flex-col">
            {/* Header */}
            <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                <div className="container flex h-14 items-center gap-2 px-4 sm:px-8">
                    <button
                        type="button"
                        onClick={() => setDrawerOpen(true)}
                        aria-label={t('docs.menu')}
                        aria-haspopup="dialog"
                        aria-expanded={drawerOpen}
                        className="md:hidden -ml-2 inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                        <Menu className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <Link href="/" className="flex items-center gap-2 font-bold text-lg min-w-0">
                        {brand.logo ? <img src={brand.logo} className="h-6 w-6 object-contain" alt="" /> : <Book className="h-5 w-5 text-primary" aria-hidden="true" />}
                        <span className="truncate">{t('docs.title', { name: brand.name })}</span>
                    </Link>
                    <div className="flex-1" />
                    <Link href="/login" className="px-4 py-2 bg-primary text-primary-foreground rounded-full text-xs font-medium hover:bg-primary/90 transition-all shadow-sm whitespace-nowrap">
                        {t('docs.openApp')}
                    </Link>
                </div>
            </header>

            {/* Cajon de navegacion (movil) */}
            {drawerOpen && (
                <div className="fixed inset-0 z-[60] md:hidden">
                    <div aria-hidden="true" className="absolute inset-0 bg-black/60" onMouseDown={() => setDrawerOpen(false)} />
                    <div
                        ref={drawerRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                        tabIndex={-1}
                        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-card text-card-foreground shadow-2xl outline-none"
                    >
                        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
                            <span id={titleId} className="font-semibold">{t('docs.navLabel')}</span>
                            <button
                                type="button"
                                onClick={() => setDrawerOpen(false)}
                                aria-label={t('common.close')}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
                            >
                                <X className="h-5 w-5" aria-hidden="true" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            <DocsNav pathname={pathname} />
                        </div>
                    </div>
                </div>
            )}

            <div className="flex-1 container max-w-7xl mx-auto flex gap-6 md:gap-10 px-4 sm:px-8 pt-6 pb-20">
                {/* Sidebar (escritorio). Usa tokens de superficie, no el primario del dominio, para garantizar contraste. */}
                <aside className="hidden md:block w-64 shrink-0 pr-4 pt-2 h-[calc(100vh-3.5rem)] sticky top-14 overflow-y-auto border-r border-border">
                    <DocsNav pathname={pathname} />
                </aside>

                {/* Main Content */}
                <main id="main-content" className="flex-1 min-w-0 py-6">
                    {children}
                </main>
            </div>
        </div>
    );
}

function DocsNav({ pathname }: { pathname: string | null }) {
    const { t } = useI18n();
    return (
        <nav aria-label={t('docs.navLabel')} className="space-y-8">
            {NAV.map((section) => (
                <div key={section.titleKey} className="space-y-2">
                    <h4 className="font-bold text-xs uppercase text-muted-foreground tracking-wider px-2">{t(section.titleKey)}</h4>
                    <ul className="flex flex-col space-y-1">
                        {section.items.map((item) => (
                            <li key={item.href}>
                                <NavLink href={item.href} icon={item.icon} active={pathname === item.href}>
                                    {t(item.labelKey)}
                                </NavLink>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </nav>
    );
}

function NavLink({ href, children, icon: Icon, active }: { href: string; children: React.ReactNode; icon?: typeof Home; active?: boolean }) {
    return (
        <Link
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
                'group flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-md transition-colors',
                active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
        >
            {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
            {children}
        </Link>
    );
}
