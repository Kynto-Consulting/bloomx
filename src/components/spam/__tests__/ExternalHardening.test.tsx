// @vitest-environment jsdom
/**
 * Endurecimiento de externos no confiables: confirmacion antes de abrir enlaces que salen del dominio del remitente (script del
 * documento aislado + mensaje al lector + dialogo accesible) y aviso antes de descargar adjuntos.
 */
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/components/I18nProvider';
import { click, flush, installCleanup, mount, q, qa } from '@/components/expansions/kit/__tests__/harness';
import { SafeIframe } from '@/components/ui/SafeIframe';
import { AttachmentList } from '@/components/mail/AttachmentList';
import { __resetExternalPolicyForTests } from '../useExternalPolicy';
import { __resetSpamExplainForTests } from '../useSpamExplain';
import { useMessageSpam } from '../useMessageSpam';
import type { ExternalPolicy } from '../external-display';

const policy = (over: Partial<ExternalPolicy> = {}): ExternalPolicy => ({
    enabled: true, style: 'info', subjectTag: false, colleagueSpoof: true, firstTime: false, hardenLinks: true, hardenAttachments: true,
    text: { es: '', en: '' }, internalDomains: ['empresa.test'], trusted: [], ...over,
});
const wrap = (node: React.ReactElement) => <I18nProvider locale="es">{node}</I18nProvider>;

let serverPolicy: ExternalPolicy;
beforeEach(() => {
    serverPolicy = policy();
    __resetExternalPolicyForTests();
    __resetSpamExplainForTests();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url === '/api/spam/external') return { ok: true, status: 200, json: async () => serverPolicy };
        return { ok: false, status: 404, json: async () => ({}) }; // sin veredicto guardado
    }));
});
afterEach(() => vi.unstubAllGlobals());

/** Ejecuta el script del documento aislado con un window/document falsos y devuelve lo que envia al padre y el manejador de click. */
function runIframeScript(srcDoc: string) {
    const m = srcDoc.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)!;
    const listeners: Record<string, Array<(e: any) => void>> = {};
    const posted: any[] = [];
    const fakeDoc = {
        getElementById: () => null,
        addEventListener: (t: string, cb: (e: any) => void) => { (listeners[t] ||= []).push(cb); },
        fonts: undefined,
    };
    const fakeWin = { parent: { postMessage: (d: any) => posted.push(d) }, addEventListener: () => undefined, ResizeObserver: undefined };
    new Function('window', 'document', 'setInterval', 'setTimeout', m[1])(fakeWin, fakeDoc, () => 0, () => 0);
    const click = (href: string, type: 'click' | 'auxclick' = 'click') => {
        const anchor: any = { href, target: '', rel: '' };
        const ev: any = { target: { closest: () => anchor }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        (listeners[type] || []).forEach((cb) => cb(ev));
        return { ev, anchor };
    };
    return { posted, click };
}

async function mountIframe(guard: { senderDomain: string } | null, onGuardedLink?: (h: string) => void) {
    const m = await mount(wrap(<SafeIframe html={'<p><a href="https://evil.test/login?x=1">entrar</a></p>'} linkGuard={guard} onGuardedLink={onGuardedLink} />));
    await flush();
    const iframe = q<HTMLIFrameElement>('iframe', m.container)!;
    return { m, iframe, srcDoc: iframe.getAttribute('srcdoc') || (iframe as any).srcdoc as string };
}

describe('guardia de enlaces en el documento aislado', () => {
    installCleanup();

    it('sin linkGuard el documento no intercepta nada (comportamiento actual intacto)', async () => {
        const { srcDoc } = await mountIframe(null);
        expect(srcDoc).toContain('var GUARD = null;');
        const r = runIframeScript(srcDoc);
        const { ev, anchor } = r.click('https://evil.test/x');
        expect(ev.defaultPrevented).toBe(false);
        expect(anchor.target).toBe('_blank');
        expect(r.posted.filter((p) => p.type === 'bloomx-link')).toEqual([]);
    });

    it('con linkGuard: un enlace a otro dominio registrable se detiene y se avisa al lector con el destino completo', async () => {
        const { srcDoc } = await mountIframe({ senderDomain: 'mail.prov.test' });
        expect(srcDoc).toContain('"sender":"prov.test"');
        const r = runIframeScript(srcDoc);
        const { ev } = r.click('https://evil.test/login?x=1');
        expect(ev.defaultPrevented).toBe(true);
        expect(r.posted.find((p) => p.type === 'bloomx-link')).toMatchObject({ href: 'https://evil.test/login?x=1' });
    });

    it('mismo dominio registrable (incluidos subdominios y www), mailto y enlaces internos pasan sin interceptar', async () => {
        const { srcDoc } = await mountIframe({ senderDomain: 'prov.test' });
        const r = runIframeScript(srcDoc);
        for (const href of ['https://www.prov.test/a', 'https://news.prov.test/b', 'mailto:a@evil.test', 'tel:123']) {
            expect(r.click(href).ev.defaultPrevented, href).toBe(false);
        }
        expect(r.posted.filter((p) => p.type === 'bloomx-link')).toEqual([]);
    });

    it('el clic central (auxclick) tambien se intercepta; sufijos de dos niveles se respetan (co.uk)', async () => {
        const { srcDoc } = await mountIframe({ senderDomain: 'a.co.uk' });
        const r = runIframeScript(srcDoc);
        expect(r.click('https://b.co.uk/x', 'auxclick').ev.defaultPrevented).toBe(true);
        expect(r.click('https://www.a.co.uk/x').ev.defaultPrevented).toBe(false);
    });

    it('el lector acepta el mensaje solo de SU iframe y con el token correcto', async () => {
        const seen: string[] = [];
        const { iframe, srcDoc } = await mountIframe({ senderDomain: 'prov.test' }, (h) => seen.push(h));
        const token = srcDoc.match(/var TOKEN = "([0-9a-f]+)"/)![1];
        const fire = async (data: any, source: any) => { await act(async () => { window.dispatchEvent(new MessageEvent('message', { data, source })); }); };
        await fire({ type: 'bloomx-link', token, href: 'https://evil.test/a' }, iframe.contentWindow);
        await fire({ type: 'bloomx-link', token: 'otro', href: 'https://evil.test/b' }, iframe.contentWindow);
        await fire({ type: 'bloomx-link', token, href: 'https://evil.test/c' }, window);
        await fire({ type: 'bloomx-link', token, href: 'javascript:alert(1)' }, iframe.contentWindow);
        expect(seen).toEqual(['https://evil.test/a']);
    });
});

