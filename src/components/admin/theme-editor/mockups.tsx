'use client';

/**
 * Maquetas de la app real para la vista previa del tema. Solo usan utilidades Tailwind de TOKENS (bg-sidebar,
 * bg-row-hover, text-muted-foreground, ...): las mismas que la app. No hay colores ni estilos inventados.
 * Las variables CSS del tema se aplican al contenedor (ThemeLivePreview), asi que aqui todo es "hijo" del tema.
 */
import { AlertTriangle, Bold, CheckCircle2, ChevronLeft, ChevronRight, File, Inbox, Info, Italic, Link2, Paperclip, Search, Send, Star, Tag, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type T = (key: string, params?: Record<string, string>) => string;
interface MockProps { t: T; name: string; logo?: string; compact?: boolean }

const p = (k: string) => `themeEditor.preview.${k}`;

function BrandRow({ name, logo }: { name: string; logo?: string }) {
    return (
        <div className="flex items-center gap-2 px-3 py-3 font-semibold">
            {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" className="h-6 w-6 rounded object-contain" referrerPolicy="no-referrer" />
            ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded bg-primary text-xs text-primary-foreground" aria-hidden="true">{(name || 'B').charAt(0).toUpperCase()}</span>
            )}
            <span className="truncate">{name || 'BloomX'}</span>
        </div>
    );
}

function Row({ from, subject, snippet, time, variant, chip }: {
    from: string; subject: string; snippet: string; time: string; variant: 'unread' | 'read' | 'selected' | 'hover'; chip?: string;
}) {
    return (
        <li
            data-row={variant}
            className={cn(
                'flex items-start gap-3 border-b border-border px-3 py-2.5',
                variant === 'unread' && 'bg-unread text-unread-foreground',
                variant === 'read' && 'bg-background text-foreground',
                variant === 'selected' && 'bg-row-selected text-row-selected-foreground',
                variant === 'hover' && 'bg-row-hover text-foreground',
            )}
        >
            <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', variant === 'unread' ? 'bg-primary' : 'bg-transparent')} aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                    <span className={cn('truncate text-sm', variant === 'unread' && 'font-semibold')}>{from}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{time}</span>
                </div>
                <div className={cn('truncate text-sm', variant === 'unread' && 'font-semibold')}>{subject}</div>
                <div className="flex items-center gap-2">
                    <span className="truncate text-xs text-muted-foreground">{snippet}</span>
                    {chip && <span className="shrink-0 rounded-full bg-chip px-2 py-0.5 text-[10px] font-medium text-chip-foreground">{chip}</span>}
                </div>
            </div>
        </li>
    );
}

export function InboxMock({ t, name, logo, compact }: MockProps) {
    const nav = [
        { icon: Inbox, label: t(p('inbox')), count: '3', active: true },
        { icon: Star, label: t(p('starred')) },
        { icon: Send, label: t(p('sent')) },
        { icon: File, label: t(p('drafts')) },
    ];
    return (
        <div className="flex h-full min-h-0 bg-background text-foreground">
            {!compact && (
                <aside className="flex w-48 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground" aria-label={t(p('sidebar'))}>
                    <BrandRow name={name} logo={logo} />
                    <div className="px-3 pb-3">
                        <button type="button" tabIndex={-1} className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">{t(p('compose'))}</button>
                    </div>
                    <nav className="space-y-0.5 px-2 text-sm">
                        {nav.map(({ icon: Icon, label, count, active }) => (
                            <div key={label} className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5', active ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/60')}>
                                <Icon className="h-4 w-4" aria-hidden="true" /><span className="flex-1">{label}</span>{count && <span className="text-xs">{count}</span>}
                            </div>
                        ))}
                    </nav>
                    <div className="mt-4 px-4 text-[11px] font-medium uppercase tracking-wide opacity-70">{t(p('labels'))}</div>
                    <div className="mt-1 space-y-0.5 px-2 text-sm">
                        {['Finanzas', 'Clientes'].map((l) => <div key={l} className="flex items-center gap-2 rounded-lg px-2 py-1.5"><Tag className="h-3.5 w-3.5" aria-hidden="true" />{l}</div>)}
                    </div>
                </aside>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex items-center gap-2 border-b border-border bg-header px-3 py-2 text-header-foreground">
                    {compact && <BrandRow name={name} logo={logo} />}
                    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-muted-foreground">
                        <Search className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{t(p('search'))}</span>
                    </div>
                </header>
                <div className="flex min-h-0 flex-1">
                    <ul className={cn('min-w-0 overflow-hidden', compact ? 'flex-1' : 'w-[46%] shrink-0 border-r border-border')} aria-label={t(p('list'))}>
                        <Row variant="unread" from="Laura Méndez" subject={t(p('mail1Subject'))} snippet={t(p('mail1Snippet'))} time="09:41" chip={t(p('chip1'))} />
                        <Row variant="selected" from="Equipo Finanzas" subject={t(p('mail2Subject'))} snippet={t(p('mail2Snippet'))} time="08:15" />
                        <Row variant="hover" from="Carlos Ruiz" subject={t(p('mail3Subject'))} snippet={t(p('mail3Snippet'))} time="Ayer" />
                        <Row variant="read" from="Soporte" subject={t(p('mail4Subject'))} snippet={t(p('mail4Snippet'))} time="Lun" chip={t(p('chip2'))} />
                        <Row variant="read" from="Ana Torres" subject={t(p('mail5Subject'))} snippet={t(p('mail5Snippet'))} time="Dom" />
                        <li className="flex flex-wrap gap-3 px-3 py-2 text-[11px] text-muted-foreground" aria-hidden="true">
                            <span>{t(p('legendUnread'))}</span><span>{t(p('legendSelected'))}</span><span>{t(p('legendHover'))}</span>
                        </li>
                    </ul>
                    {!compact && <ReaderMock t={t} />}
                </div>
            </div>
        </div>
    );
}

