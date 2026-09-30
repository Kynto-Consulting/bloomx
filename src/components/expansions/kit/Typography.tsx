'use client';

/**
 * Kit: tipografia (Text, Heading, Code, Link, Markdown, IconGlyph).
 * Todo el contenido llega como dato de terceros: se pinta SIEMPRE como texto React (nunca HTML) y las URLs
 * pasan por safe-url.ts.
 */
import * as React from 'react';
import NextLink from 'next/link';
import { SIZES_XL, TEXT_ALIGNS, TEXT_SIZES, WEIGHTS } from '@/lib/expansions/ui-schema';
import { safeHref, safeInternalPath } from '@/lib/expansions/safe-url';
import {
    FOCUS_RING_CLASS, HEADING_SIZE_CLASS, TEXT_ALIGN_CLASS, TEXT_SIZE_CLASS, TONE_TEXT, WEIGHT_CLASS, pick, toTone,
    type SizeXl, type TextSize, type Tone, type Weight,
} from './tokens';
import { KitIcon } from './Icon';
import { useKitStrings } from './strings';

const txt = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '');
/** Contenido de texto: `content` (o el alias) y, si no hay, los hijos si son texto. */
const textOf = (content: unknown, children: React.ReactNode): React.ReactNode => {
    const own = txt(content);
    if (own) return own;
    return children;
};

// ------------------------------------------------------------------ Text
const TEXT_VARIANTS = ['default', 'muted', 'caption', 'label', 'quote'] as const;
const LINE_CLAMP_CLASS: Record<number, string> = {
    1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4', 5: 'line-clamp-5', 6: 'line-clamp-6',
    7: 'line-clamp-[7]', 8: 'line-clamp-[8]', 9: 'line-clamp-[9]', 10: 'line-clamp-[10]', 11: 'line-clamp-[11]', 12: 'line-clamp-[12]',
};
export interface TextProps {
    content?: string; variant?: (typeof TEXT_VARIANTS)[number]; tone?: Tone; size?: TextSize; weight?: Weight; align?: 'start' | 'center' | 'end';
    truncate?: boolean; lines?: number; mono?: boolean; children?: React.ReactNode;
}
export function Text({ content, variant, tone, size, weight, align, truncate, lines, mono, children }: TextProps) {
    const v = pick(variant, TEXT_VARIANTS, 'default');
    const t = toTone(tone);
    const s = pick<TextSize>(size, TEXT_SIZES, v === 'caption' ? 'xs' : 'sm');
    const w = weight === undefined ? (v === 'label' ? 'medium' : 'normal') : pick<Weight>(weight, WEIGHTS, 'normal');
    const n = typeof lines === 'number' && Number.isFinite(lines) ? Math.min(12, Math.max(1, Math.round(lines))) : 0;
    const color = t !== 'neutral' ? TONE_TEXT[t] : v === 'muted' || v === 'caption' ? 'text-muted-foreground' : 'text-foreground';
    const wrapping = truncate === true ? 'truncate' : `whitespace-pre-wrap break-words ${n ? LINE_CLAMP_CLASS[n] : ''}`;
    const cls = [
        TEXT_SIZE_CLASS[s], WEIGHT_CLASS[w], color, TEXT_ALIGN_CLASS[pick(align, TEXT_ALIGNS, 'start')], wrapping,
        mono === true ? 'font-mono' : '', v === 'quote' ? 'rounded-md border-l-4 border-l-border bg-muted px-4 py-3 italic' : '', 'min-w-0',
    ].filter(Boolean).join(' ');
    const body = textOf(content, children);
    return v === 'quote' ? <blockquote className={cls}>{body}</blockquote> : <p className={cls}>{body}</p>;
}

