'use client';

import { Inbox, Star, Clock, Send, File, MoreHorizontal, Search, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { applyBrand, getTheme, TOKEN_KEYS, type DomainThemeConfig } from '@/lib/themes';

interface ThemePreviewProps {
    settings: {
        primaryColor: string;
        secondaryColor: string;
        backgroundColor: string;
        textColor: string;
        accentColor: string;
        mutedColor?: string;
        borderColor?: string;
        cardColor?: string;
        titleFont?: string;
        bodyFont?: string;
        logo?: string;
        displayName?: string;
    };
}

export function ThemePreview({ settings }: ThemePreviewProps) {
    // Generate inline styles for the preview container to override global vars LOCALLY
    // Usa la MISMA funcion que aplica la marca en produccion (applyBrand), sobre el tema claro:
    // asi la vista previa muestra exactamente lo que se vera, incluidos los ajustes de contraste.
    const light = getTheme('light')!;
    const brand = applyBrand(light, settings as DomainThemeConfig);
    const previewStyles: Record<string, string> = {
        '--font-title': settings.titleFont || 'Inter',
        '--font-body': settings.bodyFont || 'Inter',
    };
    for (const key of TOKEN_KEYS) {
        previewStyles[`--color-${key}`] = brand[key] ?? light.tokens[key];
    }

    return (
        <div
            className="w-full h-[500px] rounded-xl overflow-hidden border border-border shadow-2xl flex text-xs select-none bg-background text-foreground"
            style={{
                ...(previewStyles as React.CSSProperties),
                fontFamily: 'var(--font-body)',
            }}
        >
            {/* Mock Sidebar */}
            <div className="w-16 md:w-48 bg-muted/30 flex flex-col border-r border-border">
                <div className="p-3 flex items-center gap-2 font-bold text-primary">
                    {settings.logo ? (
                        <div className="w-6 h-6 rounded overflow-hidden flex-shrink-0">
                            <img src={settings.logo} alt="Logo" className="w-full h-full object-contain" />
                        </div>
                    ) : (
                        <div className="w-6 h-6 rounded bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
                            {settings.displayName ? settings.displayName.charAt(0) : 'B'}
                        </div>
                    )}
                    <span className="hidden md:inline truncate">{settings.displayName || 'Mail'}</span>
                </div>
                <div className="flex-1 px-2 py-2 space-y-0.5">
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-primary/10 text-primary rounded-md font-medium">
                        <Inbox className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">Inbox</span>
                        <span className="ml-auto text-[11px] bg-primary text-primary-foreground px-1.5 rounded-full hidden md:inline-block">2</span>
                    </div>
                    <div className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors">
                        <Star className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">Starred</span>
                    </div>
                    <div className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors">
                        <Send className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">Sent</span>
                    </div>
                </div>
            </div>

            {/* Mock Content */}
            <div className="flex-1 flex flex-col bg-background">
                {/* Header */}
                <div className="h-12 border-b border-border flex items-center justify-between px-4 bg-background/50 backdrop-blur-sm sticky top-0">
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/50 px-2 py-1 rounded w-48">
                        <Search className="w-3.5 h-3.5" />
                        <span>Search...</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Settings className="w-4 h-4" />
                        <div className="w-6 h-6 rounded-full bg-brand-accent/20 border border-brand-accent flex items-center justify-center text-brand-accent text-[11px] font-bold">
                            JD
                        </div>
                    </div>
                </div>

                {/* Mail List */}
                <div className="flex-1 p-4 space-y-2 overflow-hidden relative">
                    {/* Item 1 (Unread) */}
                    <div className="bg-card border border-border p-3 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-default group flex gap-3 relative overflow-hidden">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">
                            AB
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-baseline mb-0.5">
                                <span className="font-semibold text-foreground truncate">Alice Brown</span>
                                <span className="text-[11px] text-muted-foreground whitespace-nowrap">10:42 AM</span>
                            </div>
                            <div className="font-medium text-foreground text-xs mb-0.5">Project Update: Q1 Goals</div>
                            <div className="text-muted-foreground line-clamp-1">Hi team, just wanted to share the latest numbers from the Q1 report...</div>
                        </div>
                    </div>

                    {/* Item 2 (Read) */}
                    <div className="bg-card/50 border border-border/50 p-3 rounded-lg hover:border-border transition-colors cursor-default flex gap-3 opacity-80 hover:opacity-100">
                        <div className="w-8 h-8 rounded-full bg-brand-accent/10 flex items-center justify-center text-brand-accent font-bold shrink-0">
                            CD
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-baseline mb-0.5">
                                <span className="font-medium text-foreground truncate">Charlie Davis</span>
                                <span className="text-[11px] text-muted-foreground whitespace-nowrap">Yesterday</span>
                            </div>
                            <div className="text-foreground text-xs mb-0.5">Lunch next week?</div>
                            <div className="text-muted-foreground line-clamp-1">Are you free next Tuesday to grab some lunch and discuss the...</div>
                        </div>
                    </div>

                    {/* Item 3 (Selected/Active) */}
                    <div className="bg-brand-accent/5 border border-brand-accent/20 p-3 rounded-lg flex gap-3 ring-1 ring-brand-accent/30">
                        <div className="w-8 h-8 rounded-full bg-success/15 text-success flex items-center justify-center font-bold shrink-0">
                            EF
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-baseline mb-0.5">
                                <span className="font-medium text-foreground truncate">Emily Foster</span>
                                <span className="text-[11px] text-muted-foreground whitespace-nowrap">2 Days ago</span>
                            </div>
                            <div className="text-foreground text-xs mb-0.5">Invoice #4029</div>
                            <div className="text-muted-foreground line-clamp-1">Please find attached the invoice for the consultancy services...</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Add these to globals.css if not present for the scoped variables to work effectively with tailwind classes
// Actually, since we use inline styles on the container for --color-primary etc,
// and the tailwind classes refer to `var(--color-primary)`, this should work automatically
// IF the tailwind classes generate `var(--color-primary)` without `@theme` block scope issues.
// Our `globals.css` uses `@theme` which defines these globally.
// Local inline style override on a parent element should cascade down correctly to chilren using `text-primary` etc.
