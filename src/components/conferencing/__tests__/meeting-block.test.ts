// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMeetingBlockHtml, escapeHtml } from '../meeting-block';
import { JoinMeetingButton } from '../JoinMeetingButton';
import { ComposerConferencingPanel, type ComposerInsertion } from '../ComposerConferencingPanel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const labels = { join: 'Unirse', meetingId: 'ID de reunión', passcode: 'Código', dialIn: 'Marcación', when: 'Fecha' };
const meeting = { provider: 'zoom', joinUrl: 'https://us02web.zoom.us/j/123456789', meetingId: '123456789', providerName: 'Zoom', passcode: 'p4ss', dialIn: [{ number: '+51 1 700 9999', country: 'PE' }] } as const;

describe('buildMeetingBlockHtml', () => {
    it('incluye boton Unirse, datos de marcacion y NO usa colores ni estilos propios', () => {
        const html = buildMeetingBlockHtml({ meeting: meeting as any, labels, topic: 'Plan Q4', startsAt: new Date('2026-10-01T15:00:00Z'), endsAt: new Date('2026-10-01T16:00:00Z'), timeZone: 'UTC', locale: 'es' });
        expect(html).toContain('<a href="https://us02web.zoom.us/j/123456789" target="_blank" rel="noopener noreferrer"><strong>Unirse</strong></a>');
        expect(html).toContain('Zoom: Plan Q4');
        expect(html).toContain('ID de reunión: 123456789');
        expect(html).toContain('Código: p4ss');
        expect(html).toContain('+51 1 700 9999 (PE)');
        expect(html).toContain('Fecha:');
        expect(html).not.toMatch(/style=|color|#[0-9a-f]{3,6}\b/i);
    });

    it('escapa HTML y no emite enlaces inseguros', () => {
        expect(escapeHtml('<b>"x"&\'</b>')).toBe('&lt;b&gt;&quot;x&quot;&amp;&#39;&lt;/b&gt;');
        const html = buildMeetingBlockHtml({ meeting: { ...meeting, providerName: '<img src=x onerror=1>' } as any, labels, topic: '<script>alert(1)</script>' });
        expect(html).not.toContain('<script');
        expect(html).not.toContain('<img');
        expect(buildMeetingBlockHtml({ meeting: { ...meeting, joinUrl: 'javascript:alert(1)' } as any, labels })).toBe('');
        expect(buildMeetingBlockHtml({ meeting: { ...meeting, joinUrl: 'http://zoom.us/j/1' } as any, labels })).toBe('');
    });

    it('sin fecha no hay linea de fecha', () => {
        expect(buildMeetingBlockHtml({ meeting: meeting as any, labels })).not.toContain('Fecha:');
    });
});

describe('JoinMeetingButton', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });
    const render = async (el: React.ReactElement) => {
        await act(async () => {
            root.render(el);
        });
    };

    it('enlace reconocido: boton seguro con icono del proveedor', async () => {
        await render(React.createElement(JoinMeetingButton, { url: 'https://meet.google.com/abc-defg-hij' }));
        const a = container.querySelector('a')!;
        expect(a.getAttribute('href')).toBe('https://meet.google.com/abc-defg-hij');
        expect(a.getAttribute('rel')).toBe('noopener noreferrer');
        expect(a.getAttribute('aria-label')).toBe('Unirse a la reunión de Google Meet');
        expect(a.textContent).toBe('Unirse a la reunión'); // el icono no aporta texto
        expect(a.querySelector('[data-provider-icon]')?.getAttribute('data-provider-icon')).toBe('google-meet');
    });

    it('enlaces no reconocidos o inseguros no generan boton', async () => {
        for (const url of ['https://example.com/room', 'http://zoom.us/j/1', 'javascript:alert(1)', 'https://zoom.us.evil.com/j/1', 'Sala 3', '']) {
            await render(React.createElement(JoinMeetingButton, { url }));
            expect(container.querySelector('a'), String(url)).toBeNull();
        }
    });
});

describe('ComposerConferencingPanel', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        const provider = { id: 'zoom', name: 'Zoom', icon: 'zoom', configured: true, connected: true, mode: 'server-to-server', source: 'instance', origin: 'extension' };
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                if (String(url).endsWith('/providers')) return new Response(JSON.stringify({ providers: [provider] }), { status: 200 });
                return new Response(
                    JSON.stringify({ meeting: { provider: 'zoom', joinUrl: 'https://zoom.us/j/55', meetingId: '55', providerName: 'Zoom', attachment: { filename: 'invite.ics', content: 'QkVHSU4=' } } }),
                    { status: 200 },
                );
            }),
        );
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
    });
    const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    it('al crear devuelve el bloque HTML y el adjunto ICS de la extension, y se cierra', async () => {
        const onInsert = vi.fn<(i: ComposerInsertion) => void>();
        const onClose = vi.fn();
        await act(async () => {
            root.render(React.createElement(ComposerConferencingPanel, { provider: 'zoom', subject: 'Kickoff', recipients: ['ana@x.com'], onInsert, onClose }));
        });
        await tick();
        await tick();
        const create = Array.from(container.querySelectorAll('button')).find((b) => /Crear reunión/.test(b.textContent || ''))!;
        await act(async () => {
            create.click();
        });
        await tick();
        expect(onInsert).toHaveBeenCalledTimes(1);
        const insertion = onInsert.mock.calls[0][0];
        expect(insertion.html).toContain('href="https://zoom.us/j/55"');
        expect(insertion.html).toContain('Kickoff');
        expect(insertion.attachment).toEqual({ filename: 'invite.ics', content: 'QkVHSU4=' });
        expect(onClose).toHaveBeenCalled();
        expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Reunión de Zoom');
    });
});