// ------------------------------------------------------------------ Heading
export interface HeadingProps { content?: string; level?: 1 | 2 | 3 | 4 | 5 | 6; size?: TextSize; tone?: Tone; align?: 'start' | 'center' | 'end'; children?: React.ReactNode }
export function Heading({ content, level, size, tone, align, children }: HeadingProps) {
    const lv = pick<number>(typeof level === 'string' ? Number(level) : level, [1, 2, 3, 4, 5, 6], 3);
    const Tag = `h${lv}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    const sized = size !== undefined && (TEXT_SIZES as readonly unknown[]).includes(size) ? `${TEXT_SIZE_CLASS[size]} font-semibold tracking-tight` : HEADING_SIZE_CLASS[lv];
    const cls = [sized, TONE_TEXT[toTone(tone)], TEXT_ALIGN_CLASS[pick(align, TEXT_ALIGNS, 'start')], 'break-words min-w-0'].join(' ');
    return <Tag className={cls}>{textOf(content, children)}</Tag>;
}

// ------------------------------------------------------------------ Code
const CODE_INLINE_CLASS = 'rounded-sm bg-code px-1.5 py-0.5 font-mono text-[0.875em] text-code-foreground';
const COPY_BUTTON_CLASS = `inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-code-foreground/30 bg-transparent px-2 text-xs text-code-foreground hover:bg-code-foreground/10 ${FOCUS_RING_CLASS}`;
export interface CodeProps { content?: string; code?: string; block?: boolean; copyable?: boolean; language?: string; children?: React.ReactNode }
export function Code({ content, code, block, copyable, language, children }: CodeProps) {
    const strings = useKitStrings();
    const [copied, setCopied] = React.useState(false);
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    const source = txt(content) || txt(code) || (typeof children === 'string' ? children : '');
    const lang = typeof language === 'string' && /^[A-Za-z0-9+#.-]{1,30}$/.test(language) ? language : undefined;

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(source);
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
        } catch { /* portapapeles no disponible o denegado */ }
    };
    const button = copyable === true ? (
        <>
            <button type="button" onClick={copy} className={COPY_BUTTON_CLASS}>
                <KitIcon name={copied ? 'Check' : 'Copy'} size="xs" />
                <span>{strings.copy}</span>
            </button>
            <span role="status" aria-live="polite" className="sr-only">{copied ? strings.copied : ''}</span>
        </>
    ) : null;

    if (block === true) {
        return (
            <div className="relative w-full min-w-0 rounded-md bg-code text-code-foreground">
                <pre tabIndex={0} data-language={lang} className={`overflow-x-auto rounded-md p-3 font-mono text-sm text-code-foreground ${copyable === true ? 'pr-24' : ''} ${FOCUS_RING_CLASS}`}>
                    <code>{source}</code>
                </pre>
                {copyable === true && <div className="absolute right-2 top-2">{button}</div>}
            </div>
        );
    }
    if (copyable === true) {
        return (
            <span className="inline-flex max-w-full items-center gap-2 rounded-md bg-code py-0.5 pl-1.5 pr-1 align-middle text-code-foreground">
                <code data-language={lang} className="min-w-0 break-all font-mono text-[0.875em] text-code-foreground">{source}</code>
                {button}
            </span>
        );
    }
    return <code data-language={lang} className={CODE_INLINE_CLASS}>{source}</code>;
}

// ------------------------------------------------------------------ Link
type LinkTarget = { kind: 'external' | 'internal' | 'anchor'; href: string };
/** Clasifica un destino: solo http(s)/mailto/tel, rutas internas "/x" y anclas "#x". Null si no es seguro. */
export function classifyUrl(raw: unknown): LinkTarget | null {
    const value = txt(raw).trim();
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
    if (/^(?:https?:|mailto:|tel:)/i.test(value)) { const h = safeHref(value); return h ? { kind: 'external', href: h } : null; }
    if (value.startsWith('#')) return { kind: 'anchor', href: value };
    const path = safeInternalPath(value);
    return path ? { kind: 'internal', href: path } : null;
}

const LINK_CLASS: Record<'primary' | 'neutral', string> = {
    primary: 'text-link underline underline-offset-4 hover:text-link-hover',
    neutral: 'text-foreground underline underline-offset-4 hover:text-muted-foreground',
};
export interface LinkProps { label?: string; url?: string; tone?: 'primary' | 'neutral'; onPress?: () => void; children?: React.ReactNode }
export function Link({ label, url, tone, onPress, children }: LinkProps) {
    const target = classifyUrl(url);
    const look = pick(tone, ['primary', 'neutral'] as const, 'primary');
    const cls = `${LINK_CLASS[look]} rounded-sm break-words ${FOCUS_RING_CLASS}`;
    const body = textOf(label, children) || txt(url);
    const press = (e: React.MouseEvent) => { if (typeof onPress === 'function') { e.preventDefault(); onPress(); } };
    if (!target) {
        if (typeof onPress === 'function') return <button type="button" onClick={() => onPress()} className={cls}>{body}</button>;
        return <span>{body}</span>;
    }
    if (target.kind === 'external') {
        const web = /^https?:/i.test(target.href);
        return <a href={target.href} onClick={press} className={cls} {...(web ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{body}</a>;
    }
    if (target.kind === 'internal') return <NextLink href={target.href} onClick={press} className={cls}>{body}</NextLink>;
    return <a href={target.href} onClick={press} className={cls}>{body}</a>;
}

// ------------------------------------------------------------------ Markdown
export const MARKDOWN_MAX_CHARS = 20000;
const MD_CODE_CLASS = 'rounded-sm bg-code px-1 py-0.5 font-mono text-[0.9em] text-code-foreground';

function inline(source: string, depth: number, prefix: string): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    let buffer = '';
    let key = 0;
    const flush = () => { if (buffer) { out.push(buffer); buffer = ''; } };
    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        if (ch === '`') {
            const end = source.indexOf('`', i + 1);
            if (end > i + 1) { flush(); out.push(<code key={`${prefix}c${key++}`} className={MD_CODE_CLASS}>{source.slice(i + 1, end)}</code>); i = end + 1; continue; }
        } else if (ch === '*' && depth < 4) {
            if (source.startsWith('**', i)) {
                const end = source.indexOf('**', i + 2);
                if (end > i + 2) { flush(); out.push(<strong key={`${prefix}b${key++}`} className="font-semibold">{inline(source.slice(i + 2, end), depth + 1, `${prefix}b${key}-`)}</strong>); i = end + 2; continue; }
            } else {
                const end = source.indexOf('*', i + 1);
                if (end > i + 1 && !/\s/.test(source[i + 1])) { flush(); out.push(<em key={`${prefix}e${key++}`}>{inline(source.slice(i + 1, end), depth + 1, `${prefix}e${key}-`)}</em>); i = end + 1; continue; }
            }
        } else if (ch === '[') {
            const m = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(source.slice(i));
            if (m) {
                flush();
                const label = m[1] || m[2];
                const target = classifyUrl(m[2]);
                if (!target) out.push(label);
                else if (target.kind === 'external' && /^https?:/i.test(target.href)) out.push(<a key={`${prefix}l${key++}`} href={target.href} target="_blank" rel="noopener noreferrer" className={`${LINK_CLASS.primary} rounded-sm ${FOCUS_RING_CLASS}`}>{label}</a>);
                else out.push(<a key={`${prefix}l${key++}`} href={target.href} className={`${LINK_CLASS.primary} rounded-sm ${FOCUS_RING_CLASS}`}>{label}</a>);
                i += m[0].length;
                continue;
            }
        }
        buffer += ch;
        i += 1;
    }
    flush();
    return out;
}

