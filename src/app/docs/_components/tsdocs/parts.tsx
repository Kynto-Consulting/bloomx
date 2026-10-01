'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CopyButton, Inline } from '../DocView';
import { findSymbolByName, splitLinks, tokenizeCode, tsdocsHref } from '../../_content/tsdocs-lite';
import type { Locale } from '../../_content/types';

const LINK_CLS = 'rounded-sm text-link underline decoration-dotted underline-offset-2 hover:text-link-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Codigo TS con resaltado (tokens del tema) y cada tipo del SDK enlazado a su pagina. `self` no se enlaza a si mismo. */
export function TsCode({ code, self }: { code: string; self?: string }): ReactNode {
    return (
        <>
            {tokenizeCode(code).map((t, i) => {
                switch (t.kind) {
                    case 'kw': return <span key={i} className="font-semibold text-primary">{t.text}</span>;
                    case 'str': return <span key={i} className="text-success">{t.text}</span>;
                    case 'num': return <span key={i} className="text-info">{t.text}</span>;
                    case 'com': return <span key={i} className="italic text-muted-foreground">{t.text}</span>;
                    case 'type': {
                        const s = findSymbolByName(t.text);
                        if (!s || t.text === self) return <span key={i} className="font-medium text-card-foreground">{t.text}</span>;
                        return <Link key={i} href={tsdocsHref(s)} className={LINK_CLS}>{t.text}</Link>;
                    }
                    default: return <span key={i}>{t.text}</span>;
                }
            })}
        </>
    );
}

/** Bloque de codigo (mismo marco que el de la doc) con resaltado, enlaces entre tipos y boton Copiar. */
export function CodeBlock({ code, title, locale, self }: { code: string; title?: string; locale: Locale; self?: string }) {
    return (
        <figure className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted px-3 py-1.5">
                <figcaption className="truncate font-mono text-xs text-foreground">{title ?? 'ts'}</figcaption>
                <CopyButton text={code} locale={locale} />
            </div>
            <pre tabIndex={0} className="overflow-x-auto p-4 text-[13px] leading-6"><code className="font-mono"><TsCode code={code} self={self} /></code></pre>
        </figure>
    );
}

/** Tipo en linea (tabla de miembros): monoespaciado, con enlaces. */
export function InlineType({ type }: { type: string }) {
    return <code className="break-words font-mono text-[0.85em] text-card-foreground"><TsCode code={type} /></code>;
}

/** Texto TSDoc: marcado en linea de la doc (`codigo`, **negrita**, [x](/ruta)) y {@link Simbolo}. */
export function DocText({ text }: { text: string }) {
    return (
        <>
            {splitLinks(text).map((p, i) => {
                if (p.name) {
                    const s = findSymbolByName(p.name)!;
                    return <Link key={i} href={tsdocsHref(s)} className={cn(LINK_CLS, 'font-mono text-[0.9em]')}>{p.text}</Link>;
                }
                return <span key={i} className="whitespace-pre-line"><Inline text={p.text} /></span>;
            })}
        </>
    );
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warning' | 'info' | 'primary' }) {
    const cls = {
        muted: 'border-border bg-muted text-foreground',
        warning: 'border-warning/50 bg-warning/10 text-foreground',
        info: 'border-info/40 bg-info/10 text-foreground',
        primary: 'border-primary/40 bg-primary/10 text-foreground',
    }[tone];
    return <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium', cls)}>{children}</span>;
}

const STR = {
    es: {
        tsdocs: 'TSDocs', docs: 'Documentación', tools: 'Herramientas de extensiones', home: 'Inicio',
        signature: 'Firma', typeParams: 'Parámetros de tipo', values: 'Valores permitidos', members: 'Miembros', enumMembers: 'Miembros del enum',
        name: 'Nombre', type: 'Tipo', description: 'Descripción', params: 'Parámetros', param: 'Parámetro', returns: 'Devuelve',
        examples: 'Ejemplos', remarks: 'Notas', see: 'Ver también', extends: 'Extiende', implements: 'Implementa',
        usedBy: 'Usado en / Referenciado por', uses: 'Referencia a', none: 'Nada todavía.', source: 'Fuente',
        optional: 'opcional', readonly: 'solo lectura', required: 'obligatorio', deprecated: 'Obsoleto', since: 'Desde',
        defaultValue: 'Por defecto', constraint: 'Restricción', prev: 'Anterior', next: 'Siguiente', onThisPage: 'En esta página',
        searchLabel: 'Buscar símbolos', searchPlaceholder: 'Buscar símbolo… (/ para enfocar)', results: '{n} símbolos', noResults: 'Ningún símbolo coincide con “{q}”.',
        groupBy: 'Agrupar por', byCategory: 'Categoría', byModule: 'Módulo', byKind: 'Tipo de símbolo', allModules: 'Módulos',
        indexTitle: 'TSDocs: referencia del SDK', indexDesc: 'Referencia generada a partir de los .d.ts reales del SDK: interfaces, tipos, funciones, constantes, acciones y servicios del host.',
        generated: 'Generado automáticamente de los .d.ts del SDK con `npm run docs:tsdocs`.', symbolsCount: '{n} símbolos', overloads: 'miembros',
        moduleTitle: 'Módulo {m}', file: 'Fichero', noDescription: 'Sin descripción.',
    },
    en: {
        tsdocs: 'TSDocs', docs: 'Documentation', tools: 'Extension tools', home: 'Home',
        signature: 'Signature', typeParams: 'Type parameters', values: 'Allowed values', members: 'Members', enumMembers: 'Enum members',
        name: 'Name', type: 'Type', description: 'Description', params: 'Parameters', param: 'Parameter', returns: 'Returns',
        examples: 'Examples', remarks: 'Remarks', see: 'See also', extends: 'Extends', implements: 'Implements',
        usedBy: 'Used in / Referenced by', uses: 'References', none: 'Nothing yet.', source: 'Source',
        optional: 'optional', readonly: 'readonly', required: 'required', deprecated: 'Deprecated', since: 'Since',
        defaultValue: 'Default', constraint: 'Constraint', prev: 'Previous', next: 'Next', onThisPage: 'On this page',
        searchLabel: 'Search symbols', searchPlaceholder: 'Search symbol… (/ to focus)', results: '{n} symbols', noResults: 'No symbol matches “{q}”.',
        groupBy: 'Group by', byCategory: 'Category', byModule: 'Module', byKind: 'Symbol kind', allModules: 'Modules',
        indexTitle: 'TSDocs: SDK reference', indexDesc: 'Reference generated from the real SDK .d.ts files: interfaces, types, functions, constants, actions and host services.',
        generated: 'Generated automatically from the SDK .d.ts files with `npm run docs:tsdocs`.', symbolsCount: '{n} symbols', overloads: 'members',
        moduleTitle: 'Module {m}', file: 'File', noDescription: 'No description.',
    },
} as const;

export type TsKey = keyof typeof STR.es;
export function tt(locale: Locale, key: TsKey, vars?: Record<string, string | number>): string {
    let s: string = (STR[locale] ?? STR.es)[key];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
}
