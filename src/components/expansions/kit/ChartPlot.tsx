'use client';

/**
 * Kit: CHART (line, bar, area, pie, donut) en SVG propio, sin librerias. Varias series, leyenda con alternancia, rejilla, formato de valores
 * (number / compact / percent) y tooltips accesibles:
 *   - raton: el tooltip sigue a la columna bajo el puntero; teclado: el area del grafico es focusable y las flechas recorren los puntos;
 *   - lectores de pantalla: cada cambio de punto se anuncia (aria-live) y existe una tabla oculta con TODOS los datos.
 * El color sale siempre de los tokens del tema (TONE_STROKE / TONE_FILL / TONE_BG): nada de colores propios. Los limites (120 puntos, 8 series,
 * 60 sectores) acotan el coste de un grafico de terceros.
 */
import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { useKitStrings } from './strings';
import { Skeleton } from './Feedback';
import { KitIcon } from './Icon';
import { CHART_SEQUENCE, FOCUS_RING_CLASS, POPOVER_CLASS, TONE_BG, TONE_FILL, TONE_STROKE, pick, toTone, type Tone } from './tokens';

export const CHART_MAX_POINTS = 120;
export const CHART_MAX_SERIES = 8;
export const CHART_MAX_SLICES = 60;
const PIE_VISIBLE_SLICES = 12;
const KINDS = ['line', 'bar', 'area', 'pie', 'donut'] as const;
export type ChartKind = (typeof KINDS)[number];
const FORMATS = ['number', 'compact', 'percent'] as const;
export type ChartValueFormat = (typeof FORMATS)[number];
const HEIGHTS = { sm: 180, md: 260, lg: 340 } as const;

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

const TXT = {
    es: { chart: 'Grafico', series: 'series', points: 'puntos', others: 'Otros', hide: 'Ocultar serie', show: 'Mostrar serie', legend: 'Leyenda', data: 'Datos del grafico', hint: 'Usa las flechas izquierda y derecha para recorrer los puntos', total: 'Total', of: 'de', slices: 'sectores' },
    en: { chart: 'Chart', series: 'series', points: 'points', others: 'Other', hide: 'Hide series', show: 'Show series', legend: 'Legend', data: 'Chart data', hint: 'Use the left and right arrow keys to move between points', total: 'Total', of: 'of', slices: 'slices' },
};
function useTxt() { return useI18n().locale === 'en' ? TXT.en : TXT.es; }

// ------------------------------------------------------------------ matematicas puras (exportadas para los tests)
/** Escala "bonita": max redondeado hacia arriba y paso de las marcas del eje (>= 0). */
export function niceScale(min: number, max: number, ticks = 4): { min: number; max: number; step: number } {
    const lo = Math.min(0, min);
    let hi = Math.max(0, max);
    if (hi === lo) hi = lo + 1;
    const raw = (hi - lo) / Math.max(1, ticks);
    const pow = 10 ** Math.floor(Math.log10(raw));
    const frac = raw / pow;
    const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10) * pow;
    return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}

export function formatChartValue(value: number, format: ChartValueFormat, intlLocale: string): string {
    try {
        if (format === 'compact') return new Intl.NumberFormat(intlLocale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
        if (format === 'percent') return `${new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1 }).format(value)}%`;
        return new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 2 }).format(value);
    } catch {
        return String(Math.round(value * 100) / 100);
    }
}

interface CleanSeries { name: string; tone: Tone; values: Array<number | null> }
export function cleanSeries(series: unknown, count: number): CleanSeries[] {
    if (!Array.isArray(series)) return [];
    const out: CleanSeries[] = [];
    for (const raw of series) {
        if (out.length >= CHART_MAX_SERIES) break;
        if (!isRecord(raw)) continue;
        const data = Array.isArray(raw.data) ? raw.data : [];
        const values = Array.from({ length: count }, (_, i) => num(data[i]));
        out.push({ name: str(raw.label) || `#${out.length + 1}`, tone: toTone(raw.tone, CHART_SEQUENCE[out.length % CHART_SEQUENCE.length]), values });
    }
    return out;
}