function withBreaks(lines: string[], prefix: string): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    lines.forEach((line, idx) => {
        if (idx > 0) out.push(<br key={`${prefix}br${idx}`} />);
        out.push(...inline(line, 0, `${prefix}${idx}-`));
    });
    return out;
}

const MD_HEADING_CLASS: Record<number, string> = { 1: 'text-xl font-semibold tracking-tight', 2: 'text-lg font-semibold', 3: 'text-base font-semibold' };
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d{1,9}[.)]\s+(.*)$/;
const HEADING_RE = /^(#{1,3})\s+(.*?)\s*#*\s*$/;

export function renderMarkdown(source: string): React.ReactNode[] {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const blocks: React.ReactNode[] = [];
    let i = 0;
    let k = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i += 1; continue; }
        if (line.trim().startsWith('```')) {
            const body: string[] = [];
            i += 1;
            while (i < lines.length && !lines[i].trim().startsWith('```')) { body.push(lines[i]); i += 1; }
            i += 1;
            blocks.push(<pre key={`b${k++}`} tabIndex={0} className={`overflow-x-auto rounded-md bg-code p-3 font-mono text-sm text-code-foreground ${FOCUS_RING_CLASS}`}><code>{body.join('\n')}</code></pre>);
            continue;
        }
        const hm = HEADING_RE.exec(line);
        if (hm) {
            const lv = hm[1].length;
            const Tag = (`h${lv + 2}`) as 'h3' | 'h4' | 'h5';
            blocks.push(<Tag key={`b${k++}`} className={`${MD_HEADING_CLASS[lv]} text-foreground`}>{inline(hm[2], 0, `h${k}-`)}</Tag>);
            i += 1;
            continue;
        }
        const listRe = UL_RE.test(line) ? UL_RE : OL_RE.test(line) ? OL_RE : null;
        if (listRe) {
            const items: string[] = [];
            while (i < lines.length && listRe.test(lines[i])) { items.push(listRe.exec(lines[i])![1]); i += 1; }
            const children = items.map((it, idx) => <li key={idx}>{inline(it, 0, `i${k}-${idx}-`)}</li>);
            blocks.push(listRe === UL_RE
                ? <ul key={`b${k++}`} className="list-disc space-y-1 ps-5">{children}</ul>
                : <ol key={`b${k++}`} className="list-decimal space-y-1 ps-5">{children}</ol>);
            continue;
        }
        const para: string[] = [];
        while (i < lines.length && lines[i].trim() && !HEADING_RE.test(lines[i]) && !UL_RE.test(lines[i]) && !OL_RE.test(lines[i]) && !lines[i].trim().startsWith('```')) { para.push(lines[i]); i += 1; }
        blocks.push(<p key={`b${k++}`} className="break-words">{withBreaks(para, `p${k}-`)}</p>);
    }
    return blocks;
}

export interface MarkdownProps { content?: string; size?: TextSize; children?: React.ReactNode }
export function Markdown({ content, size, children }: MarkdownProps) {
    const source = (txt(content) || (typeof children === 'string' ? children : '')).slice(0, MARKDOWN_MAX_CHARS);
    const blocks = React.useMemo(() => renderMarkdown(source), [source]);
    return <div className={`flex min-w-0 flex-col gap-2 text-foreground ${TEXT_SIZE_CLASS[pick<TextSize>(size, TEXT_SIZES, 'sm')]}`}>{blocks}</div>;
}

// ------------------------------------------------------------------ IconGlyph
export interface IconGlyphProps { name?: string; size?: SizeXl; tone?: Tone; label?: string }
export function IconGlyph({ name, size, tone, label }: IconGlyphProps) {
    const accessible = txt(label);
    return <KitIcon name={txt(name) || undefined} size={pick<SizeXl>(size, SIZES_XL, 'md')} label={accessible || undefined} className={TONE_TEXT[toTone(tone)]} />;
}
