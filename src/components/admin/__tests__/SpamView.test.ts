// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', async () => {
    const R = await import('react');
    return { default: ({ href, children, ...rest }: any) => R.createElement('a', { href, ...rest }, children) };
});

import { SpamView } from '../spam/SpamView';
import { button, calls, click, dialog, flush, mountRoot, render, routeFetch, setValue, textOf, unmountRoot } from '../profile/__tests__/test-utils';
import { CFG, CONFIG_VIEW, LIST_ROWS, SIM, keydown, q, qa, setSelect, wait } from './spam-fixtures';

let cfg: ReturnType<typeof CFG>;
let simResponse: any;

const EVENTS = {
    total: 2,
    rows: [
        { id: 'e1', ts: '2026-09-10T10:00:00.000Z', recipient: 'ana@corp.test', sender: 'promo@spam.test', senderDomain: 'spam.test', decision: 'spam', score: 82, ruleLabel: null, external: true,
          reasons: [{ id: 'auth.dmarc_fail', weight: 25, es: 'Falló DMARC: el remitente no está autorizado a usar ese dominio.', en: 'DMARC failed: the sender is not authorized to use that domain.' }, { id: 'ctx.contact', weight: -10, es: 'El remitente está en tus contactos.', en: 'The sender is in your contacts.' }] },
        { id: 'e2', ts: '2026-09-10T11:00:00.000Z', recipient: null, sender: 'x@bloq.test', senderDomain: 'bloq.test', decision: 'blocked', score: null, ruleLabel: 'block.domain:bloq.test', external: false, reasons: [] },
    ],
};
const PROBE = {
    score: 71, threshold: 65, band: 'spam', decision: 'spam', blockedByList: false, allowedByList: false, authFailed: true, category: 'unknown',
    signals: [
        { id: 'ctx.contact', family: 'context', weight: -10, critical: false, params: null, es: 'El remitente está en tus contactos.', en: 'The sender is in your contacts.' },
        { id: 'auth.dmarc_fail', family: 'auth', weight: 30, critical: true, params: null, es: 'Falló DMARC: el remitente no está autorizado a usar ese dominio.', en: 'DMARC failed: the sender is not authorized to use that domain.' },
        { id: 'hdr.msgid_missing', family: 'headers', weight: 5, critical: false, params: null, es: 'Falta el identificador Message-ID.', en: 'The Message-ID is missing.' },
    ],
};
const STATS = {
    days: 30,
    perDay: [
        { day: '2026-09-09', spam: 3, blocked: 1, warned: 2, external: 4, notspam: 0 },
        { day: '2026-09-10', spam: 5, blocked: 0, warned: 1, external: 2, notspam: 1 },
    ],
    topDomains: [{ domain: 'spam.test', count: 7 }],
    totals: { spam: 8, blocked: 1, warned: 3, external: 6, notspam: 1, markspam: 2 },
};

function handlers() {
    return {
        'GET /api/admin/spam/config': () => ({ body: CONFIG_VIEW(cfg) }),
        'PUT /api/admin/spam/config': (init: any) => {
            const patch = JSON.parse(init.body);
            cfg = { ...cfg, ...patch, external: patch.external ? { ...cfg.external, ...patch.external } : cfg.external };
            return { body: { ...CONFIG_VIEW(cfg), updatedAt: '2026-09-15T10:00:00.000Z', updatedBy: 'a***@corp.test' } };
        },
        'DELETE /api/admin/spam/config': () => { cfg = CFG(); return { body: CONFIG_VIEW(cfg) }; },
        'POST /api/admin/spam/simulate': () => ({ body: simResponse }),
        'GET /api/admin/spam/lists/block': () => ({ body: { rows: LIST_ROWS(), total: 2, limit: 10000 } }),
        'GET /api/admin/spam/lists/allow': () => ({ body: { rows: [], total: 0, limit: 10000 } }),
        'GET /api/admin/spam/lists/external': () => ({ body: { rows: [], total: 0, limit: 2000 } }),
        'GET /api/admin/spam/events': () => ({ body: EVENTS }),
        'POST /api/admin/spam/test': () => ({ body: PROBE }),
        'GET /api/admin/spam/stats': () => ({ body: STATS }),
    };
}

