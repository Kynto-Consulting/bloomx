'use client';

/**
 * Kit de extensiones: navegacion (Tabs, Accordion, Wizard). Patrones WAI-ARIA, color solo por tokens.
 * Los contenidos llegan como ReactNode ya renderizado y permanecen montados (no se pierde el estado de los inputs).
 */
import * as React from 'react';
import { KitIcon } from './Icon';
import { useKitStrings } from './strings';
import { FOCUS_RING_CLASS, ROW_HOVER_CLASS, SURFACE_CLASS, buttonClasses, pick } from './tokens';

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const cssId = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '');

// ------------------------------------------------------------------ Tabs
export interface TabItem { label?: string; value?: string; icon?: string; content?: React.ReactNode }
export interface TabsProps {
    tabs?: TabItem[];
    /** Pestana activa (value o label). Controlado. */
    value?: string;
    defaultValue?: string;
    onChange?: (value: string) => void;
    variant?: 'underline' | 'pills';
    /** Mantiene montados los paneles inactivos (por defecto si). */
    keepMounted?: boolean;
}

const TAB_LIST_CLASS = { underline: 'flex gap-1 overflow-x-auto border-b border-border', pills: 'inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1' };
const TAB_CLASS = {
    underline: {
        base: '-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active: 'border-primary text-primary', inactive: 'border-transparent text-muted-foreground hover:text-foreground',
    },
    pills: {
        base: 'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active: 'bg-primary text-primary-foreground', inactive: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
    },
};

export function Tabs(props: TabsProps) {
    const uid = cssId(React.useId());
    const variant = pick(props.variant, ['underline', 'pills'] as const, 'underline');
    const keepMounted = props.keepMounted !== false;
    const tabs = React.useMemo(() => (Array.isArray(props.tabs) ? props.tabs : []).filter(isRecord).map((t, i) => ({
        value: str(t.value, '') || str(t.label, '') || String(i), label: str(t.label, '') || str(t.value, '') || String(i), icon: typeof t.icon === 'string' ? t.icon : undefined, content: t.content as React.ReactNode,
    })), [props.tabs]);

    const [inner, setInner] = React.useState<string | undefined>(props.defaultValue);
    const requested = props.value !== undefined ? props.value : inner;
    const found = tabs.findIndex((t) => t.value === requested);
    const active = found >= 0 ? found : tabs.findIndex((t) => t.label === requested) >= 0 ? tabs.findIndex((t) => t.label === requested) : 0;
    const listRef = React.useRef<HTMLDivElement>(null);

    const activate = (index: number, focus: boolean) => {
        const tab = tabs[index];
        if (!tab) return;
        if (props.value === undefined) setInner(tab.value);
        if (index !== active) props.onChange?.(tab.value);
        if (focus) requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus());
    };
    const onKeyDown = (e: React.KeyboardEvent) => {
        const n = tabs.length;
        if (!n) return;
        let next = -1;
        if (e.key === 'ArrowRight') next = (active + 1) % n;
        else if (e.key === 'ArrowLeft') next = (active - 1 + n) % n;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = n - 1;
        if (next < 0) return;
        e.preventDefault();
        activate(next, true);
    };

    if (tabs.length === 0) return null;
    const cls = TAB_CLASS[variant];
    return (
        <div className="flex w-full flex-col gap-3">
            <div ref={listRef} role="tablist" aria-orientation="horizontal" className={TAB_LIST_CLASS[variant]} onKeyDown={onKeyDown}>
                {tabs.map((tab, i) => {
                    const on = i === active;
                    return (
                        <button
                            key={`${tab.value}-${i}`} type="button" role="tab" id={`${uid}-tab-${i}`} aria-selected={on} aria-controls={`${uid}-panel-${i}`} tabIndex={on ? 0 : -1}
                            onClick={() => activate(i, false)} className={`${cls.base} ${on ? cls.active : cls.inactive} ${FOCUS_RING_CLASS}`}
                        >
                            {tab.icon && <KitIcon name={tab.icon} size="sm" />}{tab.label}
                        </button>
                    );
                })}
            </div>
            {tabs.map((tab, i) => {
                const on = i === active;
                if (!on && !keepMounted) return null;
                return (
                    <div key={`${tab.value}-${i}`} role="tabpanel" id={`${uid}-panel-${i}`} aria-labelledby={`${uid}-tab-${i}`} hidden={!on} tabIndex={0} className={`rounded-md ${FOCUS_RING_CLASS}`}>
                        {tab.content}
                    </div>
                );
            })}
        </div>
    );
}

// ------------------------------------------------------------------ Accordion
export interface AccordionSection { title?: string; content?: React.ReactNode; defaultOpen?: boolean }
export interface AccordionProps { sections?: AccordionSection[]; multiple?: boolean }

