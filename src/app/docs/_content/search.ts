import { DOC_PAGES, docHref } from './nav';
import { DOC_CONTENT } from './registry';
import type { Block, Locale } from './types';

/** Indice de busqueda del lado del cliente: una entrada por seccion (h2/h3) de cada pagina. Sin dependencias. */
export interface SearchEntry {
    href: string;
    page: string;
    heading: string;
    text: string;
    norm: string;
    headingNorm: string;
    pageNorm: string;
}

export function normalize(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function blockText(b: Block): string {
    switch (b.t) {
        case 'p': return b.text;
        case 'ul':
        case 'ol': return b.items.join(' ');
        case 'code': return b.code;
        case 'table': return [...b.head, ...b.rows.flat()].join(' ');
        case 'callout': return `${b.title ?? ''} ${b.text}`;
        case 'h2':
        case 'h3': return b.text;
        default: return '';
    }
}

const cache: Partial<Record<Locale, SearchEntry[]>> = {};

export function buildIndex(locale: Locale): SearchEntry[] {
    if (cache[locale]) return cache[locale]!;
    const out: SearchEntry[] = [];
    for (const p of DOC_PAGES) {
        const blocks = DOC_CONTENT[p.slug]?.[locale] ?? [];
        const page = p.title[locale];
        const push = (heading: string, id: string | null, text: string) => {
            const full = `${text} ${p.keywords ?? ''} ${p.description[locale]}`;
            out.push({
                href: id ? `${docHref(p.slug)}#${id}` : docHref(p.slug),
                page,
                heading,
                text: text.slice(0, 400),
                norm: normalize(full),
                headingNorm: normalize(heading),
                pageNorm: normalize(page),
            });
        };
        let curHeading = page;
        let curId: string | null = null;
        let buf: string[] = [];
        for (const b of blocks) {
            if (b.t === 'h2' || b.t === 'h3') {
                push(curHeading, curId, buf.join(' '));
                curHeading = b.text;
                curId = b.id;
                buf = [b.text];
            } else {
                buf.push(blockText(b));
            }
        }
        push(curHeading, curId, buf.join(' '));
    }
    return (cache[locale] = out);
}

/** Todos los terminos deben aparecer; puntua mas el titulo de seccion y de pagina. */
export function search(locale: Locale, query: string, limit = 8): SearchEntry[] {
    const terms = normalize(query).split(/\s+/).filter((t) => t.length > 0);
    if (!terms.length || normalize(query).length < 2) return [];
    const scored: Array<{ e: SearchEntry; score: number }> = [];
    for (const e of buildIndex(locale)) {
        if (!terms.every((t) => e.norm.includes(t) || e.headingNorm.includes(t))) continue;
        let score = 0;
        for (const t of terms) {
            if (e.headingNorm.includes(t)) score += 5;
            if (e.pageNorm.includes(t)) score += 2;
            score += 1;
        }
        scored.push({ e, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.e);
}
