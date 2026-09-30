// @vitest-environment jsdom
/** Banner "Por que" del lector: motivos es/en con puntos, puntuacion/umbral, colapsable, No es spam y bloquear remitente/dominio. */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/components/I18nProvider';
import { click, flush, installCleanup, kitSuite, mount, q, qa } from '@/components/expansions/kit/__tests__/harness';
import { mailBus } from '@/components/mail/mail-bus';
import { SpamWhyBanner, shouldShowWhy } from '../SpamWhyBanner';
import { parseExplain, useSpamExplain, __resetSpamExplainForTests, type ExplainState, type SpamExplain } from '../useSpamExplain';

const wrap = (node: React.ReactElement, locale: 'es' | 'en' = 'es') => <I18nProvider locale={locale}>{node}</I18nProvider>;
const explain = (over: Partial<SpamExplain> = {}): ExplainState => ({
    status: 'ready',
    data: {
        scored: true, score: 72, threshold: 60, decision: 'spam', band: 'spam', allowed: false, external: false,
        signals: [
            { id: 'auth.spf_fail', weight: 18, es: 'Falló SPF: el servidor de envío no está autorizado por el dominio.', en: 'SPF failed: the sending server is not authorized by the domain.' },
            { id: 'content.lex.phishing', weight: 30, es: 'Frases típicas de phishing (verifica tu cuenta).', en: 'Typical phishing phrases (verify your account).' },
            { id: 'auth.arc_pass', weight: -4, es: 'Reenviado con cadena ARC válida (resta sospecha).', en: 'Forwarded with a valid ARC chain (reduces suspicion).' },
        ],
        ...over,
    },
});

let calls: Array<{ url: string; method: string; body: any }>;
beforeEach(() => {
    calls = [];
    __resetSpamExplainForTests();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
        if (url === '/api/spam/block') return { ok: true, status: 200, json: async () => ({ ok: true, added: 1, value: JSON.parse(init.body).target === 'domain' ? 'malo.test' : 'a@malo.test' }) };
        return { ok: false, status: 404, json: async () => ({}) };
    }));
});
afterEach(() => vi.unstubAllGlobals());

const banner = (over: Partial<React.ComponentProps<typeof SpamWhyBanner>> = {}, locale: 'es' | 'en' = 'es') =>
    wrap(<SpamWhyBanner emailId="e1" from="Malo <a@malo.test>" folder="spam" explain={explain()} onNotSpam={() => undefined} {...over} />, locale);

