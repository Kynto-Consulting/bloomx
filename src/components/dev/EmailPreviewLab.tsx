'use client';

import { useMemo, useState } from 'react';
import { getEmailBrand, type EmailLocale } from '@/lib/calendar/email-brand';
import { EMAIL_LINT_RULES, lintDarkMode, lintEmailHtml, simulateInvertedHtml } from '@/lib/calendar/email-lint';
import { SAMPLE_BRANDS, SAMPLE_LOGO, SAMPLE_VARIANTS, buildSampleHtml, sampleBrand } from '@/lib/calendar/email-samples';
import { cn } from '@/lib/utils';

type Mode = 'light' | 'dark' | 'partial' | 'full';
type Device = 'desktop' | 'mobile';

const MODES: ReadonlyArray<{ id: Mode; label: string; help: string }> = [
    { id: 'light', label: 'Claro', help: 'Sin modo oscuro.' },
    { id: 'dark', label: 'Oscuro (paleta propia)', help: 'Clientes que respetan prefers-color-scheme: Apple Mail, iOS Mail, Outlook.com.' },
    { id: 'partial', label: 'Inversión parcial', help: 'Simulación de Gmail Android/iOS y Outlook móvil: solo se invierten los fondos claros.' },
    { id: 'full', label: 'Inversión total', help: 'Simulación de Outlook de escritorio / Windows Mail: se invierte todo.' },
];

