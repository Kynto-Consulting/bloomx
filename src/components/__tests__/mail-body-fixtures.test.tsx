// @vitest-environment jsdom
/**
 * Banco de fixtures de HTML de correo (src/lib/__tests__/fixtures/mail-html): renderiza ThreadMessage/SafeIframe con cada
 * uno y verifica la regla de oro (nunca un area vacia), el "…" solo cuando hay algo que plegar, la altura > 0 tras
 * cargar y que plegar/desplegar conserva la altura. Incluye la reproduccion del cuerpo en blanco reportado en produccion.
 */
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ThemeProvider', () => ({ useTheme: () => ({ scheme: 'light', mailDarkMode: 'paper', resolvedTheme: { id: 'light' } }) }));

import { ThreadMessage } from '../mail/ThreadMessage';
import { htmlHasVisibleContent, splitQuotedHtml, visibleTextLength } from '../mail/quoted-html';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { emptyPolicy } from '@/lib/remote-images';
import type { EmailDetails } from '../mail/reader-types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const FX_DIR = path.resolve(__dirname, '../../lib/__tests__/fixtures/mail-html');
const NAMES = fs.readdirSync(FX_DIR).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).sort();
const load = (name: string) => fs.readFileSync(path.join(FX_DIR, `${name}.html`), 'utf8');

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

function item(content: string, id = 'm1'): EmailDetails {
    return {
        email: { id, from: 'Juan Diego <gjuandiego213@ext.test>', to: 'tester@bloomx.test', subject: 'Reunion', createdAt: '2025-01-13T15:14:00Z', read: true, starred: false, folder: 'inbox', attachments: [], labels: [], snippet: 'extracto' },
        content,
    };
}

function renderMessage(content: string) {
    const noop = vi.fn();
    act(() => {
        root.render(React.createElement(ThreadMessage, {
            item: item(content), index: 0, expanded: true, wasUnread: false, imagePolicy: emptyPolicy(), onImagePolicy: noop, onToggle: noop,
            onReply: noop, onReplyAll: noop, onForward: noop, inviteBusy: false, calendarBusy: false, onInvite: noop, onAddToCalendar: noop,
            own: new Set<string>(), resolveJoin: () => ({ kind: 'none' }) as any,
        }));
    });
}

const iframe = () => host.querySelector('iframe') as HTMLIFrameElement | null;
const toggle = () => host.querySelector<HTMLElement>('[data-quote-toggle]');
const tokenOf = (f: HTMLIFrameElement) => /var TOKEN = "([0-9a-f]+)"/.exec(f.getAttribute('srcdoc') || '')?.[1] ?? '';
function contentOf(f: HTMLIFrameElement) {
    const d = new DOMParser().parseFromString(f.getAttribute('srcdoc') || '', 'text/html');
    return d.getElementById('content')!;
}
/** Simula el postMessage de altura que enviaria el documento del iframe. */
function sendHeight(f: HTMLIFrameElement, height: number, phase = 'tick') {
    act(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'bloomx-resize', token: tokenOf(f), height, phase }, source: f.contentWindow as any }));
    });
}

describe('fixtures: nunca un area en blanco', () => {
    it('hay fixtures', () => { expect(NAMES.length).toBeGreaterThanOrEqual(11); });

    it.each(NAMES)('%s: el documento del iframe siempre tiene contenido visible', (name) => {
        renderMessage(load(name));
        const f = iframe()!;
        expect(f).toBeTruthy();
        expect(host.querySelector('[data-mail-empty]')).toBeNull();
        expect(htmlHasVisibleContent(contentOf(f).innerHTML)).toBe(true);
        // Ningun control de UI suelto llega al documento
        expect(contentOf(f).querySelector('button,input,select,textarea,form,dialog,[role="button"]')).toBeNull();
        // La altura inicial es razonable (esqueleto) y luego sigue la medida real
        expect(parseInt(f.style.height, 10)).toBeGreaterThan(0);
        sendHeight(f, 240, 'load');
        expect(f.style.height).toBe('240px');
        expect(host.querySelector('[data-state="ready"]')).toBeTruthy();
    });

    it.each(NAMES)('%s: el "…" solo aparece si hay algo que plegar y el remanente es visible', (name) => {
        const clean = sanitizeHtml(load(name));
        const split = splitQuotedHtml(clean);
        renderMessage(load(name));
        if (split) {
            expect(toggle()).toBeTruthy();
            expect(visibleTextLength(new DOMParser().parseFromString(split.main, 'text/html').body)).toBeGreaterThan(0);
            expect(htmlHasVisibleContent(contentOf(iframe()!).innerHTML)).toBe(true);
        } else {
            expect(toggle()).toBeNull();
        }
    });

    it.each(NAMES)('%s: plegar/desplegar conserva la altura y muestra la cita', (name) => {
        if (!splitQuotedHtml(sanitizeHtml(load(name)))) return;
        renderMessage(load(name));
        const before = iframe()!;
        sendHeight(before, 180, 'load');
        const collapsedLen = contentOf(before).textContent!.length;
        act(() => { toggle()!.click(); });
        const after = iframe()!;
        expect(after.style.height).toBe('180px'); // no salta a 0 ni al minimo mientras llega la nueva medida
        expect(contentOf(after).textContent!.length).toBeGreaterThan(collapsedLen);
        expect(tokenOf(after)).not.toBe(tokenOf(before)); // remonte determinista: token e instancia nuevos
        sendHeight(after, 420, 'load');
        expect(after.style.height).toBe('420px');
        // un mensaje con el token viejo se ignora
        sendHeight(before, 5);
        expect(iframe()!.style.height).toBe('420px');
        act(() => { toggle()!.click(); });
        expect(contentOf(iframe()!).textContent!.length).toBe(collapsedLen);
    });
});

