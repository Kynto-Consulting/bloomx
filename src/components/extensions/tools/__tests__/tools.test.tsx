// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RAW_CLASS } from '@/lib/__tests__/helpers/raw-colors';
import { byText, click, flush, h, installCleanup, mount, q, qa, typeInto } from '@/components/expansions/kit/__tests__/harness';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => '/extensions/playground' }));
vi.mock('@/components/SessionProvider', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }));
vi.mock('@/hooks/useDomainConfig', () => ({
    useDomainConfig: () => ({ config: { displayName: 'Acme' }, themeConfig: { primaryColor: '#7c3aed', radius: 'lg' }, extensions: [], isLoading: false }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import PlaygroundPage from '@/app/extensions/playground/page';
import ComponentsPage from '@/app/extensions/components/page';
import { ThemeScope } from '../ThemeScope';
import { isLocalToolsOverride } from '../access';
import { PENDING_KEY } from '@/lib/expansions/playground/storage';

const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const ENV_KEY = 'NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE';
const originalFetch = globalThis.fetch;

function allowViaOverride() { process.env[ENV_KEY] = '{"primaryColor":"#7c3aed"}'; }
function mockAdminMe(status: number) {
    const fetchMock = vi.fn(async () => ({ status, ok: status >= 200 && status < 300, json: async () => ({}) }));
    (globalThis as any).fetch = fetchMock;
    return fetchMock;
}

beforeEach(() => {
    delete process.env[ENV_KEY];
    push.mockReset();
    window.localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
});
afterEach(() => {
    delete process.env[ENV_KEY];
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
});

describe('ThemeScope', () => {
    installCleanup();

    it('aplica las variables del tema solo al contenedor y color-scheme', async () => {
        await mount(<ThemeScope themeId="dark"><span>hola</span></ThemeScope>);
        const scope = q<HTMLElement>('[data-theme-scope]')!;
        expect(scope.getAttribute('data-theme-scope')).toBe('dark');
        expect(scope.style.getPropertyValue('--color-background')).toMatch(/^#[0-9a-f]{6}$/i);
        expect(scope.style.getPropertyValue('--color-primary')).toBeTruthy();
        expect(scope.style.colorScheme).toBe('dark');
        expect(scope.style.backgroundColor).toBe('var(--color-background)');
        expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });

    it('temas de empresa (paleta de prueba): radio y fuente salen de la config; id desconocido cae al claro', async () => {
        await mount(<div><ThemeScope themeId="fixture:pastel|light" id="a">x</ThemeScope><ThemeScope themeId="no-existe" id="b">y</ThemeScope></div>);
        expect(q('#b')!.getAttribute('data-theme-scope')).toBe('light');
        expect(q('#a')!.getAttribute('data-theme-scope')).toBe('fixture:pastel|light');
    });

    it('no emite colores crudos: los hex solo van dentro de variables --color-*', async () => {
        await mount(<ThemeScope themeId="fixture:oscura corporativa|dark" className="rounded-lg border border-border p-4">x</ThemeScope>);
        const scope = q<HTMLElement>('[data-theme-scope]')!;
        const style = scope.getAttribute('style') || '';
        const withoutTokens = style.replace(/--color-[a-z-]+:\s*#[0-9a-fA-F]{3,8}/g, '');
        expect(withoutTokens).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/);
        expect(scope.outerHTML.match(RAW_CLASS) ?? []).toEqual([]);
    });
});

describe('acceso (useExtensionTools)', () => {
    installCleanup();

    it('isLocalToolsOverride: solo con la variable y fuera de produccion', () => {
        expect(isLocalToolsOverride()).toBe(false);
        allowViaOverride();
        expect(isLocalToolsOverride()).toBe(true);
    });

    it('acceso denegado (401): no se muestran las herramientas', async () => {
        const fetchMock = mockAdminMe(401);
        await mount(h(PlaygroundPage));
        await flush();
        expect(fetchMock).toHaveBeenCalledWith('/api/admin/me', expect.anything());
        expect(document.body.textContent).toContain('Pagina no disponible');
        expect(q('#pg-editor')).toBeNull();
        expect(q('textarea')).toBeNull();
    });

    it('acceso denegado (403) tambien en la galeria', async () => {
        mockAdminMe(403);
        await mount(h(ComponentsPage));
        await flush();
        expect(document.body.textContent).toContain('Pagina no disponible');
        expect(q('#gal-search')).toBeNull();
    });

    it('error de red: no se permite', async () => {
        (globalThis as any).fetch = vi.fn(async () => { throw new Error('offline'); });
        await mount(h(PlaygroundPage));
        await flush();
        expect(q('#pg-editor')).toBeNull();
    });

    it('mientras carga muestra un esqueleto accesible', async () => {
        (globalThis as any).fetch = vi.fn(() => new Promise(() => { }));
        await mount(h(PlaygroundPage));
        expect(q('[role="status"][aria-busy="true"]')).toBeTruthy();
        expect(q('#pg-editor')).toBeNull();
    });

    it('admin (200): se muestran las herramientas', async () => {
        mockAdminMe(200);
        await mount(h(PlaygroundPage));
        await flush();
        expect(q('#pg-editor')).toBeTruthy();
    });

    it('override local de desarrollo: permitido sin sesion ni fetch', async () => {
        allowViaOverride();
        const fetchMock = mockAdminMe(401);
        await mount(h(PlaygroundPage));
        expect(q('#pg-editor')).toBeTruthy();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('Playground', () => {
    installCleanup();
    beforeEach(() => { allowViaOverride(); });

    const editor = () => q<HTMLTextAreaElement>('#pg-editor')!;
    const preview = () => q('[role="region"][aria-label]')!;

    it('renderiza el manifest de ejemplo: detecta el tipo, valida sin errores y pinta la vista previa', async () => {
        await mount(h(PlaygroundPage));
        await flush();
        expect(document.body.textContent).toContain('Detectado: manifest completo');
        expect(q('[data-testid="issues-panel"]')!.textContent).toContain('Sin errores ni avisos');
        expect(preview().textContent).toContain('Asistente');
        expect(preview().textContent).toContain('Reunion de seguimiento del proyecto');
        // selector de mount: 2 mounts + 1 overlay
        expect(qa('#pg-target option')).toHaveLength(3);
    });

    it('JSON invalido: error con linea y columna y conserva la ultima vista previa valida', async () => {
        await mount(h(PlaygroundPage));
        await flush();
        await typeInto(editor(), '{\n  "type": "TEXT",\n  "props": { "content": }\n}');
        await wait(350);
        const alert = q('#pg-json-error')!;
        expect(alert.textContent).toMatch(/Ln 3, Col 25/);
        expect(q('[data-testid="issues-panel"]')!.textContent).toContain('Errores');
        expect(document.body.textContent).toContain('ultima version valida');
        expect(preview().textContent).toContain('Asistente');
    });

    it('la vista previa se actualiza tras el debounce de 250 ms', async () => {
        await mount(h(PlaygroundPage));
        await flush();
        await typeInto(editor(), '{"type":"TEXT","props":{"content":"Hola en vivo"}}');
        await wait(100);
        expect(preview().textContent).not.toContain('Hola en vivo');
        await wait(300);
        expect(preview().textContent).toContain('Hola en vivo');
        expect(document.body.textContent).toContain('Detectado: nodo de UI suelto');
    });

    it('errores de UI con ruta completa', async () => {
        await mount(h(PlaygroundPage));
        await flush();
        await typeInto(editor(), JSON.stringify({ type: 'STACK', children: [{ type: 'TEXT', props: { content: 'a' } }, { type: 'BUTTON', props: { label: 'x', tone: 'rojo' } }] }));
        await wait(350);
        expect(q('[data-testid="issues-panel"]')!.textContent).toContain('ui.children[1].props.tone');
        expect(document.body.textContent).toContain('mismo estado de error');
    });

    it('formato antiguo: avisos de obsolescencia separados, Estricto y Migrar', async () => {
        await mount(h(PlaygroundPage));
        await flush();
        await typeInto(q<HTMLSelectElement>('#pg-sample'), 'legacy-column');
        await wait(50);
        const panel = () => q('[data-testid="issues-panel"]')!.textContent || '';
        expect(panel()).toContain('Avisos de obsolescencia');
        expect(panel()).toContain('COLUMN esta obsoleto');
        expect(panel()).toMatch(/0 errores, \d+ avisos de obsolescencia/);

        await click(q('input[role="switch"]'));
        expect(panel()).toContain('Estricto');
        expect(panel()).toContain('cuentan como errores');

        await click(byText('Migrar a formato nuevo', 'button'));
        await wait(50);
        expect(editor().value).toContain('"STACK"');
        expect(editor().value).not.toContain('"className"');
        expect(panel()).not.toContain('Avisos de obsolescencia');
    });

    it('selector de tema y de tamano: solo afectan al marco de la vista previa', async () => {
        await mount(h(PlaygroundPage));
        await flush();
        await typeInto(q<HTMLSelectElement>('#pg-theme'), 'dark');
        expect(preview().getAttribute('data-theme-scope')).toBe('dark');
        expect(document.documentElement.getAttribute('data-theme')).toBeNull();
        // la empresa del dominio esta disponible
        expect(qa('#pg-theme option').some((o) => o.getAttribute('value') === 'domain:light')).toBe(true);
        await typeInto(q<HTMLSelectElement>('#pg-theme'), 'domain:dark');
        expect(preview().getAttribute('data-theme-scope')).toBe('domain:dark');
        await click(byText('Movil 375', 'button'));
        expect(preview().getAttribute('data-viewport-width')).toBe('375');
        expect(q('[role="radio"][aria-checked="true"]')!.textContent).toBe('Movil 375');
    });

    it('backend simulado: delayMs, eventos del composer, estado y limpiar eventos', async () => {
        await mount(h(PlaygroundPage));
        await flush();
        const button = (label: string) => qa<HTMLButtonElement>('button').find((b) => b.textContent?.includes(label))!;
        await click(button('Resumir'));
        await wait(600);
        expect(preview().textContent).toContain('Ana propone reunirse');
        const stateText = qa('section[aria-label="Estado"] pre')[0].textContent || '';
        expect(stateText).toContain('summary');
        const log = q('[role="log"]')!;
        expect(log.textContent).toContain('getSummary');

        // mount 1: funciones del composer
        await typeInto(q<HTMLSelectElement>('#pg-target'), 'mount:1');
        await wait(20);
        await click(button('Insertar saludo'));
        await wait(20);
        const events = q('[role="log"]')!.textContent || '';
        expect(events).toContain('insertBody');
        expect(events).toContain('setSubject');
        await click(button('Limpiar eventos'));
        expect(q('[role="log"]')).toBeNull();
    });

    it('guarda el borrador en localStorage y lo recupera; recoge el ejemplo enviado por la galeria', async () => {
        const first = await mount(h(PlaygroundPage));
        await flush();
        await typeInto(editor(), '{"type":"TEXT","props":{"content":"Borrador"}}');
        await wait(600);
        expect(window.localStorage.getItem('bloomx:ext-playground:draft:v1')).toContain('Borrador');
        await first.unmount();

        window.localStorage.setItem(PENDING_KEY, '{"type":"BADGE","props":{"label":"Desde galeria"}}');
        await mount(h(PlaygroundPage));
        await flush();
        expect(editor().value).toContain('Desde galeria');
        expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
    });

    it('reiniciar la vista previa remonta el arbol y limpia el estado', async () => {
        await mount(h(PlaygroundPage));
        await flush();
        const button = (label: string) => qa<HTMLButtonElement>('button').find((b) => b.textContent?.includes(label))!;
        await click(button('Resumir'));
        await wait(600);
        expect(preview().textContent).toContain('Ana propone reunirse');
        await click(button('Reiniciar vista previa'));
        await wait(20);
        expect(preview().textContent).not.toContain('Ana propone reunirse');
    });

    it('accesibilidad basica: etiquetas y regiones', async () => {
        await mount(h(PlaygroundPage));
        await flush();
        for (const id of ['pg-editor', 'pg-context', 'pg-script', 'pg-sample', 'pg-theme']) {
            expect(q(`label[for="${id}"]`), id).toBeTruthy();
        }
        expect(q('[role="radiogroup"]')).toBeTruthy();
        expect(q('[role="status"][aria-live="polite"]')).toBeTruthy();
    });
});

// Cada test monta la galeria completa (todos los componentes con ejemplos vivos): ~0,5-1,7 s en solitario, pero mas de 5 s
// con la suite entera en paralelo. El tope es explicito para toda la bateria (no depende de la carga de la maquina).
describe('Galeria de componentes', { timeout: 60000 }, () => {
    installCleanup();
    beforeEach(() => { allowViaOverride(); });

    it('catalogo completo: un articulo por componente con tabla de props y al menos un ejemplo vivo', async () => {
        const { UI_COMPONENT_TYPES } = await import('@/lib/expansions/ui-schema');
        await mount(h(ComponentsPage));
        await flush();
        for (const type of UI_COMPONENT_TYPES) {
            const article = q(`#c-${type}`);
            expect(article, type).toBeTruthy();
            expect(article!.querySelector('table') || /Sin props/.test(article!.textContent || ''), `${type}: tabla de props`).toBeTruthy();
            expect(article!.querySelectorAll('[data-testid^="example-"]').length, `${type}: ejemplos`).toBeGreaterThan(0);
        }
        expect(q('#rules')!.textContent).toContain('tone');
        expect(q('#rules')!.textContent).toContain('className');
        expect(q('#actions')!.textContent).toContain('CALL_BACKEND');
        expect(q('#actions')!.textContent).toContain('truncate');
        expect(q('#actions')!.textContent).toContain('$loading');
    });

    it('buscador y filtro por categoria', async () => {
        await mount(h(ComponentsPage));
        await flush();
        await typeInto(q<HTMLInputElement>('#gal-search'), 'sparkline');
        expect(q('#c-SPARKLINE')).toBeTruthy();
        expect(q('#c-BUTTON')).toBeNull();
        await typeInto(q<HTMLInputElement>('#gal-search'), 'zzzz-no-existe');
        expect(document.body.textContent).toContain('Ningun componente coincide');
        await typeInto(q<HTMLInputElement>('#gal-search'), '');
        await typeInto(q<HTMLSelectElement>('#gal-category'), 'chart');
        expect(qa('article').map((a) => a.id)).toEqual(['c-BAR_CHART', 'c-CHART', 'c-SPARKLINE', 'c-DONUT']);
    });

    it('la tabla de props sale del schema (tipo, valores permitidos y defecto)', async () => {
        await mount(h(ComponentsPage));
        await flush();
        await typeInto(q<HTMLInputElement>('#gal-search'), 'PROGRESS');
        const table = q('#c-PROGRESS table')!;
        expect(table.textContent).toContain('"neutral" | "primary"');
        expect(table.textContent).toContain('indeterminate');
        const max = qa('tbody tr', table).find((r) => r.querySelector('th')?.textContent === 'max')!;
        expect(max.textContent).toContain('100');
    });

    it('copiar JSON: usa el portapapeles y avisa con un status accesible; falla con mensaje', async () => {
        const writeText = vi.fn(async () => { });
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await mount(h(ComponentsPage));
        await flush();
        await typeInto(q<HTMLInputElement>('#gal-search'), 'SPARKLINE');
        // la busqueda tambien encuentra componentes que mencionan `sparkline` (KPI_CARD): se actua sobre la ficha de SPARKLINE
        await click(byText('Copiar JSON', 'button', q('#c-SPARKLINE')!));
        expect(writeText).toHaveBeenCalledTimes(1);
        expect((writeText.mock.calls[0] as any[])[0]).toContain('"SPARKLINE"');
        expect(q('#c-SPARKLINE [role="status"]')!.textContent).toBe('JSON copiado');

        writeText.mockRejectedValueOnce(new Error('denied'));
        await click(byText('Copiar JSON', 'button', q('#c-SPARKLINE')!));
        expect(q('#c-SPARKLINE [role="status"]')!.textContent).toBe('No se pudo copiar');
    });

    it('abrir en el playground: guarda el ejemplo y navega', async () => {
        await mount(h(ComponentsPage));
        await flush();
        await typeInto(q<HTMLInputElement>('#gal-search'), 'DONUT');
        await click(byText('Abrir en el playground', 'button', q('#c-DONUT')!));
        expect(push).toHaveBeenCalledWith('/extensions/playground');
        expect(window.localStorage.getItem(PENDING_KEY)).toContain('"DONUT"');
    });

    it('selector de tema y vista en todos los temas (cuadricula)', async () => {
        await mount(h(ComponentsPage));
        await flush();
        await typeInto(q<HTMLInputElement>('#gal-search'), 'BADGE');
        await typeInto(q<HTMLSelectElement>('#gal-theme'), 'midnight');
        expect(q('#c-BADGE [data-theme-scope]')!.getAttribute('data-theme-scope')).toBe('midnight');
        await click(q('input[role="switch"]'));
        const cells = qa('#c-BADGE ul[aria-label] > li');
        expect(cells).toHaveLength(14);
        const themes = cells.map((c) => c.querySelector('[data-theme-scope]')!.getAttribute('data-theme-scope'));
        expect(new Set(themes).size).toBe(14);
        expect(themes).toContain('dark');
        expect(themes).toContain('fixture:pastel|light');
    });

    it('un ejemplo con backend simulado funciona en la galeria (CALL_BACKEND con carga)', async () => {
        await mount(h(ComponentsPage));
        await flush();
        await typeInto(q<HTMLInputElement>('#gal-search'), 'BUTTON');
        const run = qa<HTMLButtonElement>('#c-BUTTON button').find((b) => b.textContent?.includes('Resumir correo'))!;
        await click(run);
        await wait(600);
        expect(q('#c-BUTTON')).toBeTruthy();
        expect((console.error as any).mock.calls.filter((c: any[]) => /simulad|no definida/i.test(String(c[0]))).length).toBe(0);
    });
});