export function ReaderMock({ t }: { t: T }) {
    return (
        <article className="min-w-0 flex-1 overflow-hidden bg-card p-4 text-card-foreground" aria-label={t(p('reader'))}>
            <h3 className="text-base font-semibold">{t(p('mail2Subject'))}</h3>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground" aria-hidden="true">EF</span>
                <span>Equipo Finanzas · 08:15</span>
            </div>
            <p className="mt-3 text-sm">{t(p('readerBody'))} <a href="#" tabIndex={-1} className="text-link underline hover:text-link-hover">{t(p('link'))}</a>.</p>
            <blockquote className="mt-3 border-l-2 border-border pl-3 text-sm text-muted-foreground">{t(p('quote'))}</blockquote>
            <pre className="mt-3 overflow-hidden rounded-md bg-code p-2 font-mono text-xs text-code-foreground">SELECT total FROM facturas;</pre>
            <p className="mt-3 text-sm">
                <span className="bg-selection text-selection-foreground px-1">{t(p('selected'))}</span>
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" tabIndex={-1} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">{t(p('reply'))}</button>
                <button type="button" tabIndex={-1} className="rounded-lg bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground">{t(p('forward'))}</button>
                <button type="button" tabIndex={-1} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"><Paperclip className="h-3.5 w-3.5" aria-hidden="true" />2</button>
            </div>
        </article>
    );
}

export function ComposeMock({ t }: MockProps) {
    return (
        <div className="flex h-full items-end justify-center bg-background p-4 text-foreground">
            <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg" role="group" aria-label={t(p('composeWindow'))}>
                <div className="flex items-center justify-between bg-muted px-3 py-2 text-sm font-medium text-foreground"><span>{t(p('newMessage'))}</span><span className="text-muted-foreground" aria-hidden="true">– ×</span></div>
                <div className="space-y-0 text-sm">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2"><span className="w-12 text-muted-foreground">{t(p('to'))}</span><span className="rounded-full bg-chip px-2 py-0.5 text-xs text-chip-foreground">laura@acme.com</span></div>
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2"><span className="w-12 text-muted-foreground">{t(p('subject'))}</span><span>{t(p('mail1Subject'))}</span></div>
                    <div className="flex items-center gap-1 border-b border-border px-2 py-1">
                        {[Bold, Italic, Link2].map((Icon, i) => <span key={i} className={cn('rounded p-1.5 text-muted-foreground', i === 0 && 'bg-accent text-accent-foreground')}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>)}
                    </div>
                    <div className="min-h-24 px-3 py-3">{t(p('composeBody'))}<span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-foreground align-middle" aria-hidden="true" /></div>
                </div>
                <div className="flex items-center justify-between border-t border-border px-3 py-2">
                    <button type="button" tabIndex={-1} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground ring-2 ring-ring ring-offset-2 ring-offset-card"><Send className="h-3.5 w-3.5" aria-hidden="true" />{t(p('send'))}</button>
                    <span className="text-xs text-muted-foreground">{t(p('draftSaved'))}</span>
                </div>
            </div>
        </div>
    );
}

export function DialogMock({ t }: MockProps) {
    return (
        <div className="relative flex h-full items-center justify-center overflow-hidden bg-background text-foreground">
            <div className="absolute inset-0 p-4 text-sm" aria-hidden="true"><div className="h-3 w-1/2 rounded bg-muted" /><div className="mt-2 h-3 w-1/3 rounded bg-muted" /><div className="mt-2 h-3 w-2/3 rounded bg-muted" /></div>
            <div className="absolute inset-0 bg-overlay" aria-hidden="true" />
            <div role="group" aria-label={t(p('dialog'))} className="relative w-[min(22rem,90%)] rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-xl">
                <h3 className="text-base font-semibold">{t(p('dialogTitle'))}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{t(p('dialogBody'))}</p>
                <div className="mt-4 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-2 ring-ring">acme.com</div>
                <div className="mt-5 flex justify-end gap-2">
                    <button type="button" tabIndex={-1} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground">{t(p('cancel'))}</button>
                    <button type="button" tabIndex={-1} className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground">{t(p('delete'))}</button>
                </div>
            </div>
        </div>
    );
}