describe('SpamWhyBanner', () => {
    installCleanup();

    it('muestra los motivos en el idioma de la app ordenados por peso, con signo en los puntos, puntuacion y umbral', async () => {
        await mount(banner());
        const items = qa('[data-signal]');
        expect(items.map((i) => i.getAttribute('data-signal'))).toEqual(['content.lex.phishing', 'auth.spf_fail', 'auth.arc_pass']);
        expect(items[0].textContent).toContain('+30');
        expect(items[0].textContent).toContain('Frases típicas de phishing');
        expect(items[2].textContent).toContain('−4');
        expect(q('[data-why-score]')!.textContent).toBe('Puntuación 72 · umbral 60');
        expect(q('[data-why-decision]')!.textContent).toBe('Marcado como spam');
        expect(q('[aria-label="Motivos"]')).toBeTruthy();
    });

    it('en ingles usa los textos en', async () => {
        await mount(banner({}, 'en'));
        expect(q('[data-signal="auth.spf_fail"]')!.textContent).toContain('SPF failed');
        expect(q('[data-why-score]')!.textContent).toBe('Score 72 · threshold 60');
    });

    it('colapsable: aria-expanded y aria-controls; abierto por defecto solo en la carpeta spam', async () => {
        const m = await mount(banner());
        const toggle = q('button[aria-expanded]')!;
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(document.getElementById(toggle.getAttribute('aria-controls')!)!.hidden).toBe(false);
        await click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(document.getElementById(toggle.getAttribute('aria-controls')!)!.hidden).toBe(true);
        await m.render(banner({ folder: 'inbox', explain: explain({ decision: 'warned' }) }));
    });

    it('bandeja con decision warned: visible y cerrado; delivered en bandeja o sin veredicto: nada', async () => {
        await mount(banner({ folder: 'inbox', explain: explain({ decision: 'warned' }) }));
        expect(q('[data-spam-why]')!.getAttribute('data-decision')).toBe('warned');
        expect(q('button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('false');
        expect(shouldShowWhy('inbox', explain({ decision: 'delivered' }))).toBe(false);
        expect(shouldShowWhy('spam', explain({ decision: 'delivered' }))).toBe(true);
        expect(shouldShowWhy('spam', { status: 'ready', data: { scored: false } })).toBe(false);
        expect(shouldShowWhy('spam', { status: 'loading' })).toBe(false);
        expect(shouldShowWhy('spam', { status: 'error' })).toBe(false);
    });

    it('scored:false, cargando o error: no muestra nada', async () => {
        await mount(banner({ explain: { status: 'ready', data: { scored: false } } }));
        expect(q('[data-spam-why]')).toBeNull();
        await mount(banner({ explain: { status: 'loading' } }));
        await mount(banner({ explain: { status: 'error' } }));
        expect(q('[data-spam-why]')).toBeNull();
    });

    it('senal imp.allow_spoof: destaca "posible suplantacion"', async () => {
        const e = explain();
        if (e.status === 'ready') e.data.signals!.push({ id: 'imp.allow_spoof', weight: 40, es: 'Se hace pasar por una dirección permitida.', en: 'Pretends to be an allowed address.' });
        await mount(banner({ explain: e }));
        expect(q('[data-why-spoof]')!.textContent).toContain('Posible suplantación');
        expect(q('[data-why-spoof]')!.getAttribute('role')).toBe('note');
    });

    it('"No es spam" usa la accion existente del lector (solo en la carpeta spam)', async () => {
        const onNotSpam = vi.fn();
        await mount(banner({ onNotSpam }));
        await click(q('[data-why-notspam]'));
        expect(onNotSpam).toHaveBeenCalledTimes(1);
        expect(calls).toHaveLength(0);
        await mount(banner({ folder: 'inbox', explain: explain({ decision: 'warned' }), onNotSpam }));
        expect(qa('[data-why-notspam]')).toHaveLength(1); // solo el del primer banner
    });

    it('bloquear remitente / dominio: POST /api/spam/block con el cuerpo correcto y aviso de estado', async () => {
        const removed: string[][] = [];
        const off = mailBus.subscribe((ev) => { if (ev.type === 'remove') removed.push(ev.ids); });
        await mount(banner({ folder: 'inbox', explain: explain({ decision: 'warned' }) }));
        await click(q('[data-why-block="sender"]'));
        await flush();
        expect(calls[0]).toEqual({ url: '/api/spam/block', method: 'POST', body: { emailId: 'e1', target: 'sender' } });
        expect(q('[data-why-notice]')!.getAttribute('role')).toBe('status');
        expect(q('[data-why-notice]')!.textContent).toBe('Bloqueado: a@malo.test.');
        await click(q('[data-why-block="domain"]'));
        await flush();
        expect(calls[1].body).toEqual({ emailId: 'e1', target: 'domain' });
        expect(q('[data-why-notice]')!.textContent).toBe('Bloqueado: malo.test.');
        expect(removed).toEqual([['e1'], ['e1']]);
        off();
    });

    it('en la carpeta spam no retira la fila de la lista al bloquear, y un fallo muestra un alert', async () => {
        const removed: string[][] = [];
        const off = mailBus.subscribe((ev) => { if (ev.type === 'remove') removed.push(ev.ids); });
        await mount(banner());
        await click(q('[data-why-block="sender"]'));
        await flush();
        expect(removed).toEqual([]);
        (globalThis.fetch as any).mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
        await click(q('[data-why-block="domain"]'));
        await flush();
        expect(q('[data-why-notice]')!.getAttribute('role')).toBe('alert');
        off();
    });

    it('todos los botones tienen nombre accesible y el aviso de puntos no depende del color', async () => {
        await mount(banner());
        for (const b of qa('button')) expect((b.getAttribute('aria-label') || b.textContent || '').trim().length).toBeGreaterThan(0);
        for (const li of qa('[data-signal]')) expect(li.textContent).toMatch(/[+−]\d/);
    });
});

function Probe({ id, enabled, onState }: { id: string; enabled: boolean; onState: (s: ExplainState) => void }) {
    onState(useSpamExplain(id, enabled));
    return null;
}

describe('useSpamExplain (carga perezosa)', () => {
    installCleanup();
    it('no pide nada hasta estar habilitado; pide una vez por correo y cachea', async () => {
        (globalThis.fetch as any).mockImplementation(async (url: string) => { calls.push({ url, method: 'GET', body: undefined }); return { ok: true, status: 200, json: async () => ({ scored: true, score: 10, decision: 'warned', threshold: 50, signals: [{ id: 'x', weight: 10, es: 'a', en: 'b' }] }) }; });
        let last: ExplainState = { status: 'idle' };
        const m = await mount(<Probe id="z1" enabled={false} onState={(s) => { last = s; }} />);
        await flush();
        expect(calls).toHaveLength(0);
        await m.render(<Probe id="z1" enabled onState={(s) => { last = s; }} />);
        await flush();
        expect(calls.map((c) => c.url)).toEqual(['/api/emails/z1/spam']);
        expect(last.status).toBe('ready');
        await m.render(<Probe id="z1" enabled={false} onState={(s) => { last = s; }} />);
        await m.render(<Probe id="z1" enabled onState={(s) => { last = s; }} />);
        await flush();
        expect(calls).toHaveLength(1);
    });

    it('parseExplain tolera formas raras', () => {
        expect(parseExplain(null)).toBeNull();
        expect(parseExplain({ scored: false, folder: 'inbox' })).toMatchObject({ scored: false });
        const p = parseExplain({ scored: true, score: 'x', decision: 'otro', signals: [{ id: 1 }, { id: 'a', weight: 2, es: 'e', en: 'n' }] })!;
        expect(p.decision).toBe('delivered');
        expect(p.score).toBeUndefined();
        expect(p.signals).toHaveLength(1);
    });
});

kitSuite('SpamWhyBanner (temas)', () => wrap(
    <div>
        {banner()}
        {banner({ folder: 'inbox', explain: explain({ decision: 'warned' }) })}
    </div>,
));