const chip = 'inline-flex min-h-8 items-center rounded-md border border-border px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Group<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ id: T; label: string; title?: string }>; onChange: (v: T) => void }) {
    return (
        <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-muted-foreground">{label}</span>
            {options.map((o) => (
                <button
                    key={o.id}
                    type="button"
                    title={o.title}
                    aria-pressed={value === o.id}
                    onClick={() => onChange(o.id)}
                    className={cn(chip, value === o.id ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-accent hover:text-accent-foreground')}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

/**
 * Laboratorio de revision visual (solo desarrollo): TODAS las variantes de los correos de reuniones / citas en un iframe
 * `sandbox` con `srcdoc`, con selector de marca, idioma, esquema (claro, oscuro propio, inversion parcial y total simuladas) y
 * ancho movil/escritorio. Cada variante muestra el resultado del linter de compatibilidad de clientes y de legibilidad oscura.
 */
export interface EmailPreviewLabInitial { brand?: string; color?: string; locale?: string; mode?: string; device?: string; variant?: string; logo?: string }

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

export function EmailPreviewLab({ initial = {} }: { initial?: EmailPreviewLabInitial }) {
    const brandIds = [...SAMPLE_BRANDS.map((b) => b.id), 'custom'];
    const [brandId, setBrandId] = useState<string>(oneOf(initial.brand, brandIds, SAMPLE_BRANDS[0].id));
    const [customColor, setCustomColor] = useState<string>(/^#[0-9a-fA-F]{6}$/.test(initial.color ?? '') ? (initial.color as string) : SAMPLE_BRANDS[0].primary);
    const [logo, setLogo] = useState(initial.logo === '1');
    const [locale, setLocale] = useState<EmailLocale>(oneOf(initial.locale, ['es', 'en'] as const, 'es'));
    const [mode, setMode] = useState<Mode>(oneOf(initial.mode, MODES.map((m) => m.id), 'light'));
    const [device, setDevice] = useState<Device>(oneOf(initial.device, ['desktop', 'mobile'] as const, 'desktop'));
    const [variant, setVariant] = useState<string>(oneOf(initial.variant, ['all', ...SAMPLE_VARIANTS.map((v) => v.id)], 'all'));

    const brand = useMemo(() => {
        if (brandId === 'custom') {
            return getEmailBrand({
                name: 'mail.acme.example', displayName: 'Marca personalizada',
                theme: { palette: { light: { primary: customColor } }, landing: logo ? { logo: { light: SAMPLE_LOGO } } : {} },
            });
        }
        return sampleBrand(SAMPLE_BRANDS.find((b) => b.id === brandId) ?? SAMPLE_BRANDS[0], logo);
    }, [brandId, customColor, logo]);

    const variants = variant === 'all' ? SAMPLE_VARIANTS : SAMPLE_VARIANTS.filter((v) => v.id === variant);
    const rendered = useMemo(
        () => variants.map((v) => {
            const base = buildSampleHtml({ variant: v.id, brand, locale, scheme: mode === 'dark' ? 'dark' : 'light' });
            const shown = mode === 'partial' || mode === 'full' ? simulateInvertedHtml(base, mode) : base;
            const original = buildSampleHtml({ variant: v.id, brand, locale });
            return {
                id: v.id,
                label: v.label,
                html: shown,
                errors: lintEmailHtml(original).filter((i) => i.severity === 'error'),
                dark: lintDarkMode(original),
                bytes: new TextEncoder().encode(original).length,
            };
        }),
        [variants, brand, locale, mode],
    );
    const totalErrors = rendered.reduce((n, r) => n + r.errors.length + r.dark.length, 0);
    const modeInfo = MODES.find((m) => m.id === mode)!;

    return (
        <main className="mx-auto max-w-[1500px] space-y-4 p-4 sm:p-6" data-testid="email-preview-lab">
            <header className="space-y-1">
                <h1 className="text-xl font-semibold text-foreground">Correos de reuniones — revisión visual (desarrollo)</h1>
                <p className="text-sm text-muted-foreground">
                    Mismas plantillas que los envíos reales, con datos ficticios. Herramienta solo de desarrollo: no existe en producción.
                </p>
            </header>

            <section aria-label="Controles" className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        Marca
                        <select
                            value={brandId}
                            onChange={(e) => setBrandId(e.target.value)}
                            data-testid="brand-select"
                            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            {SAMPLE_BRANDS.map((b) => <option key={b.id} value={b.id}>{b.label} ({b.primary})</option>)}
                            <option value="custom">Personalizada…</option>
                        </select>
                    </label>
                    {brandId === 'custom' && (
                        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            Color
                            <input type="color" value={customColor} onChange={(e) => setCustomColor(e.target.value)} className="h-8 w-12 rounded border border-input bg-background" />
                            <span className="font-mono">{customColor}</span>
                        </label>
                    )}
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <input type="checkbox" checked={logo} onChange={(e) => setLogo(e.target.checked)} data-testid="logo-toggle" />
                        Logo https (no carga sin red)
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        Variante
                        <select
                            value={variant}
                            onChange={(e) => setVariant(e.target.value)}
                            data-testid="variant-select"
                            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <option value="all">Todas ({SAMPLE_VARIANTS.length})</option>
                            {SAMPLE_VARIANTS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                        </select>
                    </label>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                    <Group<EmailLocale> label="Idioma" value={locale} onChange={setLocale} options={[{ id: 'es', label: 'Español' }, { id: 'en', label: 'English' }]} />
                    <Group<Mode> label="Esquema" value={mode} onChange={setMode} options={MODES.map((m) => ({ id: m.id, label: m.label, title: m.help }))} />
                    <Group<Device> label="Ancho" value={device} onChange={setDevice} options={[{ id: 'desktop', label: 'Escritorio' }, { id: 'mobile', label: 'Móvil (375)' }]} />
                </div>
                <p className="text-xs text-muted-foreground">{modeInfo.help}</p>
                <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="brand-facts">
                    <li>Marca: <span className="font-mono text-foreground">{brand.color}</span></li>
                    <li>Texto sobre la marca: <span className="font-mono text-foreground">{brand.onColor}</span></li>
                    <li>Marca como texto/enlace: <span className="font-mono text-foreground">{brand.linkColor}</span>{brand.linkColor !== brand.color ? ' (corregida a AA)' : ''}</li>
                    <li className={cn('font-medium', totalErrors ? 'text-destructive' : 'text-success')} data-testid="lint-total">
                        {totalErrors ? `${totalErrors} hallazgos de compatibilidad / legibilidad` : 'Sin hallazgos de compatibilidad ni de legibilidad oscura'}
                    </li>
                </ul>
            </section>

            <div className={cn('grid gap-4', variant === 'all' ? 'grid-cols-[repeat(auto-fill,minmax(min(100%,var(--frame-w)),1fr))]' : 'grid-cols-1')} style={{ ['--frame-w' as string]: device === 'mobile' ? '395px' : '700px' }}>
                {rendered.map((r) => (
                    <figure key={r.id} className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-3" data-testid={`variant-${r.id}`}>
                        <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-medium text-foreground">{r.label}</span>
                            <span className="flex items-center gap-2 text-muted-foreground">
                                <span>{(r.bytes / 1024).toFixed(1)} KB</span>
                                <span className={cn('rounded px-1.5 py-0.5 font-medium', r.errors.length ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-foreground')}>
                                    {r.errors.length ? `${r.errors.length} errores de cliente` : 'Clientes OK'}
                                </span>
                                <span className={cn('rounded px-1.5 py-0.5 font-medium', r.dark.length ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-foreground')}>
                                    {r.dark.length ? `${r.dark.length} legibilidad oscura` : 'Oscuro OK'}
                                </span>
                            </span>
                        </figcaption>
                        <div className="overflow-x-auto rounded-lg bg-muted p-2">
                            <iframe
                                title={`${r.label} (${locale}, ${mode})`}
                                sandbox=""
                                srcDoc={r.html}
                                referrerPolicy="no-referrer"
                                data-testid="lab-frame"
                                className="mx-auto block h-[760px] max-w-full rounded-md border border-border bg-card"
                                style={{ width: device === 'mobile' ? 375 : 680 }}
                            />
                        </div>
                        {(r.errors.length > 0 || r.dark.length > 0) && (
                            <ul className="space-y-0.5 text-xs text-destructive">
                                {r.errors.map((i, n) => <li key={`e${n}`}>{i.rule}: {i.message}</li>)}
                                {r.dark.map((f, n) => <li key={`d${n}`}>{f.mode}/{f.role}: «{f.text}» {f.ratio.toFixed(2)}:1 &lt; {f.min}</li>)}
                            </ul>
                        )}
                    </figure>
                ))}
            </div>

            <details className="rounded-xl border border-border bg-card p-4 text-sm">
                <summary className="cursor-pointer font-medium text-foreground">Reglas de compatibilidad de clientes ({EMAIL_LINT_RULES.length})</summary>
                <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                    {EMAIL_LINT_RULES.map((rule) => (
                        <li key={rule.id}>
                            <span className="font-mono text-foreground">{rule.id}</span> · {rule.severity} · {rule.clients.join(', ')} · caniemail: {rule.caniemail.join(', ')} — {rule.summary}
                        </li>
                    ))}
                </ul>
            </details>
        </main>
    );
}