const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export function UiKitMock({ t }: MockProps) {
    const alerts = [
        { k: 'success', icon: CheckCircle2, cls: 'border-success/30 bg-success/10 text-success', solid: 'bg-success text-success-foreground' },
        { k: 'warning', icon: AlertTriangle, cls: 'border-warning/30 bg-warning/10 text-warning', solid: 'bg-warning text-warning-foreground' },
        { k: 'error', icon: XCircle, cls: 'border-destructive/30 bg-destructive/10 text-destructive', solid: 'bg-destructive text-destructive-foreground' },
        { k: 'info', icon: Info, cls: 'border-info/30 bg-info/10 text-info', solid: 'bg-info text-info-foreground' },
    ] as const;
    return (
        <div className="grid h-full grid-cols-1 gap-4 overflow-hidden bg-background p-4 text-foreground sm:grid-cols-2">
            <div className="space-y-3">
                <h3 className="text-sm font-semibold">{t(p('buttons'))}</h3>
                <div className="flex flex-wrap gap-2">
                    <button type="button" tabIndex={-1} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">{t(p('primary'))}</button>
                    <button type="button" tabIndex={-1} className="rounded-lg bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground">{t(p('secondary'))}</button>
                    <button type="button" tabIndex={-1} className="rounded-lg bg-brand-accent px-3 py-1.5 text-sm font-medium text-brand-accent-foreground">{t(p('accent'))}</button>
                    <button type="button" tabIndex={-1} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground">{t(p('outline'))}</button>
                    <button type="button" tabIndex={-1} className="rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-foreground">{t(p('ghost'))}</button>
                </div>
                <h3 className="text-sm font-semibold">{t(p('states'))}</h3>
                <div className="space-y-2">
                    {alerts.map(({ k, icon: Icon, cls, solid }) => (
                        <div key={k} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', cls)}>
                            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="flex-1">{t(p(`state.${k}`))}</span>
                            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', solid)}>{t(p(`state.${k}`))}</span>
                        </div>
                    ))}
                </div>
                <h3 className="text-sm font-semibold">{t(p('chips'))}</h3>
                <div className="flex flex-wrap gap-2">
                    {['Finanzas', 'Clientes', 'Urgente'].map((c) => <span key={c} className="rounded-full bg-chip px-2.5 py-0.5 text-xs font-medium text-chip-foreground">{c}</span>)}
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{t(p('muted'))}</span>
                </div>
            </div>
            <div className="space-y-3">
                <h3 className="text-sm font-semibold">{t(p('form'))}</h3>
                <div className="space-y-2 rounded-xl border border-border bg-card p-3 text-card-foreground">
                    <div className="text-xs font-medium">{t(p('email'))}</div>
                    <div className="rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-2 ring-ring">ana@acme.com</div>
                    <div className="text-xs font-medium">{t(p('password'))}</div>
                    <div className="rounded-md border border-destructive bg-background px-3 py-1.5 text-sm text-muted-foreground">••••</div>
                    <p className="text-xs text-destructive">{t(p('fieldError'))}</p>
                    <label className="flex items-center gap-2 text-xs"><span className="flex h-4 w-4 items-center justify-center rounded border border-input bg-primary text-[10px] text-primary-foreground" aria-hidden="true">✓</span>{t(p('remember'))}</label>
                </div>
                <h3 className="text-sm font-semibold">{t(p('calendar'))}</h3>
                <div className="rounded-xl border border-border bg-card p-3 text-card-foreground">
                    <div className="mb-2 flex items-center justify-between text-sm font-medium"><ChevronLeft className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t(p('month'))}<ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></div>
                    <div className="grid grid-cols-7 gap-1 text-center text-xs">
                        {DAYS.map((d) => <span key={d} className="text-muted-foreground">{d}</span>)}
                        {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => (
                            <span key={n} className={cn('relative rounded-md py-1', n === 9 ? 'bg-primary font-semibold text-primary-foreground' : n === 12 ? 'bg-accent text-accent-foreground' : 'text-foreground')}>
                                {n}{(n === 5 || n === 12) && <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand-accent" aria-hidden="true" />}
                            </span>
                        ))}
                    </div>
                    <div className="mt-2 rounded-md bg-brand-accent px-2 py-1 text-xs font-medium text-brand-accent-foreground">{t(p('event'))}</div>
                </div>
            </div>
        </div>
    );
}
