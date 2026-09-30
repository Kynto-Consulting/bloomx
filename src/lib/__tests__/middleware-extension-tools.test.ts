/**
 * Las herramientas de extensiones (/extensions, playground, galeria) se abren SIN sesion solo en desarrollo y con
 * NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE definida. En produccion, o sin la variable, el middleware sigue exigiendo sesion.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const call = (path: string) => middleware(new NextRequest(`http://localhost:3000${path}`));
const isRedirectToLogin = (res: Response) => res.status >= 300 && res.status < 400 && (res.headers.get('location') || '').includes('/login');
const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';

afterEach(() => { vi.unstubAllEnvs(); });

describe('middleware: herramientas de extensiones sin sesion (solo desarrollo)', () => {
    it('sin la variable de override exige sesion', async () => {
        vi.stubEnv('NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE', '');
        for (const path of ['/extensions', '/extensions/playground', '/extensions/components']) expect(isRedirectToLogin(await call(path)), path).toBe(true);
    });

    it('con la variable en desarrollo deja pasar solo esas rutas', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE', '{"primaryColor":"#7c3aed"}');
        for (const path of ['/extensions', '/extensions/playground', '/extensions/components']) expect(passes(await call(path)), path).toBe(true);
        // paginas PAGE de extensiones y el resto de la app siguen protegidas
        for (const path of ['/extensions/mi-pagina', '/calendar', '/api/emails']) expect(passes(await call(path)), path).toBe(false);
    });

    it('en produccion nunca se abre, aunque la variable exista', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE', '{"primaryColor":"#7c3aed"}');
        for (const path of ['/extensions', '/extensions/playground', '/extensions/components']) expect(passes(await call(path)), path).toBe(false);
    });
});