interface Slice { label: string; value: number; tone: Tone }
export function cleanSlices(data: unknown, othersLabel: string): Slice[] {
    if (!Array.isArray(data)) return [];
    const list: Slice[] = [];
    for (const raw of data) {
        if (list.length >= CHART_MAX_SLICES) break;
        if (!isRecord(raw)) continue;
        const value = num(raw.value);
        if (value === null || value < 0) continue;
        list.push({ label: str(raw.label), value, tone: toTone(raw.tone, CHART_SEQUENCE[list.length % CHART_SEQUENCE.length]) });
    }
    if (list.length <= PIE_VISIBLE_SLICES) return list;
    const head = list.slice(0, PIE_VISIBLE_SLICES - 1);
    const rest = list.slice(PIE_VISIBLE_SLICES - 1).reduce((s, p) => s + p.value, 0);
    return [...head, { label: othersLabel, value: rest, tone: 'neutral' }];
}

/** Trazo de una serie con huecos (null): una subruta por tramo continuo. */
export function linePath(points: Array<{ x: number; y: number | null }>): string {
    let d = '';
    let pen = false;
    for (const p of points) {
        if (p.y === null) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
        pen = true;
    }
    return d.trim();
}

/** Area entre dos bordes (superior e inferior) por tramos continuos. */
export function areaPath(top: Array<{ x: number; y: number | null }>, bottom: Array<{ x: number; y: number }>): string {
    let d = '';
    let run: number[] = [];
    const flush = () => {
        if (run.length === 0) return;
        const first = run[0];
        d += `M${top[first].x.toFixed(2)} ${(top[first].y as number).toFixed(2)} `;
        for (const i of run.slice(1)) d += `L${top[i].x.toFixed(2)} ${(top[i].y as number).toFixed(2)} `;
        for (const i of [...run].reverse()) d += `L${bottom[i].x.toFixed(2)} ${bottom[i].y.toFixed(2)} `;
        d += 'Z ';
        run = [];
    };
    top.forEach((p, i) => { if (p.y === null) flush(); else run.push(i); });
    flush();
    return d.trim();
}

