'use client';

import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/ThemeProvider';
import {
    DEFAULT_DARK_THEME,
    DEFAULT_LIGHT_THEME,
    MAIL_DARK_MODES,
    getTheme,
    type ThemeDefinition,
    type ThemePreference,
} from '@/lib/themes';

/**
 * Mini vista previa de un tema. Usa los valores CRUDOS del registro (no las
 * variables CSS activas) porque debe mostrar un tema distinto al actual.
 */
function ThemeSwatch({ theme }: { theme: ThemeDefinition }) {
    const t = theme.tokens;
    return (
        <div
            aria-hidden
            className="flex h-16 w-full overflow-hidden rounded-md border"
            style={{ backgroundColor: t.background, borderColor: t.border }}
        >
            <div className="flex w-1/4 flex-col gap-1 p-1.5" style={{ backgroundColor: t.muted }}>
                <div className="h-1.5 w-full rounded-sm" style={{ backgroundColor: t.primary }} />
                <div className="h-1.5 w-2/3 rounded-sm" style={{ backgroundColor: t['muted-foreground'], opacity: 0.6 }} />
                <div className="h-1.5 w-3/4 rounded-sm" style={{ backgroundColor: t['muted-foreground'], opacity: 0.6 }} />
            </div>
            <div className="flex flex-1 flex-col gap-1 p-1.5">
                <div className="flex flex-col gap-1 rounded-sm p-1" style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }}>
                    <div className="h-1.5 w-1/2 rounded-sm" style={{ backgroundColor: t.foreground }} />
                    <div className="h-1 w-3/4 rounded-sm" style={{ backgroundColor: t['muted-foreground'] }} />
                </div>
                <div className="flex gap-1">
                    <div className="h-2.5 w-8 rounded-sm" style={{ backgroundColor: t.primary }} />
                    <div className="h-2.5 w-5 rounded-sm" style={{ backgroundColor: t.destructive }} />
                    <div className="h-2.5 w-5 rounded-sm" style={{ backgroundColor: t.success }} />
                </div>
            </div>
        </div>
    );
}

/** Vista previa "Sistema": mitad clara, mitad oscura. */
function SystemSwatch() {
    const l = getTheme(DEFAULT_LIGHT_THEME)!;
    const d = getTheme(DEFAULT_DARK_THEME)!;
    return (
        <div aria-hidden className="relative h-16 w-full overflow-hidden rounded-md border border-border">
            <div className="absolute inset-0"><ThemeSwatch theme={l} /></div>
            <div className="absolute inset-0" style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}>
                <ThemeSwatch theme={d} />
            </div>
        </div>
    );
}

interface OptionProps {
    value: ThemePreference;
    label: string;
    description: string;
    checked: boolean;
    onSelect: (v: ThemePreference) => void;
    icon?: React.ReactNode;
    children: React.ReactNode;
}

function ThemeOption({ value, label, description, checked, onSelect, icon, children }: OptionProps) {
    return (
        <label className="relative block cursor-pointer">
            <input
                type="radio"
                name="bloomx-theme"
                value={value}
                checked={checked}
                onChange={() => onSelect(value)}
                className="peer sr-only"
            />
            <div
                className={cn(
                    'flex h-full flex-col gap-2 rounded-xl border bg-card p-2.5 text-card-foreground transition-all',
                    'hover:border-input hover:shadow-sm',
                    'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                    checked ? 'border-primary ring-2 ring-primary' : 'border-border',
                )}
            >
                {children}
                <div className="flex items-start justify-between gap-2 px-0.5">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium">
                            {icon}
                            <span className="truncate">{label}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
                    </div>
                    {checked && (
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-3 w-3" strokeWidth={3} />
                        </span>
                    )}
                </div>
            </div>
        </label>
    );
}

export function AppearanceSettings() {
    const { themes, preference, resolvedTheme, setPreference, mailDarkMode, setMailDarkMode } = useTheme();

    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            <div className="space-y-4">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        <Sun className="h-4 w-4" /> Tema
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Se aplica al instante y se guarda en este dispositivo y en tu cuenta.
                        Ahora mismo: <span className="font-medium text-foreground">{preference === 'system' ? `Sistema (${resolvedTheme.label})` : resolvedTheme.label}</span>.
                    </p>
                </div>
                <div role="radiogroup" aria-label="Tema de la aplicacion" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <ThemeOption
                        value="system"
                        label="Sistema"
                        description="Sigue el modo claro/oscuro de tu dispositivo."
                        checked={preference === 'system'}
                        onSelect={setPreference}
                        icon={<Monitor className="h-3.5 w-3.5 shrink-0" />}
                    >
                        <SystemSwatch />
                    </ThemeOption>
                    {themes.map((theme) => (
                        <ThemeOption
                            key={theme.id}
                            value={theme.id}
                            label={theme.label}
                            description={theme.description}
                            checked={preference === theme.id}
                            onSelect={setPreference}
                            icon={theme.scheme === 'dark' ? <Moon className="h-3.5 w-3.5 shrink-0" /> : undefined}
                        >
                            <ThemeSwatch theme={theme} />
                        </ThemeOption>
                    ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                    Los temas Claro y Oscuro usan los colores de marca de tu dominio. El resto son paletas propias.
                </p>
            </div>

            <div className="space-y-4">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        <Moon className="h-4 w-4" /> Correos en modo oscuro
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Los correos HTML traen sus propios colores. Solo afecta cuando el tema activo es oscuro.
                    </p>
                </div>
                <div role="radiogroup" aria-label="Correos en modo oscuro" className="grid gap-3 sm:grid-cols-2">
                    {MAIL_DARK_MODES.map((mode) => {
                        const checked = mailDarkMode === mode.id;
                        return (
                            <label key={mode.id} className="relative block cursor-pointer">
                                <input
                                    type="radio"
                                    name="bloomx-mail-dark"
                                    value={mode.id}
                                    checked={checked}
                                    onChange={() => setMailDarkMode(mode.id)}
                                    className="peer sr-only"
                                />
                                <div
                                    className={cn(
                                        'h-full rounded-xl border bg-card p-3 text-card-foreground transition-all hover:border-input',
                                        'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                                        checked ? 'border-primary ring-2 ring-primary' : 'border-border',
                                    )}
                                >
                                    <div className="text-sm font-medium">{mode.label}</div>
                                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{mode.description}</p>
                                </div>
                            </label>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
