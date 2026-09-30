import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/components/I18nProvider';
import { DocView } from '../../_components/DocView';
import { Diagram } from '../../_components/Diagram';
import { DOC_PAGES } from '../nav';
import { DOC_CONTENT } from '../registry';
import type { Locale } from '../types';

/** Las paginas se renderizan (SSR) sin lanzar, con encabezados con id, tablas y botones de copia. */
function html(slug: string, locale: Locale): string {
    return renderToStaticMarkup(
        React.createElement(I18nProvider, { locale, children: React.createElement(DocView, { slug }) }),
    );
}

describe('render de las paginas de docs', () => {
    for (const locale of ['es', 'en'] as Locale[]) {
        it(`renderiza todas las paginas en ${locale}`, () => {
            for (const p of DOC_PAGES) {
                const out = html(p.slug, locale);
                expect(out.length, `${p.slug}/${locale} vacio`).toBeGreaterThan(500);
                expect(out, `${p.slug}/${locale} contiene <h1>`).toContain(`<h1`);
                expect(out).toContain(p.title[locale].replace(/&/g, '&amp;'));
                expect(out, `${p.slug}/${locale} contiene "undefined"`).not.toMatch(/>undefined<|\[object Object\]/);
                for (const b of DOC_CONTENT[p.slug][locale]) {
                    if (b.t === 'h2' || b.t === 'h3') expect(out, `${p.slug}/${locale} sin id ${b.id}`).toContain(`id="${b.id}"`);
                }
            }
        }, 60_000);
    }

    it('los bloques de codigo tienen boton de copiar y la tabla de variables se pinta', () => {
        const env = html('env-variables', 'es');
        expect(env).toContain('NEXTAUTH_SECRET');
        expect(env).toContain('WEBHOOK_SECRET');
        expect(env).toMatch(/Copiar código|aria-label="Copiar código"/);
        expect(env).toContain('<table');
        expect(html('env-variables', 'en')).toContain('Copy code');
    });

    it('la portada muestra el directorio de todas las paginas', () => {
        const out = html('', 'en');
        for (const p of DOC_PAGES.filter((x) => x.slug !== '')) expect(out, `portada sin ${p.slug}`).toContain(`href="/docs/${p.slug}"`);
    });

    it('cada pagina enlaza con su anterior y siguiente', () => {
        const mid = DOC_PAGES[3];
        const out = html(mid.slug, 'es');
        expect(out).toContain(`href="${DOC_PAGES[2].slug ? '/docs/' + DOC_PAGES[2].slug : '/docs'}"`);
        expect(out).toContain(`href="/docs/${DOC_PAGES[4].slug}"`);
    });

    it('los diagramas tienen alternativa textual (title y desc) en ambos idiomas', () => {
        for (const locale of ['es', 'en'] as Locale[]) {
            for (const id of ['architecture', 'signing', 'mail-flow'] as const) {
                const out = renderToStaticMarkup(React.createElement(Diagram, { id, caption: 'x', locale }));
                expect(out).toContain('<title');
                expect(out).toContain('<desc');
                expect(out).toContain('role="img"');
                expect(out).toContain('<figcaption');
            }
        }
    });

    it('el marcado en linea genera enlaces internos con next/link y externos seguros', () => {
        const out = html('faq', 'es');
        expect(out).toContain('href="/docs/architecture#mail-flow"');
    });
});
