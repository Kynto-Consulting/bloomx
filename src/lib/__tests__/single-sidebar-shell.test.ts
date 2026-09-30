import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Auditoria: la barra lateral es UNA sola, montada por el shell compartido (`components/layout/AppShell.tsx`, desde
 * `app/(app)/layout.tsx`). Ninguna pantalla puede montar su propia copia ni fijarle un ancho (w-64, w-[260px], hidden lg:block...).
 * Si esto falla, alguien volvio a crear una variante de la barra: hay que usar el shell.
 */
const SRC = path.resolve(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p, out); } else if (/\.(tsx|ts)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
    }
    return out;
}
const rel = (p: string) => path.relative(SRC, p).replace(/\\/g, '/');
const files = walk(SRC);
const read = (p: string) => fs.readFileSync(p, 'utf8');

const SHELL = 'components/layout/AppShell.tsx';

describe('una sola barra lateral', () => {
    it('solo el shell importa y monta <Sidebar>', () => {
        const offenders: string[] = [];
        for (const f of files) {
            const r = rel(f);
            if (r === SHELL || r === 'components/Sidebar.tsx') continue;
            const s = read(f);
            if (/from\s+['"](@\/components\/Sidebar|\.{1,2}\/(?:components\/)?Sidebar)['"]/.test(s)) offenders.push(`${r}: importa Sidebar`);
            if (/<(?:App)?Sidebar[\s/>]/.test(s)) offenders.push(`${r}: monta <Sidebar>`);
        }
        expect(offenders).toEqual([]);
    });

    it('las pantallas con barra viven en el grupo de rutas (app), cuyo layout monta el shell', () => {
        const layout = read(path.join(SRC, 'app/(app)/layout.tsx'));
        expect(layout).toContain('AppShell');
        for (const route of ['page.tsx', 'calendar/page.tsx', 'contacts/page.tsx', 'appointments/page.tsx', 'elixir/page.tsx']) {
            expect(fs.existsSync(path.join(SRC, 'app/(app)', route)), route).toBe(true);
        }
        // Sin copias en su ubicacion antigua (fuera del grupo el shell no las envolveria).
        for (const route of ['page.tsx', 'calendar', 'contacts', 'appointments', 'elixir']) {
            expect(fs.existsSync(path.join(SRC, 'app', route)), `app/${route}`).toBe(false);
        }
    });

    it('ninguna pantalla que use useAppSidebar esta fuera del shell', () => {
        const outside = files.filter((f) => /useAppSidebar\(/.test(read(f)) && !rel(f).startsWith('app/(app)/') && !rel(f).startsWith('components/') && rel(f) !== SHELL);
        expect(outside.map(rel)).toEqual([]);
    });

    it('las pantallas del grupo no fijan anchos de barra ni tienen su propia version responsive', () => {
        const offenders: string[] = [];
        for (const f of files.filter((x) => rel(x).startsWith('app/(app)/'))) {
            const s = read(f);
            // Un contenedor de ancho fijo/oculto por breakpoint que envuelva la barra (patron anterior).
            if (/hidden\s+(?:md|lg):(?:flex|block)[^"']*\bw-(?:64|72|\[2\d\dpx\])[^"']*["'][^<]*<\w*Sidebar/i.test(s)) offenders.push(rel(f));
            if (/isAppSidebarOpen|isSidebarOpen/.test(s)) offenders.push(`${rel(f)}: estado de cajon propio`);
        }
        expect(offenders).toEqual([]);
    });

    it('el shell no fija un ancho de barra: sale del hook/calculo compartido y de un solo separador', () => {
        const shell = read(path.join(SRC, SHELL));
        expect(shell).not.toMatch(/(?<![-\w])w-(?:64|72|80)\b|(?<![-\w])w-\[\d+px\]/);
        expect((shell.match(/<SidebarResizer/g) ?? []).length).toBe(1);
        expect((shell.match(/<aside/g) ?? []).length).toBeGreaterThanOrEqual(1);
    });
});