function polar(cx: number, cy: number, r: number, angle: number) {
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
}
/** Sector de pie/donut entre dos angulos (radianes, desde las 12 en punto). */
export function slicePath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
    const start = a0 - Math.PI / 2;
    const end = Math.min(a1, a0 + Math.PI * 2 - 0.0001) - Math.PI / 2;
    const large = end - start > Math.PI ? 1 : 0;
    const [x0, y0] = polar(cx, cy, rOuter, start);
    const [x1, y1] = polar(cx, cy, rOuter, end);
    if (rInner <= 0) return `M${cx} ${cy} L${x0.toFixed(2)} ${y0.toFixed(2)} A${rOuter} ${rOuter} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
    const [x2, y2] = polar(cx, cy, rInner, end);
    const [x3, y3] = polar(cx, cy, rInner, start);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${rOuter} ${rOuter} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)} A${rInner} ${rInner} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
}

// ------------------------------------------------------------------ componente
export interface ChartProps {
    kind?: ChartKind;
    labels?: unknown[];
    series?: unknown[];
    data?: unknown[];
    stacked?: boolean;
    showLegend?: boolean;
    showGrid?: boolean;
    valueFormat?: ChartValueFormat;
    unit?: string;
    height?: 'sm' | 'md' | 'lg';
    centerLabel?: string;
    title?: string;
    description?: string;
    emptyText?: string;
    loading?: boolean;
    error?: string;
}

interface TipRow { name: string; tone: Tone; text: string }
interface Tip { heading: string; rows: TipRow[]; leftPct: number; topPct: number }

export function Chart(props: ChartProps) {
    const tx = useTxt();
    const strings = useKitStrings();
    const { intlLocale } = useI18n();
    const kind = pick<ChartKind>(props.kind, KINDS, 'line');
    const format = pick<ChartValueFormat>(props.valueFormat, FORMATS, 'number');
    const unit = str(props.unit);
    const title = str(props.title);
    const fmt = React.useCallback((n: number) => formatChartValue(n, format, intlLocale), [format, intlLocale]);
    const withUnit = (n: number) => `${fmt(n)}${unit ? ` ${unit}` : ''}`;

    if (props.loading === true) return <div aria-busy="true"><span className="sr-only" role="status">{strings.loading}</span><Skeleton variant="rect" size="lg" /></div>;
    if (str(props.error)) {
        return <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-card p-3 text-sm text-card-foreground"><KitIcon name="CircleAlert" size="md" className="text-destructive" />{str(props.error)}</div>;
    }
    const empty = <p className="text-sm text-muted-foreground">{str(props.emptyText) || strings.empty}</p>;

    if (kind === 'pie' || kind === 'donut') {
        return <RadialChart kind={kind} data={props.data} centerLabel={str(props.centerLabel)} title={title} description={str(props.description)} showLegend={props.showLegend !== false} fmt={fmt} unit={unit} empty={empty} tx={tx} />;
    }
    return (
        <CartesianChart
            kind={kind} labels={props.labels} series={props.series} stacked={props.stacked === true} showLegend={props.showLegend !== false} showGrid={props.showGrid !== false}
            fmt={fmt} withUnit={withUnit} height={HEIGHTS[pick(props.height, ['sm', 'md', 'lg'] as const, 'md')]} title={title} description={str(props.description)} empty={empty} tx={tx}
        />
    );
}

type Tx = typeof TXT.es;

function Legend({ items, hidden, onToggle, tx, label }: { items: Array<{ name: string; tone: Tone; extra?: string }>; hidden?: Set<number>; onToggle?: (i: number) => void; tx: Tx; label: string }) {
    return (
        <ul aria-label={label || tx.legend} className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-sm text-foreground">
            {items.map((item, i) => {
                const off = hidden?.has(i) === true;
                const inner = (
                    <>
                        <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 rounded-full ${off ? 'bg-muted' : TONE_BG[item.tone]}`} />
                        <span className={`min-w-0 truncate ${off ? 'text-muted-foreground line-through' : ''}`}>{item.name}</span>
                        {item.extra && <span className="text-muted-foreground">{item.extra}</span>}
                    </>
                );
                return (
                    <li key={i} className="flex min-w-0 items-center">
                        {onToggle
                            ? <button type="button" aria-pressed={!off} aria-label={`${off ? tx.show : tx.hide}: ${item.name}`} onClick={() => onToggle(i)} className={`flex min-w-0 items-center gap-2 rounded-sm ${FOCUS_RING_CLASS}`}>{inner}</button>
                            : <span className="flex min-w-0 items-center gap-2">{inner}</span>}
                    </li>
                );
            })}
        </ul>
    );
}

function TooltipBox({ tip }: { tip: Tip | null }) {
    if (!tip) return null;
    // Se centra sobre el punto, pero pegado al borde para no salirse del grafico.
    const edge = tip.leftPct < 18 ? 'translate-x-0' : tip.leftPct > 82 ? '-translate-x-full' : '-translate-x-1/2';
    return (
        <div
            aria-hidden="true"
            data-chart-tooltip=""
            style={{ left: `${tip.leftPct}%`, top: `${tip.topPct}%` }}
            className={`pointer-events-none absolute z-10 min-w-24 max-w-56 ${edge} ${POPOVER_CLASS} px-3 py-2 text-xs`}
        >
            {tip.heading && <p className="m-0 mb-1 font-semibold text-foreground">{tip.heading}</p>}
            {tip.rows.map((row, i) => (
                <p key={i} className="m-0 flex items-center gap-2 text-foreground">
                    <span className={`inline-block size-2 shrink-0 rounded-full ${TONE_BG[row.tone]}`} />
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    <span className="font-medium tabular-nums">{row.text}</span>
                </p>
            ))}
        </div>
    );
}

// ------------------------------------------------------------------ line / bar / area
interface CartesianProps {
    kind: ChartKind; labels: unknown[] | undefined; series: unknown[] | undefined; stacked: boolean; showLegend: boolean; showGrid: boolean;
    fmt: (n: number) => string; withUnit: (n: number) => string; height: number; title: string; description: string; empty: React.ReactNode; tx: Tx;
}