function Msg({ from = 'Prov <x@fuera.test>', folder = 'inbox', own }: { from?: string; folder?: string; own?: Set<string> }) {
    const spam = useMessageSpam({ id: 'm1', from, folder, own, expanded: true });
    return (
        <div>
            <button type="button" id="go" onClick={() => spam.onGuardedLink('https://evil.test/login?token=abc#frag')}>go</button>
            <button type="button" id="same" onClick={() => spam.onGuardedLink('https://www.fuera.test/x')}>same</button>
            <span id="guard">{spam.linkGuard ? spam.linkGuard.senderDomain : 'none'}</span>
            <AttachmentList attachments={[{ id: 'a1', filename: 'factura.pdf', mimeType: 'application/zip', size: 10, url: '/api/assets/a1' }]} confirmDownload={spam.confirmDownload} />
            {spam.dialogs}
        </div>
    );
}

describe('dialogos de confirmacion (enlace y adjunto)', () => {
    installCleanup();

    it('externo no confiable: la guardia esta activa y el dialogo muestra el destino completo con Abrir/Cancelar', async () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        await mount(wrap(<Msg />));
        await flush();
        expect(q('#guard')!.textContent).toBe('fuera.test');
        await click(q('#go'));
        const dlg = q('[role="dialog"]')!;
        expect(dlg.getAttribute('aria-modal')).toBe('true');
        expect(q('[data-link-destination]')!.textContent).toBe('https://evil.test/login?token=abc#frag');
        expect(dlg.textContent).toContain('fuera.test');
        // cancelar: no abre nada
        await click(qa('button', dlg).find((b) => b.textContent === 'Cancelar')!);
        expect(q('[role="dialog"]')).toBeNull();
        expect(open).not.toHaveBeenCalled();
        // abrir: window.open con noopener
        await click(q('#go'));
        await click(qa('button', q('[role="dialog"]')!).find((b) => b.textContent === 'Abrir')!);
        expect(open).toHaveBeenCalledWith('https://evil.test/login?token=abc#frag', '_blank', 'noopener,noreferrer');
        expect(q('[role="dialog"]')).toBeNull();
        open.mockRestore();
    });

    it('un enlace del propio dominio del remitente no pregunta aunque llegue el aviso', async () => {
        await mount(wrap(<Msg />));
        await flush();
        await click(q('#same'));
        expect(q('[role="dialog"]')).toBeNull();
    });

    it('Escape cierra el dialogo de enlace sin abrir', async () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        await mount(wrap(<Msg />));
        await flush();
        await click(q('#go'));
        await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(q('[role="dialog"]')).toBeNull();
        expect(open).not.toHaveBeenCalled();
        open.mockRestore();
    });

    it('adjunto: la descarga pide confirmacion y solo al aceptar se dispara', async () => {
        const clicked: string[] = [];
        const orig = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { clicked.push(this.getAttribute('href') || ''); };
        await mount(wrap(<Msg />));
        await flush();
        const download = q<HTMLAnchorElement>('a[download]')!;
        const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
        await act(async () => { download.dispatchEvent(ev); });
        expect(ev.defaultPrevented).toBe(true);
        expect(clicked).toEqual([]);
        const dlg = q('[role="dialog"]')!;
        expect(dlg.textContent).toContain('factura.pdf');
        await click(qa('button', dlg).find((b) => b.textContent === 'Cancelar')!);
        expect(clicked).toEqual([]);
        await act(async () => { download.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
        await click(qa('button', q('[role="dialog"]')!).find((b) => b.textContent === 'Descargar')!);
        expect(clicked).toEqual(['/api/assets/a1']);
        HTMLAnchorElement.prototype.click = orig;
    });

    it('remitente interno o confiable: sin guardia (enlaces y adjuntos normales)', async () => {
        serverPolicy = policy({ trusted: [{ t: 'domain', v: 'fuera.test', s: false }] });
        await mount(wrap(<Msg />));
        await flush();
        expect(q('#guard')!.textContent).toBe('none');
        const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
        q<HTMLAnchorElement>('a[download]')!.addEventListener('click', (e) => e.preventDefault());
        await act(async () => { q('a[download]')!.dispatchEvent(ev); });
        expect(q('[role="dialog"]')).toBeNull();
    });

    it('politicas hardenLinks/hardenAttachments apagadas: sin guardia', async () => {
        serverPolicy = policy({ hardenLinks: false, hardenAttachments: false });
        await mount(wrap(<Msg />));
        await flush();
        expect(q('#guard')!.textContent).toBe('none');
    });

    it('mensaje propio o carpeta de salida: sin guardia', async () => {
        await mount(wrap(<Msg from="Yo <yo@fuera.test>" own={new Set(['yo@fuera.test'])} />));
        await flush();
        expect(q('#guard')!.textContent).toBe('none');
    });
});
