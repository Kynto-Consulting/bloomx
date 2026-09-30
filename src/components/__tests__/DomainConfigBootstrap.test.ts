import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DomainConfigBootstrap, isUsableInitialConfig } from '@/components/DomainConfigBootstrap';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useLandingConfig } from '@/hooks/useLandingConfig';

function Probe() {
    const { config } = useDomainConfig();
    const { landing } = useLandingConfig();
    return React.createElement('div', null, `${config.displayName}|${config.logo ?? ''}|${landing.hero?.title ?? ''}|${landing.layout ?? ''}`);
}

describe('DomainConfigBootstrap: la landing y la marca salen en el PRIMER HTML del servidor (sin parpadeo)', () => {
    it('con config del servidor, el render inicial ya trae empresa y landing', () => {
        const html = renderToString(React.createElement(DomainConfigBootstrap, {
            initial: { config: { name: 'acme.com', displayName: 'Acme', logo: 'https://cdn.acme.com/l.png', theme: { landing: { layout: 'center', hero: { title: 'Bienvenido a Acme' } } } } },
            children: React.createElement(Probe),
        }));
        expect(html).toContain('Acme|https://cdn.acme.com/l.png|Bienvenido a Acme|center');
    });
    it('sin config del servidor (fetch fallo) cae al comportamiento de cliente: valores por defecto', () => {
        const html = renderToString(React.createElement(DomainConfigBootstrap, { initial: null, children: React.createElement(Probe) }));
        expect(html).not.toContain('Acme');
        expect(html).toContain('Bloom');
    });
    it('landing hostil en la config del servidor se re-sanea en el cliente', () => {
        const html = renderToString(React.createElement(DomainConfigBootstrap, {
            initial: { config: { name: 'x', displayName: 'X', logo: null, theme: { landing: { hero: { title: '<script>alert(1)</script>Hola' } } } } },
            children: React.createElement(Probe),
        }));
        expect(html).not.toContain('<script>');
    });
});

describe('DomainConfigBootstrap: un fallo del servidor no fija una empresa vacia', () => {
    it('isUsableInitialConfig solo acepta una empresa con nombre', () => {
        expect(isUsableInitialConfig({ config: { name: 'acme.com', displayName: '', logo: null, theme: {} } })).toBe(true);
        expect(isUsableInitialConfig({ config: { name: '', displayName: 'Acme' } })).toBe(true);
        for (const bad of [null, undefined, {}, { config: null }, { config: [] }, { config: {} }, { config: { name: '', displayName: '   ' } }, { config: { name: 5 } }, 'x', []]) {
            expect(isUsableInitialConfig(bad as any), JSON.stringify(bad)).toBe(false);
        }
    });

    it('un initial vacio o malformado NO se precarga: se ven los valores por defecto (no una empresa sin nombre)', () => {
        for (const initial of [{ config: {} }, { config: { name: '', displayName: '', logo: null, theme: {} } }, { config: null }] as any[]) {
            const html = renderToString(React.createElement(DomainConfigBootstrap, { initial, children: React.createElement(Probe) }));
            expect(html).toContain('Bloom');
        }
    });

    it('la precarga nunca trae lista de extensiones: extensionsLoaded=false hasta que llega /api/config (no es "sin extensiones")', () => {
        function Flags() {
            const { extensionsLoaded, isError, extensions } = useDomainConfig();
            return React.createElement('div', null, `${extensionsLoaded}|${isError}|${extensions.length}`);
        }
        const html = renderToString(React.createElement(DomainConfigBootstrap, {
            initial: { config: { name: 'acme.com', displayName: 'Acme', logo: null, theme: {} } },
            children: React.createElement(Flags),
        }));
        expect(html).toContain('false|false|0');
    });
});