const selectByLabel = (text: string) => {
    const l = qa<HTMLLabelElement>('label').find((x) => (x.textContent || '').trim() === text);
    return l ? document.getElementById(l.htmlFor) as HTMLSelectElement : null;
};
/** "Probar" es tambien el nombre de la pestana: el boton de enviar es el del formulario. */
const runBtn = () => button('Probar', q('#spam-test-headers')!.closest('form')!);
const goTab = (tab: string) => window.history.replaceState(null, '', `/admin/spam?tab=${tab}`);
const radioLevel = (v: string) => q<HTMLInputElement>(`input[name="spam-level"][value="${v}"]`)!;
const threshold = () => q<HTMLInputElement>('#spam-threshold')!;

beforeEach(() => {
    cfg = CFG();
    simResponse = SIM();
    routeFetch(handlers() as any);
    mountRoot();
    window.history.replaceState(null, '', '/admin/spam');
});
afterEach(async () => {
    await unmountRoot();
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
});

describe('Pestanas', () => {
    it('tablist accesible: roles, aria-selected, tabIndex itinerante y panel enlazado', async () => {
        await render(React.createElement(SpamView));
        const tabs = qa('[role="tab"]');
        expect(tabs.map((x) => x.textContent)).toEqual(['Nivel de filtrado', 'Bloqueados', 'Permitidos', 'Correos externos', 'Registro', 'Probar', 'Estadísticas']);
        expect(q('[role="tablist"]')?.getAttribute('aria-label')).toBe('Secciones de spam y remitentes');
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        expect(tabs.filter((x) => x.tabIndex === 0)).toHaveLength(1);
        const panel = q('[role="tabpanel"]')!;
        expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id);
        expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id);
    });

    it('flechas, Inicio y Fin cambian de pestana, mueven el foco y actualizan ?tab=', async () => {
        await render(React.createElement(SpamView));
        const tabs = () => qa<HTMLButtonElement>('[role="tab"]');
        await keydown(tabs()[0], 'ArrowRight');
        await flush();
        expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(tabs()[1]);
        expect(window.location.search).toBe('?tab=block');
        await keydown(tabs()[1], 'End');
        expect(tabs()[6].getAttribute('aria-selected')).toBe('true');
        expect(window.location.search).toBe('?tab=stats');
        await keydown(tabs()[6], 'ArrowRight'); // da la vuelta
        expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
        await keydown(tabs()[0], 'ArrowLeft');
        expect(tabs()[6].getAttribute('aria-selected')).toBe('true');
        await keydown(tabs()[6], 'Home');
        expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    });

    it('abre la pestana indicada por ?tab= y conserva oculto el panel anterior', async () => {
        goTab('allow');
        await render(React.createElement(SpamView));
        expect(qa('[role="tab"]')[2].getAttribute('aria-selected')).toBe('true');
        expect(textOf()).toContain('Remitentes permitidos');
        const panels = qa('[role="tabpanel"]');
        expect(panels.filter((p) => !p.hidden)).toHaveLength(1);
        await click(qa('[role="tab"]')[0]);
        expect(qa('[role="tabpanel"]').filter((p) => !p.hidden)).toHaveLength(1);
        expect(qa('[role="tabpanel"]')).toHaveLength(2); // el de "Permitidos" sigue montado (con sus cambios)
    });
});

