import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

describe('/login/expired', () => {
    it('redirige al login y borra la cookie de sesion (nombre actual y antiguo)', async () => {
        const res = await GET(new NextRequest('https://mail.example.test/login/expired?x=1'));
        expect(res.status).toBe(307);
        expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
        expect(new URL(res.headers.get('location')!).search).toBe('');
        expect(res.headers.get('cache-control')).toBe('no-store');
        const names = res.cookies.getAll().map((c) => c.name);
        expect(names.some((n) => n.endsWith('next-auth.session-token'))).toBe(true);
        for (const c of res.cookies.getAll()) expect(c.value).toBe('');
    });
});