function CartesianChart({ kind, labels, series, stacked, showLegend, showGrid, fmt, withUnit, height, title, description, empty, tx }: CartesianProps) {
    const labelList = (Array.isArray(labels) ? labels : []).slice(0, CHART_MAX_POINTS).map(str);
    const longest = Array.isArray(series) ? Math.max(0, ...series.map((s) => (isRecord(s) && Array.isArray(s.data) ? s.data.length : 0))) : 0;
    const count = Math.min(CHART_MAX_POINTS, Math.max(labelList.length, longest));
    const all = React.useMemo(() => cleanSeries(series, count), [series, count]);
    const [hidden, setHidden] = React.useState<Set<number>>(new Set());
    const [active, setActive] = React.useState<number | null>(null);
    const [focused, setFocused] = React.useState(false);
    const plotRef = React.useRef<SVGRectElement>(null);
    const uid = React.useId();

    if (count === 0 || all.length === 0) return <>{empty}</>;

    const shown = all.map((s, i) => ({ ...s, index: i })).filter((s) => !hidden.has(s.index));
    const W = 640;
    const H = height;
    const m = { l: 48, r: 14, t: 14, b: 30 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const stackable = stacked && (kind === 'bar' || kind === 'area');

    // Alturas acumuladas (apilado) o valores directos.
    const pos = (i: number) => (kind === 'bar' ? m.l + ((i + 0.5) * pw) / count : m.l + (count === 1 ? pw / 2 : (i * pw) / (count - 1)));
    const cumulative: number[][] = [];
    if (stackable) {
        const run = Array.from({ length: count }, () => 0);
        for (const s of shown) {
            cumulative.push(s.values.map((v, i) => { run[i] += Math.max(0, v ?? 0); return run[i]; }));
        }
    }
    const allVals = stackable ? cumulative.flat() : shown.flatMap((s) => s.values).filter((v): v is number => v !== null);
    const scale = niceScale(Math.min(0, ...allVals, 0), Math.max(0, ...allVals, 0));
    const y = (v: number) => m.t + ph - ((v - scale.min) / (scale.max - scale.min || 1)) * ph;
    const ticks: number[] = [];
    for (let t = scale.min; t <= scale.max + scale.step / 2; t += scale.step) ticks.push(Math.round(t * 1e6) / 1e6);
    const labelEvery = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(pw / 56))));
    const baseY = y(0);

    const activeIndex = active !== null && active < count ? active : null;
    const tipFor = (i: number): Tip => ({
        heading: labelList[i] ?? '',
        rows: shown.map((s) => ({ name: s.name, tone: s.tone, text: s.values[i] === null ? '—' : withUnit(s.values[i] as number) })),
        leftPct: (pos(i) / W) * 100,
        topPct: 4,
    });
    const announce = (i: number) => `${labelList[i] ?? i + 1}: ${shown.map((s) => `${s.name} ${s.values[i] === null ? '—' : withUnit(s.values[i] as number)}`).join(', ')}`;

    const move = (to: number) => setActive(Math.max(0, Math.min(count - 1, to)));
    const onKeyDown = (e: React.KeyboardEvent) => {
        const cur = activeIndex ?? -1;
        if (e.key === 'ArrowRight') { e.preventDefault(); move(cur + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); move(cur < 0 ? count - 1 : cur - 1); }
        else if (e.key === 'Home') { e.preventDefault(); move(0); }
        else if (e.key === 'End') { e.preventDefault(); move(count - 1); }
        else if (e.key === 'Escape') { setActive(null); }
    };
    const onMove = (e: React.MouseEvent<SVGRectElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        const frac = (e.clientX - rect.left) / rect.width;
        move(kind === 'bar' ? Math.floor(frac * count) : Math.round(frac * (count - 1)));
    };

    const summary = `${title || tx.chart}. ${shown.length} ${tx.series}, ${count} ${tx.points}`;
    const barSlot = pw / count;
    const group = stackable ? 1 : Math.max(1, shown.length);
    const barW = Math.max(2, (barSlot * 0.72) / group);

    return (
        <figure className="m-0 flex w-full min-w-0 flex-col gap-2">
            {title && <figcaption className="text-sm font-medium text-foreground">{title}</figcaption>}
            {description && <p className="m-0 sr-only">{description}</p>}
            <div className="relative w-full">
                <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="block h-auto w-full max-w-full" preserveAspectRatio="xMidYMid meet">
                    <title>{summary}</title>
                    {ticks.map((t) => (
                        <g key={t}>
                            {showGrid && <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} strokeDasharray={t === 0 ? undefined : '3 3'} />}
                            <text x={m.l - 6} y={y(t)} textAnchor="end" dominantBaseline="central" className="fill-muted-foreground text-[10px]">{fmt(t)}</text>
                        </g>
                    ))}
                    <line x1={m.l} x2={W - m.r} y1={baseY} y2={baseY} className="stroke-border" strokeWidth={1} />
                    {Array.from({ length: count }, (_, i) => (i % labelEvery === 0 ? (
                        <text key={i} x={pos(i)} y={H - 10} textAnchor="middle" className="fill-muted-foreground text-[10px]">{truncate(labelList[i] ?? String(i + 1), 10)}</text>
                    ) : null))}

                    {kind === 'bar' && shown.map((s, si) => s.values.map((v, i) => {
                        if (v === null) return null;
                        const lo = stackable ? (si > 0 ? cumulative[si - 1][i] : 0) : Math.min(0, v);
                        const hi = stackable ? cumulative[si][i] : Math.max(0, v);
                        const x0 = m.l + i * barSlot + barSlot * 0.14 + (stackable ? 0 : si * barW);
                        return <rect key={`${si}-${i}`} x={x0} y={y(hi)} width={stackable ? barSlot * 0.72 : barW} height={Math.max(0, y(lo) - y(hi))} rx={2} className={TONE_FILL[s.tone]} />;
                    }))}

                    {kind !== 'bar' && shown.map((s, si) => {
                        const topPts = s.values.map((v, i) => ({ x: pos(i), y: v === null ? null : y(stackable ? cumulative[si][i] : v) }));
                        const bottomPts = Array.from({ length: count }, (_, i) => ({ x: pos(i), y: stackable && si > 0 ? y(cumulative[si - 1][i]) : baseY }));
                        return (
                            <g key={si}>
                                {kind === 'area' && <path d={areaPath(topPts, bottomPts)} className={`${TONE_FILL[s.tone]} ${stackable ? 'opacity-70' : 'opacity-20'}`} stroke="none" />}
                                <path d={linePath(topPts)} fill="none" className={TONE_STROKE[s.tone]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                                {count <= 40 && topPts.map((p, i) => (p.y === null ? null : <circle key={i} cx={p.x} cy={p.y} r={activeIndex === i ? 4 : 2.5} className={`${TONE_FILL[s.tone]} stroke-card`} strokeWidth={1} />))}
                            </g>
                        );
                    })}

                    {activeIndex !== null && (
                        <line x1={pos(activeIndex)} x2={pos(activeIndex)} y1={m.t} y2={baseY} className="stroke-ring" strokeWidth={1} strokeDasharray="4 3" />
                    )}
                    {/* Area de interaccion: focusable (flechas) y sensible al puntero. */}
                    <rect
                        ref={plotRef}
                        x={m.l} y={m.t} width={pw} height={ph}
                        tabIndex={0}
                        role="img"
                        aria-label={`${summary}. ${tx.hint}`}
                        aria-describedby={`${uid}-live`}
                        className={`fill-transparent outline-none ${focused ? 'stroke-ring' : ''}`}
                        strokeWidth={focused ? 2 : 0}
                        onKeyDown={onKeyDown}
                        onFocus={() => { setFocused(true); if (activeIndex === null) setActive(0); }}
                        onBlur={() => { setFocused(false); setActive(null); }}
                        onMouseMove={onMove}
                        onMouseLeave={() => { if (!focused) setActive(null); }}
                    />
                </svg>
                <TooltipBox tip={activeIndex !== null ? tipFor(activeIndex) : null} />
                <p id={`${uid}-live`} className="sr-only" aria-live="polite">{activeIndex !== null ? announce(activeIndex) : ''}</p>
            </div>
            {showLegend && all.length > 0 && (
                <Legend items={all} hidden={hidden} tx={tx} label={tx.legend} onToggle={all.length > 1 ? (i) => setHidden((cur) => { const next = new Set(cur); if (next.has(i)) next.delete(i); else if (next.size < all.length - 1) next.add(i); return next; }) : undefined} />
            )}
            {/* Todos los datos para lectores de pantalla. */}
            <table className="sr-only">
                <caption>{title || tx.data}</caption>
                <thead><tr><th scope="col">{tx.chart}</th>{all.map((s, i) => <th key={i} scope="col">{s.name}</th>)}</tr></thead>
                <tbody>
                    {Array.from({ length: count }, (_, i) => (
                        <tr key={i}><th scope="row">{labelList[i] ?? i + 1}</th>{all.map((s, si) => <td key={si}>{s.values[i] === null ? '—' : withUnit(s.values[i] as number)}</td>)}</tr>
                    ))}
                </tbody>
            </table>
        </figure>
    );
}