describe('Nivel de filtrado', () => {
    it('muestra el nivel actual, su umbral y las bandas', async () => {
        await render(React.createElement(SpamView));
        expect(radioLevel('balanced').checked).toBe(true);
        expect(threshold().value).toBe('65');
        const bands = q('[data-testid="spam-bands"]')!.textContent!;
        expect(bands).toContain('menor que 50');
        expect(bands).toContain('de 50 a menos de 65');
        expect(bands).toContain('65 o más');
        expect(q('[role="note"]')?.textContent).toContain('nunca rechaza');
        expect(button('Guardar cambios')!.disabled).toBe(true);
    });

    it('los presets actualizan el umbral y Personalizado aparece al editarlo a mano', async () => {
        await render(React.createElement(SpamView));
        await click(radioLevel('strict'));
        expect(threshold().value).toBe('50');
        await click(radioLevel('low'));
        expect(threshold().value).toBe('80');
        await click(radioLevel('max'));
        expect(threshold().value).toBe('35');
        await setValue(threshold(), '42');
        expect(radioLevel('custom').checked).toBe(true);
        expect(q('[data-testid="spam-bands"]')!.textContent).toContain('de 27 a menos de 42');
        await click(radioLevel('off'));
        expect(threshold().disabled).toBe(true);
        expect(q('[data-testid="spam-bands"]')!.textContent).toContain('desactivado');
    });

    it('valida el umbral y los multiplicadores de forma accesible', async () => {
        await render(React.createElement(SpamView));
        await setValue(threshold(), '0');
        expect(q('#spam-threshold-err')?.getAttribute('role')).toBe('alert');
        expect(threshold().getAttribute('aria-invalid')).toBe('true');
        expect(button('Guardar cambios')!.disabled).toBe(true);
        await setValue(threshold(), '60');
        await setValue(q<HTMLInputElement>('#spam-weight-auth')!, '2.5');
        expect(q('#spam-weight-auth-err')?.textContent).toContain('entre 0 y 2');
        expect(button('Guardar cambios')!.disabled).toBe(true);
        await setValue(q<HTMLInputElement>('#spam-weight-auth')!, '1.5');
        expect(q('#spam-weight-auth-err')).toBeNull();
        expect(button('Guardar cambios')!.disabled).toBe(false);
    });

    it('vista previa con debounce: llama a /simulate con el parche y explica el efecto', async () => {
        await render(React.createElement(SpamView));
        expect(q('[data-testid="spam-sim"]')!.textContent).toContain('Cambia un ajuste');
        await click(radioLevel('strict'));
        await setValue(threshold(), '48');
        await setValue(threshold(), '47');
        expect(calls.filter((c) => c.path === '/api/admin/spam/simulate')).toHaveLength(0); // aun en debounce
        await wait(800);
        const sims = calls.filter((c) => c.path === '/api/admin/spam/simulate');
        expect(sims).toHaveLength(1);
        expect(sims[0].body).toEqual({ config: { level: 'custom', threshold: 47 } });
        const txt = q('[data-testid="spam-sim"]')!.textContent!;
        expect(txt).toContain('de tus últimos 10 correos evaluados 3 habrían ido a Spam (antes 1)');
        expect(txt).toContain('Pasarían a Spam: 2');
    });

    it('sin correos evaluados lo dice; en el ambito del dominio cambia la redaccion', async () => {
        simResponse = SIM({ analyzed: 0, skipped: 0 });
        await render(React.createElement(SpamView));
        await click(radioLevel('max'));
        await wait(800);
        expect(q('[data-testid="spam-sim"]')!.textContent).toContain('Todavía no hay correos evaluados');
        simResponse = SIM({ scope: 'domain' });
        await click(radioLevel('low'));
        await wait(800);
        expect(q('[data-testid="spam-sim"]')!.textContent).toContain('de los últimos 10 correos evaluados del dominio 3');
    });

    it('un error del simulador se anuncia sin romper el formulario', async () => {
        routeFetch({ ...handlers(), 'POST /api/admin/spam/simulate': () => ({ status: 500, body: { code: 'internal' } }) } as any);
        await render(React.createElement(SpamView));
        await click(radioLevel('max'));
        await wait(800);
        expect(q('[data-testid="spam-sim"]')!.textContent).toContain('No se pudo calcular');
    });

    it('guarda solo lo cambiado (PUT parcial) y confirma; acciones y motores viajan completos', async () => {
        await render(React.createElement(SpamView));
        await click(radioLevel('strict'));
        await setSelect(q<HTMLSelectElement>('#spam-action-suspicious'), 'spam');
        await click(q('#spam-engine-learning'));
        await setValue(q<HTMLInputElement>('#spam-retention')!, '90');
        await click(q('#spam-log-delivered'));
        await click(q('#spam-user-sensitivity'));
        await click(button('Guardar cambios'));
        await flush();
        const put = calls.filter((c) => c.method === 'PUT');
        expect(put).toHaveLength(1);
        expect(put[0].body).toEqual({
            level: 'strict', threshold: 50,
            actions: { suspicious: 'spam', spam: 'spam' },
            engine: { content: true, links: true, learning: false, context: true },
            allowUserSensitivity: false, logRetentionDays: 90, logDelivered: true,
        });
        expect(textOf()).toContain('Configuración guardada');
        expect(button('Guardar cambios')!.disabled).toBe(true);
        expect(textOf()).toContain('a***@corp.test');
    });

    it('restablecer pide confirmacion y llama a DELETE', async () => {
        await render(React.createElement(SpamView));
        await click(button('Restablecer todo'));
        expect(dialog()).toBeTruthy();
        expect(dialog()!.textContent).toContain('correos externos');
        expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
        await click(button('Restablecer', dialog()!));
        await flush();
        expect(calls.filter((c) => c.method === 'DELETE' && c.path === '/api/admin/spam/config')).toHaveLength(1);
        expect(textOf()).toContain('restablecida');
    });

    it('error al cargar la configuracion: alerta con Reintentar', async () => {
        routeFetch({ ...handlers(), 'GET /api/admin/spam/config': () => ({ status: 500, body: {} }) } as any);
        await render(React.createElement(SpamView));
        expect(q('[role="alert"]')?.textContent).toContain('Error del servidor');
        expect(button('Reintentar')).toBeTruthy();
    });
});

