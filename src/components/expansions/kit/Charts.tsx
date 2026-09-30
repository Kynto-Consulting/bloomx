'use client';

/**
 * Graficos del kit en SVG propio: BarChart, Sparkline y Donut. Todo el color viene de tokens
 * (TONE_FILL / TONE_STROKE / TONE_BG); las etiquetas usan fill-foreground / fill-muted-foreground.
 */
import * as React from 'react';
import { SIZES_XL } from '@/lib/expansions/ui-schema';
import { useI18n } from '@/components/I18nProvider';
import { useKitStrings } from './strings';
import { CHART_SEQUENCE, TONE_BG, TONE_FILL, TONE_STROKE, pick, toTone, type Tone } from './tokens';

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const MAX_POINTS = 200;
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

const TXT = {
    es: { bar: 'Grafico de barras', spark: 'Tendencia', donut: 'Grafico de anillo', min: 'minimo', max: 'maximo', last: 'ultimo', bars: 'barras', parts: 'partes', of: 'de' },
    en: { bar: 'Bar chart', spark: 'Trend', donut: 'Donut chart', min: 'min', max: 'max', last: 'last', bars: 'bars', parts: 'parts', of: 'of' },
};
function useTxt() {
    return useI18n().locale === 'en' ? TXT.en : TXT.es;
}

interface Point { label: string; value: number; tone: Tone }
function cleanPoints(data: unknown, baseTone: Tone | null): Point[] {
    if (!Array.isArray(data)) return [];
    const out: Point[] = [];
    for (const raw of data) {
        if (out.length >= MAX_POINTS) break;
        if (!raw || typeof raw !== 'object') continue;
        const value = num((raw as { value?: unknown }).value);
        if (value === null) continue;
        const i = out.length;
        const tone = toTone((raw as { tone?: unknown }).tone, baseTone ?? CHART_SEQUENCE[i % CHART_SEQUENCE.length]);
        out.push({ label: str((raw as { label?: unknown }).label), value, tone });
    }
    return out;
}
function summarize(points: Point[], max = 12) {
    const shown = points.slice(0, max).map((p) => `${p.label || '-'}: ${fmt(p.value)}`).join(', ');
    return points.length > max ? `${shown}, …` : shown;
}

function EmptyChart() {
    const t = useKitStrings();
    return <p className="text-sm text-muted-foreground">{t.empty}</p>;
}

// ------------------------------------------------------------------ BarChart
export interface BarChartProps {
    data?: Array<{ label?: string; value?: number; tone?: Tone }>;
    orientation?: 'vertical' | 'horizontal';
    showValues?: boolean;
    height?: 'sm' | 'md' | 'lg';
    tone?: Tone;
    title?: string;
}

const BAR_HEIGHT = { sm: 120, md: 180, lg: 260 } as const;
const ROW_HEIGHT = { sm: 22, md: 28, lg: 36 } as const;

export function BarChart({ data, orientation, showValues, height, tone, title }: BarChartProps) {
    const tx = useTxt();
    const points = cleanPoints(data, toTone(tone, 'primary'));
    const h = pick(height, ['sm', 'md', 'lg'] as const, 'md');
    const horizontal = orientation === 'horizontal';
    const values = showValues !== false;
    const heading = str(title);
    const descr = `${heading || tx.bar}. ${points.length} ${tx.bars}: ${summarize(points)}`;
    if (points.length === 0) return <EmptyChart />;
    const max = Math.max(0, ...points.map((p) => p.value)) || 1;
    const n = points.length;

    if (horizontal) {
        const rowH = ROW_HEIGHT[h];
        const labelW = 96;
        const valueW = values ? 44 : 4;
        const W = 360;
        const barMax = W - labelW - valueW;
        const H = n * rowH + 4;
        return (
            <svg role="img" aria-label={descr} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full max-w-full" preserveAspectRatio="xMinYMin meet">
                <title>{descr}</title>
                {points.map((p, i) => {
                    const y = 2 + i * rowH;
                    const w = Math.max(0, (Math.max(p.value, 0) / max) * barMax);
                    return (
                        <g key={i}>
                            <text x={labelW - 6} y={y + rowH / 2} textAnchor="end" dominantBaseline="central" className="fill-foreground text-[11px]">{truncate(p.label, 14)}</text>
                            <rect x={labelW} y={y + rowH * 0.18} width={w} height={rowH * 0.64} rx={3} className={TONE_FILL[p.tone]} />
                            {values && <text x={labelW + w + 4} y={y + rowH / 2} dominantBaseline="central" className="fill-muted-foreground text-[11px]">{fmt(p.value)}</text>}
                        </g>
                    );
                })}
                <line x1={labelW} x2={labelW} y1={0} y2={H} className="stroke-border" strokeWidth={1} />
            </svg>
        );
    }

    const H = BAR_HEIGHT[h];
    const top = values ? 16 : 4;
    const bottom = 24;
    const slot = 44;
    const W = Math.max(200, n * slot + 8);
    const plotH = H - top - bottom;
    const barW = slot * 0.62;
    return (
        <svg role="img" aria-label={descr} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full max-w-full" preserveAspectRatio="xMinYMin meet">
            <title>{descr}</title>
            <line x1={4} x2={W - 4} y1={top + plotH} y2={top + plotH} className="stroke-border" strokeWidth={1} />
            {points.map((p, i) => {
                const bh = Math.max(0, (Math.max(p.value, 0) / max) * plotH);
                const cx = 4 + slot * i + slot / 2;
                return (
                    <g key={i}>
                        <rect x={cx - barW / 2} y={top + plotH - bh} width={barW} height={bh} rx={3} className={TONE_FILL[p.tone]} />
                        {values && <text x={cx} y={top + plotH - bh - 4} textAnchor="middle" className="fill-foreground text-[11px]">{fmt(p.value)}</text>}
                        <text x={cx} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">{truncate(p.label, 7)}</text>
                    </g>
                );
            })}
        </svg>
    );
}

