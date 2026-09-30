// @vitest-environment jsdom
/**
 * Insignia "Externo" (fila), aviso de remitente externo del lector (estilos, texto plano, primera vez, cierre por mensaje,
 * "Confio en este remitente" y su ausencia ante suplantacion) y la cache compartida de la politica.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/components/I18nProvider';
import { click, flush, installCleanup, kitSuite, mount, q, qa } from '@/components/expansions/kit/__tests__/harness';
import { ExternalBadge, useRowExternal } from '../ExternalBadge';
import { ExternalSenderBanner } from '../ExternalSenderBanner';
import { classifyForDisplay, dismissKey, type ExternalPolicy } from '../external-display';
import { __resetExternalPolicyForTests, useExternalPolicy } from '../useExternalPolicy';

const basePolicy = (over: Partial<ExternalPolicy> = {}): ExternalPolicy => ({
    enabled: true, style: 'info', subjectTag: true, colleagueSpoof: true, firstTime: true, hardenLinks: false, hardenAttachments: false,
    text: { es: 'Texto ES <b>x</b>', en: 'Text EN' }, internalDomains: ['empresa.test'], trusted: [], ...over,
});
const wrap = (node: React.ReactElement, locale: 'es' | 'en' = 'es') => <I18nProvider locale={locale}>{node}</I18nProvider>;

let serverPolicy: ExternalPolicy | null;
let calls: Array<{ url: string; method: string; body: any }>;
beforeEach(() => {
    serverPolicy = basePolicy();
    calls = [];
    __resetExternalPolicyForTests();
    window.localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
        if (url === '/api/spam/external') return serverPolicy ? { ok: true, status: 200, json: async () => serverPolicy } : { ok: false, status: 401, json: async () => ({}) };
        if (url === '/api/spam/lists/external') return { ok: true, status: 200, json: async () => ({ added: 1 }) };
        return { ok: false, status: 404, json: async () => ({}) };
    }));
});
afterEach(() => vi.unstubAllGlobals());

function Row({ from, subject, skip }: { from: string; subject: string; skip?: boolean }) {
    const ext = useRowExternal(from, subject, { skip });
    return <div><ExternalBadge show={ext.show} style={ext.policy?.style} /><span id="subj">{ext.subject}</span><span id="sr">{ext.srLabel}</span></div>;
}

describe('insignia Externo en la fila', () => {
    installCleanup();

    it('sin datos (politica no cargada o peticion fallida) no muestra nada y el asunto queda igual', async () => {
        serverPolicy = null;
        await mount(wrap(<Row from="x@fuera.test" subject="Hola" />));
        await flush();
        expect(q('[data-external-badge]')).toBeNull();
        expect(q('#subj')!.textContent).toBe('Hola');
    });

    it('externo no confiable: insignia accesible (texto + tooltip) y asunto con etiqueta solo visual; una sola peticion compartida', async () => {
        await mount(wrap(<div><Row from="Prov <x@fuera.test>" subject="Factura" /><Row from="y@fuera.test" subject="Otra" /></div>));
        await flush();
        const badges = qa('[data-external-badge]');
        expect(badges).toHaveLength(2);
        expect(badges[0].textContent).toContain('Externo');
        expect(badges[0].getAttribute('title')).toBe('Remitente de fuera de tu organización');
        expect(qa('#subj')[0].textContent).toBe('[EXTERNO] Factura');
        expect(q('svg[aria-hidden="true"]', badges[0])).toBeTruthy();
        expect(calls.filter((c) => c.url === '/api/spam/external')).toHaveLength(1);
    });

    it('en ingles usa la etiqueta [EXTERNAL]', async () => {
        await mount(wrap(<Row from="x@fuera.test" subject="Invoice" />, 'en'));
        await flush();
        expect(q('#subj')!.textContent).toBe('[EXTERNAL] Invoice');
        expect(q('[data-external-badge]')!.textContent).toContain('External');
    });

    it('interno, confiable, politica desactivada o carpeta de salida: nada', async () => {
        serverPolicy = basePolicy({ trusted: [{ t: 'domain', v: 'socio.test', s: false }] });
        await mount(wrap(<div><Row from="a@empresa.test" subject="A" /><Row from="b@socio.test" subject="B" /><Row from="c@fuera.test" subject="C" skip /></div>));
        await flush();
        expect(qa('[data-external-badge]')).toHaveLength(0);
        expect(qa('#subj').map((e) => e.textContent)).toEqual(['A', 'B', 'C']);
    });

    it('politica desactivada: nada', async () => {
        serverPolicy = basePolicy({ enabled: false });
        await mount(wrap(<Row from="x@fuera.test" subject="Hola" />));
        await flush();
        expect(q('[data-external-badge]')).toBeNull();
        expect(q('#subj')!.textContent).toBe('Hola');
    });

    it('sin etiqueta de asunto si la politica no la pide, y estilo warning en la insignia', async () => {
        serverPolicy = basePolicy({ subjectTag: false, style: 'warning' });
        await mount(wrap(<Row from="x@fuera.test" subject="Hola" />));
        await flush();
        expect(q('#subj')!.textContent).toBe('Hola');
        expect(q('[data-external-badge]')!.getAttribute('data-style')).toBe('warning');
    });
});

function Probe({ onPolicy }: { onPolicy: (p: ExternalPolicy | null) => void }) {
    onPolicy(useExternalPolicy());
    return null;
}

describe('cache compartida de la politica', () => {
    installCleanup();
    it('devuelve null hasta cargar y luego la politica; un fallo no la rompe', async () => {
        const seen: Array<ExternalPolicy | null> = [];
        await mount(wrap(<Probe onPolicy={(p) => seen.push(p)} />));
        expect(seen[0]).toBeNull();
        await flush();
        expect(seen[seen.length - 1]?.enabled).toBe(true);
    });
});

const bannerProps = (policy: ExternalPolicy | null, from: string, stored?: { colleagueSpoof?: boolean; firstTime?: boolean }, id = 'm1') => ({
    messageId: id, from, policy, verdict: classifyForDisplay(policy, from, null, stored),
});

describe('ExternalSenderBanner', () => {
    installCleanup();

    it('externo no confiable: region con titulo, texto de la organizacion como TEXTO PLANO y estilo info', async () => {
        await mount(wrap(<ExternalSenderBanner {...bannerProps(basePolicy(), 'Prov <x@fuera.test>')} />));
        const b = q('[data-external-banner]')!;
        expect(b.getAttribute('role')).toBe('region');
        expect(b.getAttribute('data-variant')).toBe('info');
        expect(b.className).toContain('border-info');
        expect(document.getElementById(b.getAttribute('aria-labelledby')!)!.textContent).toBe('Remitente externo');
        const notice = q('[data-notice-text]')!;
        expect(notice.textContent).toBe('Texto ES <b>x</b>');
        expect(notice.querySelector('b')).toBeNull();
    });

    it('estilo warning por tokens y texto en ingles', async () => {
        await mount(wrap(<ExternalSenderBanner {...bannerProps(basePolicy({ style: 'warning' }), 'x@fuera.test')} />, 'en'));
        const b = q('[data-external-banner]')!;
        expect(b.getAttribute('data-variant')).toBe('warning');
        expect(b.className).toContain('border-warning');
        expect(q('[data-notice-text]')!.textContent).toBe('Text EN');
    });

    it('interno, confiable o politica desactivada: no pinta nada', async () => {
        const trusted = basePolicy({ trusted: [{ t: 'email', v: 'x@socio.test', s: false }] });
        await mount(wrap(<div><ExternalSenderBanner {...bannerProps(basePolicy(), 'a@empresa.test')} /><ExternalSenderBanner {...bannerProps(trusted, 'x@socio.test')} /><ExternalSenderBanner {...bannerProps(null, 'x@fuera.test')} /><ExternalSenderBanner {...bannerProps(basePolicy({ enabled: false }), 'x@fuera.test')} /></div>));
        expect(q('[data-external-banner]')).toBeNull();
    });

    it('primera vez: solo aparece cuando el veredicto lo trae', async () => {
        const m = await mount(wrap(<ExternalSenderBanner {...bannerProps(basePolicy(), 'x@fuera.test')} />));
        expect(q('[data-first-time]')).toBeNull();
        await m.render(wrap(<ExternalSenderBanner {...bannerProps(basePolicy(), 'x@fuera.test', { firstTime: true })} />));
        expect(q('[data-first-time]')!.textContent).toContain('primera vez');
        await m.render(wrap(<ExternalSenderBanner {...bannerProps(basePolicy({ firstTime: false }), 'x@fuera.test', { firstTime: true })} />));
        expect(q('[data-first-time]')).toBeNull();
    });

    it('suplantacion de companero: aviso reforzado y SIN boton de confianza', async () => {
        await mount(wrap(<ExternalSenderBanner {...bannerProps(basePolicy(), 'Soporte empresa.test <x@fuera.test>')} />));
        const b = q('[data-external-banner]')!;
        expect(b.getAttribute('data-variant')).toBe('spoof');
        expect(b.textContent).toContain('Posible suplantación de un compañero');
        expect(q('[data-spoof-text]')!.textContent).toContain('x@fuera.test');
        expect(q('[data-trust-open]')).toBeNull();
    });

    it('suplantacion aunque el remitente este en la whitelist: sigue el aviso y no se ofrece confiar', async () => {
        const p = basePolicy({ trusted: [{ t: 'domain', v: 'fuera.test', s: false }] });
        await mount(wrap(<ExternalSenderBanner {...bannerProps(p, 'Laura Gomez <l@fuera.test>', { colleagueSpoof: true })} />));
        expect(q('[data-external-banner]')!.getAttribute('data-variant')).toBe('spoof');
        expect(q('[data-trust-open]')).toBeNull();
    });

    it('cierre POR MENSAJE: se recuerda en localStorage con clave por id y no afecta a otro mensaje', async () => {
        const m = await mount(wrap(<ExternalSenderBanner {...bannerProps(basePolicy(), 'x@fuera.test', undefined, 'm1')} />));
        const close = qa('button').find((b) => b.getAttribute('aria-label') === 'Cerrar este aviso')!;
        await click(close);
        expect(q('[data-external-banner]')).toBeNull();
        expect(window.localStorage.getItem(dismissKey('m1'))).toBe('1');
        expect(window.localStorage.getItem(dismissKey('m2'))).toBeNull();
        // otro mensaje del hilo: sigue mostrando su aviso
        await m.render(wrap(<ExternalSenderBanner {...bannerProps(basePolicy(), 'x@fuera.test', undefined, 'm2')} />));
        expect(q('[data-external-banner]')).toBeTruthy();
        // y al volver a montar m1 sigue cerrado
        await m.render(wrap(<ExternalSenderBanner {...bannerProps(basePolicy(), 'x@fuera.test', undefined, 'm1')} />));
        expect(q('[data-external-banner]')).toBeNull();
    });

    it('localStorage bloqueado no rompe el cierre', async () => {
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        await mount(wrap(<ExternalSenderBanner {...bannerProps(basePolicy(), 'x@fuera.test')} />));
        expect(q('[data-external-banner]')).toBeTruthy();
        await click(qa('button').find((b) => b.getAttribute('aria-label') === 'Cerrar este aviso')!);
        expect(q('[data-external-banner]')).toBeNull();
        spy.mockRestore(); get.mockRestore();
    });

    it('"Confio en este remitente": por defecto la direccion; POST a la lista external y refresca la politica', async () => {
        await mount(wrap(<ExternalSenderBanner {...bannerProps(basePolicy(), 'Prov <Ventas@Fuera.test>')} />));
        await click(q('[data-trust-open]'));
        const radios = qa<HTMLInputElement>('input[type="radio"]');
        expect(radios).toHaveLength(2);
        expect(radios[0].checked).toBe(true);
        await click(q('[data-trust-confirm]'));
        await flush();
        const post = calls.find((c) => c.url === '/api/spam/lists/external')!;
        expect(post.method).toBe('POST');
        expect(post.body).toEqual({ entries: [{ matchType: 'email', value: 'ventas@fuera.test' }] });
        expect(calls.some((c) => c.url === '/api/spam/external')).toBe(true);
        expect(q('[data-external-trusted]')!.getAttribute('role')).toBe('status');
    });

    it('elegir el dominio envia matchType domain', async () => {
        await mount(wrap(<ExternalSenderBanner {...bannerProps(basePolicy(), 'x@fuera.test')} />));
        await click(q('[data-trust-open]'));
        await click(qa<HTMLInputElement>('input[type="radio"]')[1]);
        await click(q('[data-trust-confirm]'));
        await flush();
        expect(calls.find((c) => c.url === '/api/spam/lists/external')!.body).toEqual({ entries: [{ matchType: 'domain', value: 'fuera.test' }] });
    });

    it('si el servidor rechaza, muestra un error accesible y no declara confianza', async () => {
        (globalThis.fetch as any).mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
        await mount(wrap(<ExternalSenderBanner {...bannerProps(basePolicy(), 'x@fuera.test')} />));
        await click(q('[data-trust-open]'));
        await click(q('[data-trust-confirm]'));
        await flush();
        expect(q('[role="alert"]')!.textContent).toContain('No se pudo');
        expect(q('[data-external-trusted]')).toBeNull();
    });

    it('todos los botones tienen nombre accesible', async () => {
        await mount(wrap(<ExternalSenderBanner {...bannerProps(basePolicy(), 'x@fuera.test')} />));
        await click(q('[data-trust-open]'));
        for (const b of qa('button')) expect((b.getAttribute('aria-label') || b.textContent || '').trim().length, b.outerHTML).toBeGreaterThan(0);
    });
});

kitSuite('ExternalSenderBanner (temas)', () => wrap(
    <div>
        <ExternalSenderBanner {...bannerProps(basePolicy(), 'x@fuera.test', { firstTime: true }, 'k1')} />
        <ExternalSenderBanner {...bannerProps(basePolicy({ style: 'warning' }), 'x@fuera.test', undefined, 'k2')} />
        <ExternalSenderBanner {...bannerProps(basePolicy(), 'Soporte empresa.test <x@fuera.test>', undefined, 'k3')} />
        <ExternalBadge show style="info" /><ExternalBadge show style="warning" />
    </div>,
));
