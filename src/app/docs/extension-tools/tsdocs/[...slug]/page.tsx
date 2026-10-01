import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { IndexView } from '../../../_components/tsdocs/IndexView';
import { SymbolView } from '../../../_components/tsdocs/SymbolView';
import {
    MODULES, TSDOCS_SYMBOLS, aliasesFor, findSymbol, resolveAlias, tsdocsHref, tsdocsNeighbours,
} from '../../../_content/tsdocs';

type Params = { slug: string[] };

/** /tsdocs/<modulo> (indice del modulo), /tsdocs/<modulo>/<Simbolo> y alias (p. ej. host/storage) que redirigen al canonico. */
export const dynamicParams = false;

export function generateStaticParams(): Params[] {
    const out: Params[] = MODULES.map((m) => ({ slug: [m.id] }));
    for (const s of TSDOCS_SYMBOLS) {
        out.push({ slug: [s.module, s.name] });
        for (const a of aliasesFor(s)) out.push({ slug: [s.module, a] });
    }
    return out;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
    const { slug } = await params;
    if (slug.length === 1) return { title: `${slug[0]} | TSDocs | BloomX Docs` };
    const s = findSymbol(slug[0], slug[1]);
    if (!s) return { title: 'TSDocs | BloomX Docs' };
    return { title: `${s.name} | TSDocs | BloomX Docs`, description: s.doc.summary.replace(/[`*]/g, '').slice(0, 200) || undefined };
}

export default async function TsDocsSymbolPage({ params }: { params: Promise<Params> }) {
    const { slug } = await params;
    if (slug.length === 1) {
        if (!MODULES.some((m) => m.id === slug[0])) notFound();
        return <IndexView module={slug[0]} />;
    }
    if (slug.length !== 2) notFound();
    const s = findSymbol(slug[0], slug[1]);
    if (!s) {
        const alias = resolveAlias(slug[0], slug[1]);
        if (alias) permanentRedirect(tsdocsHref(alias));
        notFound();
    }
    const { prev, next } = tsdocsNeighbours(s);
    return <SymbolView symbol={s} prev={prev && { name: prev.name, module: prev.module }} next={next && { name: next.name, module: next.module }} />;
}