describe('Correos externos', () => {
    const open = async () => { goTab('external'); await render(React.createElement(SpamView)); };

    it('texto personalizable con contador de 300 y vista previa en vivo (con texto por defecto si esta vacio)', async () => {
        await open();
        const es = q<HTMLTextAreaElement>('#spam-external-text-es')!;
        expect(es.maxLength).toBe(300);
        expect(q('#spam-external-text-es-count')!.textContent).toBe('0 / 300 caracteres');
        expect(q('[data-testid="spam-external-preview-es"]')!.textContent).toContain('fuera de tu organización');
        await setValue(es, 'Cuidado con este mensaje');
        expect(q('#spam-external-text-es-count')!.textContent).toBe('24 / 300 caracteres');
        expect(q('[data-testid="spam-external-preview-es"]')!.textContent).toContain('Cuidado con este mensaje');
        expect(q('[data-testid="spam-external-preview-en"]')!.textContent).toContain('outside your organization');
        expect(es.getAttribute('aria-describedby')).toContain('spam-external-text-es-count');
        await setValue(es, 'x'.repeat(300));
        expect(q('#spam-external-text-es-count')!.className).toContain('text-warning');
    });

    it('estilo, interruptores, etiqueta [EXTERNO] y guardado', async () => {
        await open();
        await click(q('input[name="spam-external-style"][value="info"]'));
        await click(q('#spam-external-enabled'));
        await click(q('#spam-external-subjectTag'));
        expect(q('[data-testid="spam-external-tag-example"]')!.textContent).toContain('[EXTERNO]');
        await setValue(q<HTMLTextAreaElement>('#spam-external-text-en')!, '  Be careful  ');
        await click(button('Guardar política'));
        await flush();
        const put = calls.filter((c) => c.method === 'PUT');
        expect(put).toHaveLength(1);
        expect(put[0].body.external).toMatchObject({ enabled: true, style: 'info', subjectTag: true, text: { es: '', en: 'Be careful' }, internalDomains: [] });
        expect(textOf()).toContain('Política de correos externos guardada');
        expect(button('Guardar política')!.disabled).toBe(true);
    });

    it('dominios internos: chips con Intro, validacion, duplicados, quitar y los propios solo lectura', async () => {
        await open();
        expect(textOf()).toContain('corp.test');
        const input = q<HTMLInputElement>('#spam-internal-domain')!;
        await setValue(input, 'no es un dominio');
        await keydown(input, 'Enter');
        expect(q('#spam-internal-domain-err')?.textContent).toContain('Dominio no válido');
        await setValue(input, 'CORP.test');
        await keydown(input, 'Enter');
        expect(q('#spam-internal-domain-err')?.textContent).toContain('ya está incluido');
        await setValue(input, 'Filial.Ejemplo.com');
        await keydown(input, 'Enter');
        expect(input.value).toBe('');
        const chips = qa('ul[aria-label="Dominios internos adicionales"] li');
        expect(chips.map((c) => c.textContent)).toEqual(['filial.ejemplo.com']);
        await click(button('Guardar política'));
        await flush();
        expect(calls.filter((c) => c.method === 'PUT')[0].body.external.internalDomains).toEqual(['filial.ejemplo.com']);
        await click(q('button[aria-label="Quitar filial.ejemplo.com"]'));
        expect(qa('ul[aria-label="Dominios internos adicionales"] li')).toHaveLength(0);
        expect(button('Guardar política')!.disabled).toBe(false);
    });

    it('limite de 50 dominios', async () => {
        cfg.external.internalDomains = Array.from({ length: 50 }, (_, i) => `d${i}.ejemplo.com`);
        await open();
        const input = q<HTMLInputElement>('#spam-internal-domain')!;
        await setValue(input, 'otro.ejemplo.com');
        await keydown(input, 'Enter');
        expect(q('#spam-internal-domain-err')?.textContent).toContain('Máximo 50');
    });

    it('incluye la whitelist de externos de confianza (kind external, sin regex)', async () => {
        await open();
        expect(calls.some((c) => c.method === 'GET' && c.path === '/api/admin/spam/lists/external')).toBe(true);
        expect(textOf()).toContain('Externos de confianza');
        expect(textOf()).toContain('0 de 2000');
        expect(q('#spam-external-type option[value="regex"]')).toBeNull();
        expect(q('#spam-external-type option[value="domain"]')).toBeTruthy();
    });
});