// ------------------------------------------------------------------ pie / donut
interface RadialProps { kind: 'pie' | 'donut'; data: unknown[] | undefined; centerLabel: string; title: string; description: string; showLegend: boolean; fmt: (n: number) => string; unit: string; empty: React.ReactNode; tx: Tx }

function RadialChart({ kind, data, centerLabel, title, description, showLegend, fmt, unit, empty, tx }: RadialProps) {
    const slices = React.useMemo(() => cleanSlices(data, tx.others), [data, tx.others]);
    const [active, setActive] = React.useState<number | null>(null);
    const uid = React.useId();
    const total = slices.reduce((s, p) => s + p.value, 0);
    if (slices.length === 0 || total <= 0) return <>{empty}</>;
    const pct = (v: number) => Math.round((v / total) * 100);
    const label = (p: Slice) => `${p.label || '-'}: ${fmt(p.value)}${unit ? ` ${unit}` : ''} (${pct(p.value)}%)`;
    const summary = `${title || tx.chart}. ${slices.length} ${tx.slices}: ${slices.map((p) => `${p.label || '-'} ${pct(p.value)}%`).join(', ')}`;
    const R = 46;
    const inner = kind === 'donut' ? 28 : 0;
    let acc = 0;
    const arcs = slices.map((p) => {
        const a0 = (acc / total) * Math.PI * 2;
        acc += p.value;
        const a1 = (acc / total) * Math.PI * 2;
        return { a0, a1, mid: (a0 + a1) / 2 };
    });
    const tip: Tip | null = active !== null && slices[active]
        ? (() => {
            const mid = arcs[active].mid - Math.PI / 2;
            const rr = (R + inner) / 2;
            return { heading: slices[active].label, rows: [{ name: `${pct(slices[active].value)}%`, tone: slices[active].tone, text: `${fmt(slices[active].value)}${unit ? ` ${unit}` : ''}` }], leftPct: 50 + Math.cos(mid) * rr, topPct: 50 + Math.sin(mid) * rr - 8 };
        })()
        : null;
    return (
        <figure className="m-0 flex w-full min-w-0 flex-wrap items-center gap-4">
            {title && <figcaption className="w-full text-sm font-medium text-foreground">{title}</figcaption>}
            {description && <p className="m-0 sr-only">{description}</p>}
            <div className="relative size-48 shrink-0">
                <svg viewBox="0 0 100 100" role="group" aria-label={summary} className="block size-full">
                    <title>{summary}</title>
                    {slices.map((p, i) => (
                        <path
                            key={i}
                            d={slicePath(50, 50, R, inner, arcs[i].a0, arcs[i].a1)}
                            tabIndex={0}
                            role="img"
                            aria-label={label(p)}
                            onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive((c) => (c === i ? null : c))}
                            onFocus={() => setActive(i)} onBlur={() => setActive((c) => (c === i ? null : c))}
                            className={`${TONE_FILL[p.tone]} stroke-card outline-none ${active === i ? 'opacity-80' : ''}`}
                            strokeWidth={1}
                        />
                    ))}
                    {kind === 'donut' && centerLabel && <text x={50} y={50} textAnchor="middle" dominantBaseline="central" className="pointer-events-none fill-foreground text-[9px] font-semibold">{truncate(centerLabel, 12)}</text>}
                </svg>
                <TooltipBox tip={tip} />
                <p id={`${uid}-live`} className="sr-only" aria-live="polite">{active !== null && slices[active] ? label(slices[active]) : ''}</p>
            </div>
            {showLegend && <Legend items={slices.map((p) => ({ name: p.label, tone: p.tone, extra: `${pct(p.value)}%` }))} tx={tx} label={tx.legend} />}
        </figure>
    );
}
