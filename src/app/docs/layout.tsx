'use client';

import Link from 'next/link';
import { Book, Code, Component, Layers, ChevronRight, Home, Menu, Shield, Zap, Database } from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';

export default function DocsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { config } = useDomainConfig();
    const brand = {
        name: config.displayName || config.name,
        logo: config.logo,
        color: config.theme?.primaryColor
    };

    return (
        <div className="min-h-screen bg-background font-sans flex flex-col">
            {/* Header */}
            <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="container flex h-14 items-center gap-4 px-4 sm:px-8">
                    <Link href="/" className="flex items-center gap-2 font-bold text-lg">
                        {brand.logo ? <img src={brand.logo} className="h-6 w-6 object-contain" alt={brand.name} /> : <span className="text-xl">🌸</span>}
                        <span>{brand.name} Docs</span>
                    </Link>
                    <div className="flex-1" />
                    <Link href="/login" className="px-4 py-2 bg-primary text-primary-foreground rounded-full text-xs font-medium hover:bg-primary/90 transition-all shadow-sm">
                        Open App
                    </Link>
                </div>
            </header>

            <div className="flex-1 container max-w-7xl mx-auto flex gap-6 md:gap-10 px-4 sm:px-8 pt-6 pb-20">
                {/* Sidebar */}
                <aside className="hidden md:block w-64 shrink-0 bg-primary text-primary-foreground pr-6 pl-6 pt-6 space-y-8 h-[calc(100vh-3.5rem)] sticky top-14 overflow-y-auto z-40">
                    <div className="space-y-4">
                        <SectionTitle>Getting Started</SectionTitle>
                        <nav className="flex flex-col space-y-1">
                            <NavLink href="/docs" icon={Home}>Introduction</NavLink>
                            <NavLink href="/docs/architecture" icon={Layers}>Architecture</NavLink>
                            <NavLink href="/docs/security" icon={Shield}>Security & Encryption</NavLink>
                        </nav>
                    </div>

                    <div className="space-y-4">
                        <SectionTitle>Deep Dive</SectionTitle>
                        <nav className="flex flex-col space-y-1">
                            <NavLink href="/docs/expansions" icon={Component}>Expansion Ecosystem</NavLink>
                            <NavLink href="/docs/ai" icon={Zap}>AI Capabilities</NavLink>
                            <NavLink href="/docs/storage" icon={Database}>Storage Providers</NavLink>
                        </nav>
                    </div>

                    <div className="space-y-4">
                        <SectionTitle>Developers</SectionTitle>
                        <nav className="flex flex-col space-y-1">
                            <NavLink href="/docs/api" icon={Code}>API Reference</NavLink>
                        </nav>
                    </div>
                </aside>

                {/* Main Content */}
                <main className="flex-1 min-w-0 py-6">
                    {children}
                </main>
            </div>
        </div>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return <h4 className="font-bold text-xs uppercase text-primary-foreground/70 tracking-wider mb-2 px-2">{children}</h4>;
}

function NavLink({ href, children, icon: Icon }: { href: string, children: React.ReactNode, icon?: any }) {
    return (
        <Link
            href={href}
            className="group flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-md text-primary-foreground/90 hover:bg-primary-foreground/10 hover:text-primary-foreground transition-all duration-200"
        >
            {Icon && <Icon className="h-4 w-4 opacity-70 group-hover:opacity-100 transition-colors" />}
            {children}
        </Link>
    );
}
