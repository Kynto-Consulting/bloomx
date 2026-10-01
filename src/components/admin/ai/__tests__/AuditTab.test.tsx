// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

let payload: any = { entries: [] };
vi.mock('@/components/admin/console', async (orig) => ({ ...(await orig<any>()), useAdminQuery: () => ({ data: payload, error: null, mutate: () => undefined }) }));
vi.mock('@/components/I18nProvider', () => ({ useI18n: () => ({ t: (k: string) => k, intlLocale: 'es' }) }));
vi.mock('../shared', () => ({ useErrorText: () => (e: unknown) => String(e) }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function render(data: any) {
    payload = data;
    const { AuditTab } = await import('../AuditTab');
    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => { createRoot(host).render(React.createElement(AuditTab as any, {})); });
    return host;
}

describe('AuditTab (/admin/ai)', () => {
    it('lee { entries } de la API y muestra las filas', async () => {
        const host = await render({ entries: [{ id: 'a1', actor: 'root@x.test', action: 'ai.settings.update', fields: ['provider', 'model'], ts: '2026-10-01T10:00:00Z' }] });
        expect(host.textContent).toContain('root@x.test');
        expect(host.textContent).toContain('provider model');
    });
    it('no se rompe con respuesta vacia, con { items } antiguo ni con fields ausente', async () => {
        expect((await render({ entries: [] })).textContent).toContain('admin.ai.audit.empty');
        expect((await render({})).textContent).toContain('admin.ai.audit.empty');
        const legacy = await render({ items: [{ id: 'b', actor: 'u@x.test', action: 'ai.test', ts: null }] });
        expect(legacy.textContent).toContain('u@x.test');
    });
});
