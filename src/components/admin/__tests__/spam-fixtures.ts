import { act } from 'react';

/** Datos sinteticos y utilidades compartidas por los tests de "Spam y remitentes" (no es un test). */

export const CFG = () => ({
    rev: 1,
    level: 'balanced',
    threshold: 65,
    actions: { clean: 'deliver', suspicious: 'warn', spam: 'spam' },
    familyWeights: { auth: 1, headers: 1, content: 1, links: 1, attachments: 1, impersonation: 1 },
    engine: { content: true, links: true, learning: true, context: true },
    allowUserSensitivity: true,
    external: {
        enabled: false, style: 'warning', text: { es: '', en: '' }, subjectTag: false, colleagueSpoof: true, firstTime: true,
        hardenLinks: false, hardenAttachments: true, internalDomains: [] as string[],
    },
    logRetentionDays: 30,
    logDelivered: false,
});

export const CONFIG_VIEW = (cfg = CFG()) => ({
    config: cfg, source: 'default', updatedAt: null, updatedBy: null,
    presets: { low: 80, balanced: 65, strict: 50, max: 35 }, ownDomains: ['corp.test'],
});

export const SIM = (over: Record<string, unknown> = {}) => ({
    analyzed: 10, skipped: 0, current: { spam: 1, warned: 2, delivered: 7 }, proposed: { spam: 3, warned: 2, delivered: 5 },
    changed: { toSpam: 2, fromSpam: 0, toWarned: 0, fromWarned: 0 }, scope: 'mine', ...over,
});

export const LIST_ROWS = () => [
    { id: 'a', matchType: 'domain', value: 'spam.test', includeSubdomains: true, reason: 'campaña', expiresAt: null, expired: false, createdBy: 'admin@corp.test', hits: 4, lastHitAt: '2026-09-01T10:00:00.000Z', createdAt: '2026-08-01T10:00:00.000Z' },
    { id: 'b', matchType: 'email', value: 'malo@ejemplo.test', includeSubdomains: false, reason: null, expiresAt: '2026-01-01T00:00:00.000Z', expired: true, createdBy: 'admin@corp.test', hits: 0, lastHitAt: null, createdAt: '2026-08-02T10:00:00.000Z' },
];

export const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

export async function setSelect(el: HTMLSelectElement | null | undefined, value: string) {
    if (!el) throw new Error('select no encontrado');
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

export async function keydown(el: Element | null | undefined, key: string) {
    if (!el) throw new Error('elemento no encontrado');
    await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
}

export const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
export const qa = <T extends Element = HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));
