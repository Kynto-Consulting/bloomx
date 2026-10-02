// @vitest-environment jsdom
// Notas de version en el detalle del marketplace: es/en, texto plano, fallback sin notas y destaque de la ultima/instalada.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

let currentLocale = 'es';
vi.mock('@/components/I18nProvider', () => ({
    useI18n: () => ({ t: (k: string) => k.split('.').pop(), locale: currentLocale, intlLocale: currentLocale }),
}));
vi.mock('@/components/expansions/ExtensionIcon', () => ({ ExtensionIcon: () => null }));

import { sanitizeMarket, versionNotes } from '@/lib/admin/marketplace/market-meta';
import { VersionsTab } from '../market/DetailMarket';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const history = [
    { version: '1.0.1', status: 'published', date: '2026-10-01', compatible: true, notes: ['Corrige el envío.'], notesI18n: { es: 'Corrige el envío.', en: 'Fixes sending.' } },
    { version: '1.0.0', status: 'published', date: '2026-09-01', compatible: true, notes: [] },
];
const market = sanitizeMarket({ publisher: { id: 'bloomx', name: 'Bloomx' }, history }, 'core-demo')!;
const row = (patch: Record<string, unknown> = {}) => ({ id: 'core-demo', version: '1.0.1', latestVersion: '1.0.1', installedVersion: null, incompatible: false, market, ...patch }) as any;

async function render(r: any, locale = 'es') {
    currentLocale = locale;
    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => { createRoot(host).render(React.createElement(VersionsTab, { row: r })); });
    return host;
}

describe('versionNotes / sanitizeMarket', () => {
    it('elige el idioma de la interfaz y cae a la lista antigua sin notesI18n', () => {
        const h = market.history[0];
        expect(versionNotes(h, 'es')).toEqual(['Corrige el envío.']);
        expect(versionNotes(h, 'en')).toEqual(['Fixes sending.']);
        expect(versionNotes({ notes: ['Del manifest'] }, 'en')).toEqual(['Del manifest']);
        expect(versionNotes(market.history[1], 'es')).toEqual([]);
    });
    it('descarta notas con HTML crudo y acota el tamano', () => {
        const m = sanitizeMarket({ history: [{ version: '1.0.0', notesI18n: { es: '<img src=x onerror=alert(1)>', en: 'x'.repeat(5000) } }] }, 'core-demo')!;
        expect(m.history[0].notesI18n?.es.length).toBeLessThanOrEqual(1000);
        expect(m.history[0].notesI18n?.es).not.toContain('<');
    });
});

describe('VersionsTab', () => {
    it('muestra las notas en el idioma activo y mantiene el fallback para versiones sin notas', async () => {
        const es = await render(row());
        expect(es.textContent).toContain('Corrige el envío.');
        expect(es.textContent).toContain('noNotes');
        const en = await render(row(), 'en');
        expect(en.textContent).toContain('Fixes sending.');
    });
    it('destaca la ultima y la instalada, no las demas', async () => {
        const host = await render(row({ installedVersion: '1.0.0' }));
        const items = Array.from(host.querySelectorAll('li[data-featured]')).map((li) => li.textContent);
        expect(items).toHaveLength(2);
        const only = await render(row());
        expect(only.querySelectorAll('li[data-featured]')).toHaveLength(1);
        expect(only.querySelector('li[data-featured]')?.textContent).toContain('v1.0.1');
    });
    it('renderiza el HTML como texto, nunca como marcado', async () => {
        const evil = sanitizeMarket({ history: [{ version: '1.0.1', notes: ['<b>x</b>'] }] }, 'core-demo')!;
        const host = await render(row({ market: evil }));
        expect(host.querySelector('b')).toBeNull();
    });
});
