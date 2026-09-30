'use client';

import { Check, Languages, Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/ThemeProvider';
import { useI18n } from '@/components/I18nProvider';
import { LOCALES, LOCALE_LABELS, type Locale } from '@/lib/i18n';
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
                        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>
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
    const { t, locale, setLocale } = useI18n();
    // Etiquetas de tema: diccionario si existe la clave, si no el texto del registro (themes.ts).
    const tr = (key: string, fallback: string) => { const v = t(key); return v === key ? fallback : v; };
    const themeLabel = (id: string, fb: string) => tr(`appearance.themes.${id}.label`, fb);
    const themeDesc = (id: string, fb: string) => tr(`appearance.themes.${id}.description`, fb);

    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            <div className="space-y-4">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        <Sun className="h-4 w-4" aria-hidden="true" /> {t('appearance.themeTitle')}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {t('appearance.themeHelp')}{' '}
                        {t('appearance.currently')} <span className="font-medium text-foreground">{preference === 'system' ? t('appearance.systemWithTheme', { theme: themeLabel(resolvedTheme.id, resolvedTheme.label) }) : themeLabel(resolvedTheme.id, resolvedTheme.label)}</span>.
                    </p>
                </div>
                <div role="radiogroup" aria-label={t('appearance.themeGroupLabel')} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <ThemeOption
                        value="system"
                        label={t('appearance.system')}
                        description={t('appearance.systemDescription')}
                        checked={preference === 'system'}
                        onSelect={setPreference}
                        icon={<Monitor className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    >
                        <SystemSwatch />
                    </ThemeOption>
                    {themes.map((theme) => (
                        <ThemeOption
                            key={theme.id}
                            value={theme.id}
                            label={themeLabel(theme.id, theme.label)}
                            description={themeDesc(theme.id, theme.description)}
                            checked={preference === theme.id}
                            onSelect={setPreference}
                            icon={theme.scheme === 'dark' ? <Moon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : undefined}
                        >
                            <ThemeSwatch theme={theme} />
                        </ThemeOption>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground">
                    {t('appearance.brandNote')}
                </p>
            </div>

            <div className="space-y-4">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        <Moon className="h-4 w-4" aria-hidden="true" /> {t('appearance.mailDarkTitle')}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {t('appearance.mailDarkHelp')}
                    </p>
                </div>
                <div role="radiogroup" aria-label={t('appearance.mailDarkTitle')} className="grid gap-3 sm:grid-cols-2">
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
                                    <div className="text-sm font-medium">{tr(`appearance.mailModes.${mode.id}.label`, mode.label)}</div>
                                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{tr(`appearance.mailModes.${mode.id}.description`, mode.description)}</p>
                                </div>
                            </label>
                        );
                    })}
                </div>
            </div>

            <div className="space-y-4">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        <Languages className="h-4 w-4" aria-hidden="true" /> {t('appearance.languageTitle')}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">{t('appearance.languageHelp')}</p>
                </div>
                <div role="radiogroup" aria-label={t('appearance.languageGroupLabel')} className="grid gap-3 sm:grid-cols-2">
                    {LOCALES.map((code: Locale) => (
                        <label key={code} className="relative block cursor-pointer">
                            <input
                                type="radio"
                                name="bloomx-locale"
                                value={code}
                                checked={locale === code}
                                onChange={() => setLocale(code)}
                                className="peer sr-only"
                            />
                            <div
                                className={cn(
                                    'flex h-full items-center justify-between rounded-xl border bg-card p-3 text-card-foreground transition-all hover:border-input',
                                    'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                                    locale === code ? 'border-primary ring-2 ring-primary' : 'border-border',
                                )}
                            >
                                <span lang={code} className="text-sm font-medium">{LOCALE_LABELS[code]}</span>
                                {locale === code && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                            </div>
                        </label>
                    ))}
                </div>
            </div>
        </div>
    );
}