describe('Registro', () => {
    it('tabla con caption y scope, decisiones traducidas, sin contenido', async () => {
        goTab('log');
        await render(React.createElement(SpamView));
        const table = q('table[aria-busy], table')!;
        expect(textOf()).toContain('promo@spam.test');
        expect(document.querySelector('caption')).toBeTruthy();
        expect(qa('th[scope="col"]').length).toBeGreaterThanOrEqual(7);
        expect(textOf()).toContain('Bloqueado');
        expect(textOf()).toContain('block.domain:bloq.test');
        expect(table).toBeTruthy();
    });

    it('motivos expandibles con aria-expanded y texto en el idioma actual (es y en)', async () => {
        goTab('log');
        await render(React.createElement(SpamView));
        const toggle = button('Ver motivos (2)')!;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(textOf()).not.toContain('Falló DMARC');
        await click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeTruthy();
        expect(textOf()).toContain('Falló DMARC');
        expect(textOf()).toContain('+25');
        expect(textOf()).toContain('-10');
        await unmountRoot();
        mountRoot();
        await render(React.createElement(SpamView), 'en');
        await click(button('Show reasons (2)'));
        expect(textOf()).toContain('DMARC failed: the sender is not authorized');
        expect(textOf()).not.toContain('Falló DMARC');
    });

    it('los filtros (fecha, decision, dominio) se envian como parametros', async () => {
        goTab('log');
        await render(React.createElement(SpamView));
        await setSelect(selectByLabel('Decisión'), 'spam');
        await setValue(q<HTMLInputElement>('#spam-log-from')!, '2026-09-01');
        await setValue(q<HTMLInputElement>('input[type="search"]')!, 'spam.test');
        await wait(450);
        const last = calls.filter((c) => c.path === '/api/admin/spam/events').pop()!;
        const p = new URLSearchParams(last.search);
        expect(p.get('decision')).toBe('spam');
        expect(p.get('domain')).toBe('spam.test');
        expect(new Date(p.get('from')!).getTime()).not.toBeNaN();
    });
});

