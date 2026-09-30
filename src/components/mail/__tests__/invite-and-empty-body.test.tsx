// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/I18nProvider', () => ({ useI18n: () => ({ t: (k: string) => k, locale: 'es' }) }));
vi.mock('@/components/MeetingProviderIcon', () => ({ MeetingProviderIcon: () => null }));

import { InviteCard } from '../InviteCard';
import { isLegacyEmptyPlaceholder, looksLikeAuthReport, EMPTY_BODY_MARKER_HTML } from '@/lib/mail-empty-body';
import { DEFAULT_MAIL_DARK_MODE, MAIL_DARK_MODES } from '@/lib/themes';
import { click, installCleanup, mount, q, qa } from '../../expansions/kit/__tests__/harness';

installCleanup();
const h = React.createElement;
const root = join(process.cwd(), 'src');
const invite = { title: 'Reunion', startsAt: '2026-01-01T10:00:00Z', endsAt: null, location: null } as any;
const join1 = { kind: 'join', url: 'https://meet.google.com/abc-defg-hij', providerName: 'Google Meet', provider: 'google-meet' } as any;

describe('InviteCard', () => {
    it('usa superficie neutra, tokens (sin colores crudos) y botones de respuesta en grupo', async () => {
        const onRespond = vi.fn();
        await mount(h(InviteCard, { invite, response: { response: 'accepted' }, joinLink: join1, whenText: '1 ene', busy: false, calendarBusy: false, onRespond, onAddToCalendar: vi.fn() }));
        const card = q('[data-invite-card]')!;
        expect(card.className).toContain('bg-card');
        expect(card.className).not.toMatch(/bg-primary\/10|#[0-9a-f]{3,6}|rgb\(/i);
        const buttons = qa('[role="group"] button');
        expect(buttons).toHaveLength(3);
        expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
        expect(buttons[0].className).toContain('text-success-foreground');
        expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
        await click(buttons[2]);
        expect(onRespond).toHaveBeenCalledWith('declined');
    });
    it('Agregar al calendario no parte el texto en dos lineas', async () => {
        await mount(h(InviteCard, { invite, joinLink: join1, whenText: '', busy: false, calendarBusy: false, onRespond: vi.fn(), onAddToCalendar: vi.fn() }));
        const btn = qa('button').find((b) => b.textContent?.includes('mailView.invite.addToCalendar'))!;
        expect(btn.className).toContain('whitespace-nowrap');
    });
});

describe('correos sin cuerpo', () => {
    it('detecta el placeholder heredado y el marcador nuevo no lo es', () => {
        expect(isLegacyEmptyPlaceholder('<p>The email provider did not include the message body.</p>')).toBe(true);
        expect(isLegacyEmptyPlaceholder(EMPTY_BODY_MARKER_HTML)).toBe(false);
    });
    it('reconoce informes DMARC / TLS-RPT con adjunto', () => {
        const zip = [{ filename: 'google.com!x.com!1!2.zip', mimeType: 'application/zip' }];
        expect(looksLikeAuthReport('Report domain: x.com Submitter: google.com Report-ID: 1', zip)).toBe(true);
        expect(looksLikeAuthReport('DMARC Aggregate Report', [{ filename: 'r.xml.gz' }])).toBe(true);
        expect(looksLikeAuthReport('Hola', zip)).toBe(false);
        expect(looksLikeAuthReport('Report domain: x.com', [])).toBe(false);
    });
    it('el webhook ya no guarda texto en ingles', () => {
        expect(readFileSync(join(root, 'app/api/webhooks/resend/route.ts'), 'utf8')).not.toContain('Content Unavailable');
    });
});

describe('correos en modo oscuro', () => {
    it('por defecto oscurece (invert) y las etiquetas no recomiendan papel', () => {
        expect(DEFAULT_MAIL_DARK_MODE).toBe('invert');
        expect(MAIL_DARK_MODES.find((m) => m.id === 'paper')!.description).not.toMatch(/fiel/i);
        const provider = readFileSync(join(root, 'components/ThemeProvider.tsx'), 'utf8');
        expect(provider).not.toMatch(/MailDarkMode>\('paper'\)/);
    });
});

describe('alto del shell (sin franja vacia)', () => {
    it('AppShell usa app-viewport (100vh + 100dvh) y no h-screen; html/body no scrollean con el shell', () => {
        const shell = readFileSync(join(root, 'components/layout/AppShell.tsx'), 'utf8');
        expect(shell).not.toMatch(/\bh-screen\b/);
        expect(shell.match(/app-viewport/g)!.length).toBeGreaterThanOrEqual(2);
        const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
        expect(css).toMatch(/\.app-viewport\s*\{[^}]*height:\s*100vh;[^}]*height:\s*100dvh;/);
        expect(css).toMatch(/html:has\(\[data-app-shell\]\)[\s\S]*overflow:\s*hidden/);
    });
});