describe('reproduccion del cuerpo en blanco reportado', () => {
    it('remanente solo con <style>/<title>/oculto/ancho cero + cita: NO se pliega todo (antes dejaba el area vacia y un "…")', () => {
        const html = load('quote-remainder-invisible');
        const clean = sanitizeHtml(html);
        // El contador antiguo (textContent) veia "contenido": es la causa raiz.
        const tpl = document.createElement('template');
        tpl.innerHTML = clean;
        tpl.content.querySelectorAll('.gmail_quote').forEach((q) => q.remove());
        expect((tpl.content.textContent || '').replace(/\s+/g, '').length).toBeGreaterThan(0);
        // El nuevo criterio mide solo lo visible.
        expect(visibleTextLength(tpl.content)).toBe(0);
        expect(splitQuotedHtml(clean)).toBeNull();
        renderMessage(html);
        expect(toggle()).toBeNull();
        expect(contentOf(iframe()!).textContent).toContain('Reunión de seguimiento');
    });

    it('mensaje que es solo una cita: se muestra completo, sin ocultarlo dentro del iframe', () => {
        renderMessage(load('only-quote'));
        const f = iframe()!;
        expect(contentOf(f).textContent).toContain('únicamente una cita');
        expect(f.getAttribute('srcdoc')).not.toContain('gmail_quote_toggle');
        expect(f.getAttribute('srcdoc')).not.toContain("'Close'");
    });

    it('sin nada visible se muestra el extracto en vez de un area vacia', () => {
        renderMessage('<style>p{color:red}</style><div style="display:none">oculto</div><p>&#8203;</p><br>');
        expect(host.querySelector('[data-mail-empty]')?.textContent).toContain('extracto');
        expect(iframe()).toBeNull();
    });

    it('correo del reporte: sin botones Close ni controles, con el texto real y la cita plegada', () => {
        renderMessage(load('reported-close-buttons'));
        const c = contentOf(iframe()!);
        expect(c.textContent).toContain('Confirmo la reunión del jueves.');
        expect(c.textContent).toContain('Fin del mensaje real.');
        for (const word of ['Close', 'Cerrar', 'Cancel', 'Enviar', 'Zoom overlay', 'Diálogo']) expect(c.textContent).not.toContain(word);
        expect(toggle()).toBeTruthy();
    });
});

describe('estado de carga y error', () => {
    it('muestra esqueleto hasta la primera altura', () => {
        renderMessage('<p>Hola mundo, esto es un mensaje</p>');
        expect(host.querySelector('[data-state="loading"]')).toBeTruthy();
        expect(host.querySelector('[role="status"]')).toBeTruthy();
        sendHeight(iframe()!, 64, 'load');
        expect(host.querySelector('[data-state="ready"]')).toBeTruthy();
        expect(host.querySelector('[role="status"]')).toBeNull();
    });

    it('sin altura en el plazo: error con Reintentar y Ver texto plano (no blanco silencioso)', () => {
        vi.useFakeTimers();
        renderMessage('<p>Contenido que no llega a medirse</p>');
        act(() => { vi.advanceTimersByTime(5100); });
        const alert = host.querySelector('[data-mail-body-error]')!;
        expect(alert).toBeTruthy();
        const buttons = Array.from(alert.querySelectorAll('button')).map((b) => b.textContent);
        expect(buttons).toEqual(['Reintentar', 'Ver texto plano']);
        act(() => { (alert.querySelectorAll('button')[1] as HTMLElement).click(); });
        expect(host.querySelector('pre')?.textContent).toContain('Contenido que no llega a medirse');
        act(() => { (host.querySelectorAll('[data-mail-body-error] button')[0] as HTMLElement).click(); });
        const f = iframe()!;
        expect(f).toBeTruthy();
        expect(host.querySelector('[data-mail-body-error]')).toBeNull();
        sendHeight(f, 50, 'load');
        expect(host.querySelector('[data-state="ready"]')).toBeTruthy();
    });
});