describe('Probar', () => {
    const open = async () => { goTab('test'); await render(React.createElement(SpamView)); };

    it('envia cabeceras + texto, muestra puntuacion, banda, decision y senales ordenadas con barras', async () => {
        await open();
        await setValue(q<HTMLTextAreaElement>('#spam-test-headers')!, 'From: a@spam.test\nSubject: hola');
        await setValue(q<HTMLTextAreaElement>('#spam-test-text')!, 'Gana dinero');
        await setValue(q<HTMLTextAreaElement>('#spam-test-files')!, 'a.exe\n\nb.zip');
        await click(runBtn());
        await flush();
        const post = calls.find((c) => c.method === 'POST' && c.path === '/api/admin/spam/test')!;
        expect(post.body).toEqual({ rawHeaders: 'From: a@spam.test\nSubject: hola', text: 'Gana dinero', attachments: [{ filename: 'a.exe' }, { filename: 'b.zip' }] });
        expect(q('[data-testid="spam-test-score"]')!.textContent).toContain('71');
        const res = q('[data-testid="spam-test-result"]')!.textContent!;
        expect(res).toContain('Spam');
        expect(res).toContain('Carpeta Spam');
        expect(res).toContain('no está alineada');
        const rows = qa('[data-testid="spam-test-result"] tbody tr');
        expect(rows).toHaveLength(3);
        expect(rows[0].textContent).toContain('+30'); // ordenadas por peso absoluto
        expect(rows[0].textContent).toContain('Grave');
        expect(rows[1].textContent).toContain('-10');
        expect(rows[2].textContent).toContain('+5');
        expect(rows[0].querySelector('.bg-destructive')).toBeTruthy();
        expect(rows[1].querySelector('.bg-success')).toBeTruthy();
        expect(document.querySelector('[data-testid="spam-test-result"] caption')?.textContent).toContain('Señales detectadas');
        expect(qa('[data-testid="spam-test-result"] th[scope="col"]')).toHaveLength(3);
    });

    it('un correo propio por id viaja solo y no se guarda nada (solo POST /test)', async () => {
        await open();
        await setValue(q<HTMLInputElement>('#spam-test-email-id')!, 'mail-1');
        expect(q<HTMLTextAreaElement>('#spam-test-headers')!.disabled).toBe(true);
        await click(runBtn());
        await flush();
        expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/admin/spam/test']);
        expect(calls.find((c) => c.path === '/api/admin/spam/test')!.body).toEqual({ emailId: 'mail-1' });
        expect(calls.filter((c) => c.method === 'PUT' || c.method === 'DELETE')).toHaveLength(0);
    });

    it('vacio y errores del servidor se anuncian', async () => {
        await open();
        await click(runBtn());
        expect(q('[role="alert"]')?.textContent).toContain('Escribe al menos');
        expect(calls.filter((c) => c.path === '/api/admin/spam/test')).toHaveLength(0);
        routeFetch({ ...handlers(), 'POST /api/admin/spam/test': () => ({ status: 404, body: { code: 'email_not_found' } }) } as any);
        await setValue(q<HTMLInputElement>('#spam-test-email-id')!, 'ajeno');
        await click(runBtn());
        await flush();
        expect(q('[role="alert"]')?.textContent).toContain('No se encontró ese correo');
    });
});

describe('Estadisticas', () => {
    it('totales, grafico SVG accesible con titulo/descripcion, tabla alternativa y dominios', async () => {
        goTab('stats');
        await render(React.createElement(SpamView));
        const svg = q('svg[role="img"]')!;
        expect(svg).toBeTruthy();
        const labelled = svg.getAttribute('aria-labelledby')!.split(' ').map((id) => document.getElementById(id)?.textContent);
        expect(labelled[0]).toBe('Actividad por día');
        expect(labelled[1]).toContain('spam 8');
        expect(svg.querySelectorAll('polyline')).toHaveLength(4);
        const tableRows = qa('details tbody tr');
        expect(tableRows).toHaveLength(2);
        expect(tableRows[0].textContent).toContain('2026-09-09');
        expect(qa('details th[scope="col"]').length).toBe(5);
        const t = textOf();
        expect(t).toContain('Falsos positivos reportados');
        expect(t).toContain('Marcados como spam');
        expect(t).toContain('spam.test');
        // colores solo por tokens de tema
        expect(svg.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
        expect(svg.querySelector('polyline')!.getAttribute('class')).toMatch(/stroke-/);
    });

    it('cambiar el periodo vuelve a pedir los datos', async () => {
        goTab('stats');
        await render(React.createElement(SpamView));
        await setSelect(selectByLabel('Periodo'), '90');
        await flush();
        expect(calls.filter((c) => c.path === '/api/admin/spam/stats').pop()!.search).toBe('?days=90');
    });

    it('sin datos muestra un estado vacio', async () => {
        routeFetch({ ...handlers(), 'GET /api/admin/spam/stats': () => ({ body: { days: 30, perDay: [], topDomains: [], totals: { spam: 0, blocked: 0, warned: 0, external: 0, notspam: 0, markspam: 0 } } }) } as any);
        goTab('stats');
        await render(React.createElement(SpamView));
        expect(q('svg[role="img"]')).toBeNull();
        expect(textOf()).toContain('Todavía no hay datos');
        expect(textOf()).toContain('Sin dominios');
    });
});