// ------------------------------------------------------------------ Sparkline
export interface SparklineProps {
    values?: number[];
    tone?: Tone;
    height?: 'sm' | 'md' | 'lg';
    area?: boolean;
    label?: string;
}

const SPARK_H = { sm: 'h-8', md: 'h-12', lg: 'h-16' } as const;

export function Sparkline({ values, tone, height, area, label }: SparklineProps) {
    const tx = useTxt();
    const t = toTone(tone, 'primary');
    const h = pick(height, ['sm', 'md', 'lg'] as const, 'sm');
    const series = (Array.isArray(values) ? values : []).map(num).filter((v): v is number => v !== null).slice(0, 500);
    if (series.length === 0) return null;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const last = series[series.length - 1];
    const descr = `${str(label) || tx.spark}: ${tx.min} ${fmt(min)}, ${tx.max} ${fmt(max)}, ${tx.last} ${fmt(last)}`;
    const W = 100;
    const H = 30;
    const pad = 3;
    const range = max - min;
    const pts = series.map((v, i) => {
        const x = series.length === 1 ? W / 2 : (i / (series.length - 1)) * W;
        const y = range === 0 ? H / 2 : pad + (1 - (v - min) / range) * (H - pad * 2);
        return [x, y] as const;
    });
    const line = series.length === 1 ? `M0 ${pts[0][1]} L${W} ${pts[0][1]}` : pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
    const first = series.length === 1 ? 0 : pts[0][0];
    const lastX = series.length === 1 ? W : pts[pts.length - 1][0];
    return (
        <svg role="img" aria-label={descr} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`block w-full max-w-full ${SPARK_H[h]}`}>
            <title>{descr}</title>
            {area === true && <path d={`${line} L${lastX} ${H} L${first} ${H} Z`} className={`${TONE_FILL[t]} opacity-20`} stroke="none" />}
            <path d={line} fill="none" className={TONE_STROKE[t]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

// ------------------------------------------------------------------ Donut
export interface DonutProps {
    data?: Array<{ label?: string; value?: number; tone?: Tone }>;
    centerLabel?: string;
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    showLegend?: boolean;
    title?: string;
}

const DONUT_SIZE = { xs: 'size-16', sm: 'size-24', md: 'size-32', lg: 'size-40', xl: 'size-52' } as const;
const R = 40;
const CIRC = 2 * Math.PI * R;

export function Donut({ data, centerLabel, size, showLegend, title }: DonutProps) {
    const tx = useTxt();
    const points = cleanPoints(data, null).map((p) => ({ ...p, value: Math.max(0, p.value) }));
    const sz = pick(size, SIZES_XL, 'md');
    const total = points.reduce((s, p) => s + p.value, 0);
    const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
    const heading = str(title);
    const descr = `${heading || tx.donut}. ${points.length} ${tx.parts}: ${points.map((p) => `${p.label || '-'}: ${pct(p.value)}%`).join(', ')}`;
    if (points.length === 0) return <EmptyChart />;
    let offset = 0;
    const center = truncate(str(centerLabel), 12);
    return (
        <div className="inline-flex max-w-full flex-wrap items-center gap-4">
            <svg role="img" aria-label={descr} viewBox="0 0 100 100" className={`block shrink-0 ${DONUT_SIZE[sz]}`}>
                <title>{descr}</title>
                <circle cx={50} cy={50} r={R} fill="none" strokeWidth={14} className="stroke-muted" />
                <g transform="rotate(-90 50 50)">
                    {total > 0 && points.map((p, i) => {
                        if (p.value <= 0) return null;
                        const len = (p.value / total) * CIRC;
                        const el = (
                            <circle key={i} cx={50} cy={50} r={R} fill="none" strokeWidth={14} strokeDasharray={`${len} ${CIRC - len}`} strokeDashoffset={-offset} className={TONE_STROKE[p.tone]} />
                        );
                        offset += len;
                        return el;
                    })}
                </g>
                {center && <text x={50} y={50} textAnchor="middle" dominantBaseline="central" className="fill-foreground text-[12px] font-semibold">{center}</text>}
            </svg>
            {showLegend !== false && (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-foreground">
                    {points.map((p, i) => (
                        <li key={i} className="flex items-center gap-2">
                            <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 rounded-full ${TONE_BG[p.tone]}`} />
                            <span className="min-w-0 truncate">{p.label}</span>
                            <span className="text-muted-foreground">{pct(p.value)}%</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