export function Accordion(props: AccordionProps) {
    const uid = cssId(React.useId());
    const multiple = props.multiple !== false;
    const sections = React.useMemo(() => (Array.isArray(props.sections) ? props.sections : []).filter(isRecord).map((s, i) => ({
        title: str(s.title, '') || String(i + 1), content: s.content as React.ReactNode, defaultOpen: s.defaultOpen === true,
    })), [props.sections]);
    const [open, setOpen] = React.useState<Set<number>>(() => {
        const initial = sections.map((s, i) => (s.defaultOpen ? i : -1)).filter((i) => i >= 0);
        return new Set(multiple ? initial : initial.slice(0, 1));
    });
    const rootRef = React.useRef<HTMLDivElement>(null);

    const toggle = (i: number) => setOpen((cur) => {
        const next = new Set(multiple ? cur : []);
        if (cur.has(i)) next.delete(i); else next.add(i);
        return next;
    });
    const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
        const n = sections.length;
        let next = -1;
        if (e.key === 'ArrowDown') next = (i + 1) % n;
        else if (e.key === 'ArrowUp') next = (i - 1 + n) % n;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = n - 1;
        if (next < 0) return;
        e.preventDefault();
        rootRef.current?.querySelectorAll<HTMLElement>('[data-accordion-header]')[next]?.focus();
    };

    if (sections.length === 0) return null;
    return (
        <div ref={rootRef} className={`${SURFACE_CLASS} w-full divide-y divide-border overflow-hidden`}>
            {sections.map((s, i) => {
                const isOpen = open.has(i);
                return (
                    <div key={i}>
                        <h3 className="m-0 text-base">
                            <button
                                type="button" id={`${uid}-h-${i}`} data-accordion-header="" aria-expanded={isOpen} aria-controls={`${uid}-r-${i}`}
                                onClick={() => toggle(i)} onKeyDown={(e) => onKeyDown(e, i)}
                                className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-foreground ${ROW_HOVER_CLASS} ${FOCUS_RING_CLASS} focus-visible:ring-inset`}
                            >
                                <span>{s.title}</span>
                                <KitIcon name="ChevronDown" size="sm" className={`text-muted-foreground motion-safe:transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </button>
                        </h3>
                        <div role="region" id={`${uid}-r-${i}`} aria-labelledby={`${uid}-h-${i}`} hidden={!isOpen} className="px-4 pb-4 pt-1 text-sm text-card-foreground">{s.content}</div>
                    </div>
                );
            })}
        </div>
    );
}

// ------------------------------------------------------------------ Wizard
export interface WizardStep { title?: string; description?: string; content?: React.ReactNode }
export interface WizardControls { step: number; total: number; next: () => void; prev: () => void; goTo: (index: number) => void }
export interface WizardProps {
    steps?: WizardStep[];
    /** Paso actual (0 = primero). Controlado. */
    step?: number;
    defaultStep?: number;
    onStepChange?: (step: number) => void;
    nav?: 'auto' | 'manual';
    backLabel?: string;
    nextLabel?: string;
    finishLabel?: string;
    onFinish?: () => void;
}

export const WizardControlsContext = React.createContext<WizardControls | null>(null);
/** Controles del Wizard mas cercano (null fuera de uno). */
export function useWizardControls(): WizardControls | null { return React.useContext(WizardControlsContext); }

export function Wizard(props: WizardProps) {
    const strings = useKitStrings();
    const uid = cssId(React.useId());
    const nav = pick(props.nav, ['auto', 'manual'] as const, 'auto');
    const steps = React.useMemo(() => (Array.isArray(props.steps) ? props.steps : []).filter(isRecord).map((s, i) => ({
        title: str(s.title, '') || `${strings.stepOf} ${i + 1}`, description: str(s.description, ''), content: s.content as React.ReactNode,
    })), [props.steps, strings.stepOf]);
    const total = steps.length;
    const clamp = React.useCallback((n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(total - 1, Math.floor(n))) : 0), [total]);

    const [inner, setInner] = React.useState(() => (typeof props.defaultStep === 'number' ? props.defaultStep : 0));
    const step = clamp(props.step !== undefined ? props.step : inner);
    const stepRef = React.useRef(step);
    stepRef.current = step;
    const onStepChange = props.onStepChange;

    const goTo = React.useCallback((index: number) => {
        const target = clamp(index);
        if (target === stepRef.current) return;
        stepRef.current = target;
        if (props.step === undefined) setInner(target);
        onStepChange?.(target);
    }, [clamp, props.step, onStepChange]);
    const next = React.useCallback(() => goTo(stepRef.current + 1), [goTo]);
    const prev = React.useCallback(() => goTo(stepRef.current - 1), [goTo]);
    const controls = React.useMemo<WizardControls>(() => ({ step, total, next, prev, goTo }), [step, total, next, prev, goTo]);

    if (total === 0) return null;
    const last = step === total - 1;
    const label = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v : fallback);
    const current = steps[step];

    return (
        <WizardControlsContext.Provider value={controls}>
            <div className="flex w-full flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <ol className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label={strings.stepOf}>
                        {steps.map((s, i) => {
                            const done = i < step, now = i === step;
                            return (
                                <li key={i} aria-current={now ? 'step' : undefined} className="flex items-center gap-2 text-sm">
                                    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done || now ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                                        {done ? <KitIcon name="Check" size="xs" /> : i + 1}
                                    </span>
                                    <span className={now ? 'font-medium text-foreground' : 'hidden text-muted-foreground sm:inline'}>{s.title}</span>
                                </li>
                            );
                        })}
                    </ol>
                    <p aria-live="polite" className="text-xs text-muted-foreground">{strings.stepOf} {step + 1} {strings.of} {total}</p>
                    {current.description && <p className="text-sm text-muted-foreground">{current.description}</p>}
                </div>
                <div>
                    {steps.map((s, i) => (
                        <div key={i} id={`${uid}-step-${i}`} hidden={i !== step}>{s.content}</div>
                    ))}
                </div>
                {(nav === 'auto' || step > 0) && (
                    <div className="flex items-center justify-between gap-2">
                        {step > 0
                            ? <button type="button" className={buttonClasses({ variant: 'outline' })} onClick={prev}>{label(props.backLabel, strings.back)}</button>
                            : <span />}
                        {nav === 'auto' && (
                            <button type="button" className={buttonClasses({ variant: 'solid', tone: 'primary' })} onClick={() => { if (last) props.onFinish?.(); else next(); }}>
                                {last ? label(props.finishLabel, strings.finish) : label(props.nextLabel, strings.next)}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </WizardControlsContext.Provider>
    );
}
