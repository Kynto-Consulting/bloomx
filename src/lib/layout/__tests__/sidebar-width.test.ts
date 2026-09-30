import { describe, expect, it } from 'vitest';
import {
    COLLAPSE_BELOW_PX, SIDEBAR_COOKIE, SIDEBAR_MAX_PX, SIDEBAR_MIN_PX, SIDEBAR_STORAGE_KEY, clampSidebarWidth, defaultSidebarWidth, isRailViewport, nextWidthForKey,
    parseSidebarCookie, readStoredSidebarWidth, resolveSidebarWidth, sanitizeStoredWidth, serializeSidebarCookie, sidebarBounds, sidebarCssWidth, writeStoredSidebarWidth,
} from '../sidebar-width';
import { sidebarModeFor } from '@/components/layout/useViewportWidth';

const memory = () => {
    const data = new Map<string, string>();
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
};

describe('ancho por defecto y limites', () => {
    it('~20 % del viewport con minimo 208 y maximo 420', () => {
        expect(defaultSidebarWidth(1280)).toBe(256);
        expect(defaultSidebarWidth(1440)).toBe(288);
        expect(defaultSidebarWidth(1024)).toBe(208); // 20 % = 205 -> sube al minimo
        expect(defaultSidebarWidth(900)).toBe(208);
        expect(defaultSidebarWidth(2560)).toBe(420); // 20 % = 512 -> tope
        expect(defaultSidebarWidth(1920)).toBe(384);
    });

    it('el maximo es min(420, 32 % del viewport) y nunca baja del minimo', () => {
        expect(sidebarBounds(1280)).toEqual({ min: 208, max: 409 });
        expect(sidebarBounds(2560)).toEqual({ min: 208, max: 420 });
        expect(sidebarBounds(900)).toEqual({ min: 208, max: 288 });
        expect(sidebarBounds(400).max).toBe(208);
    });

    it('clamp: por debajo, dentro, por encima, NaN e Infinity', () => {
        expect(clampSidebarWidth(50, 1280)).toBe(208);
        expect(clampSidebarWidth(300, 1280)).toBe(300);
        expect(clampSidebarWidth(9999, 1280)).toBe(409);
        expect(clampSidebarWidth(Number.NaN, 1280)).toBe(256);
        expect(clampSidebarWidth(Number.POSITIVE_INFINITY, 1280)).toBe(256);
        expect(clampSidebarWidth(300.6, 1280)).toBe(301);
    });

    it('un ancho guardado se recorta al viewport actual (ventana mas pequena) sin perderse', () => {
        expect(resolveSidebarWidth(400, 1280)).toBe(400);
        expect(resolveSidebarWidth(400, 1000)).toBe(320);
        expect(resolveSidebarWidth(null, 1280)).toBe(256);
        expect(resolveSidebarWidth(undefined, 1280)).toBe(256);
    });

    it('nunca supera el 32 % ni baja del 15 % efectivo en el rango de escritorio', () => {
        for (const vw of [900, 1024, 1280, 1440, 1920, 2560, 3840]) {
            const { min, max } = sidebarBounds(vw);
            expect(max).toBeLessThanOrEqual(Math.max(SIDEBAR_MIN_PX, Math.floor(vw * 0.32)));
            expect(max).toBeLessThanOrEqual(SIDEBAR_MAX_PX);
            expect(min / vw).toBeGreaterThan(0.05);
            expect(defaultSidebarWidth(vw)).toBeGreaterThanOrEqual(min);
            expect(defaultSidebarWidth(vw)).toBeLessThanOrEqual(max);
        }
    });
});

describe('saneo de lo guardado', () => {
    it('acepta enteros/cadenas numericas razonables y descarta basura', () => {
        expect(sanitizeStoredWidth('300')).toBe(300);
        expect(sanitizeStoredWidth(' 300 ')).toBe(300);
        expect(sanitizeStoredWidth(300)).toBe(300);
        expect(sanitizeStoredWidth('300.4')).toBe(300);
        for (const bad of [null, undefined, '', 'abc', '30px', '-5', '99', '4001', '1e3', 'NaN', 'Infinity', {}, [], true, Number.NaN, '300; drop table', '0x1F4']) {
            expect(sanitizeStoredWidth(bad as any), String(bad)).toBeNull();
        }
    });

    it('lectura/escritura en almacenamiento: clave versionada, borrar = restablecer y errores tragados', () => {
        const store = memory();
        expect(SIDEBAR_STORAGE_KEY).toMatch(/:v1$/);
        writeStoredSidebarWidth(312.4, store);
        expect(store.data.get(SIDEBAR_STORAGE_KEY)).toBe('312');
        expect(readStoredSidebarWidth(store)).toBe(312);
        store.data.set(SIDEBAR_STORAGE_KEY, 'corrupto');
        expect(readStoredSidebarWidth(store)).toBeNull();
        writeStoredSidebarWidth(null, store);
        expect(store.data.has(SIDEBAR_STORAGE_KEY)).toBe(false);
        const broken = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('cuota'); }, removeItem: () => { throw new Error('x'); } };
        expect(readStoredSidebarWidth(broken)).toBeNull();
        expect(() => writeStoredSidebarWidth(300, broken)).not.toThrow();
        expect(readStoredSidebarWidth(null)).toBeNull();
    });

    it('cookie: se serializa sin datos sensibles, se parsea con el mismo saneo y se borra con Max-Age=0', () => {
        expect(serializeSidebarCookie(300)).toBe(`${SIDEBAR_COOKIE}=300; Max-Age=31536000; Path=/; SameSite=Lax`);
        expect(serializeSidebarCookie(300, true)).toContain('; Secure');
        expect(serializeSidebarCookie(null)).toContain('Max-Age=0');
        expect(parseSidebarCookie('288')).toBe(288);
        expect(parseSidebarCookie('9')).toBeNull();
        expect(parseSidebarCookie(undefined)).toBeNull();
        expect(parseSidebarCookie('288; evil=1')).toBeNull();
    });

    it('ancho CSS del primer HTML: cookie en px o 20vw, siempre dentro de los limites', () => {
        expect(sidebarCssWidth(null)).toBe('clamp(208px, 20vw, max(208px, min(420px, 32vw)))');
        expect(sidebarCssWidth(300)).toBe('clamp(208px, 300px, max(208px, min(420px, 32vw)))');
    });
});

describe('teclado del separador', () => {
    it('flechas +-16 (Mayus x4), Home/End = limites, Enter = por defecto, otras teclas = null', () => {
        expect(nextWidthForKey(256, 'ArrowRight', 1280)).toBe(272);
        expect(nextWidthForKey(256, 'ArrowLeft', 1280)).toBe(240);
        expect(nextWidthForKey(256, 'ArrowRight', 1280, { shift: true })).toBe(320);
        expect(nextWidthForKey(210, 'ArrowLeft', 1280)).toBe(208);
        expect(nextWidthForKey(405, 'ArrowRight', 1280)).toBe(409);
        expect(nextWidthForKey(300, 'Home', 1280)).toBe(208);
        expect(nextWidthForKey(300, 'End', 1280)).toBe(409);
        expect(nextWidthForKey(300, 'Enter', 1280)).toBe(256);
        expect(nextWidthForKey(300, 'a', 1280)).toBeNull();
    });
    it('RTL invierte las flechas', () => {
        expect(nextWidthForKey(256, 'ArrowLeft', 1280, { rtl: true })).toBe(272);
        expect(nextWidthForKey(256, 'ArrowRight', 1280, { rtl: true })).toBe(240);
    });
});

describe('modos de la barra segun el viewport', () => {
    it('< 768 cajon, 768-899 riel, >= 900 fija', () => {
        expect(COLLAPSE_BELOW_PX).toBe(900);
        expect(sidebarModeFor(375)).toBe('drawer');
        expect(sidebarModeFor(767)).toBe('drawer');
        expect(sidebarModeFor(768)).toBe('rail');
        expect(sidebarModeFor(899)).toBe('rail');
        expect(sidebarModeFor(900)).toBe('full');
        expect(sidebarModeFor(1920)).toBe('full');
        expect(isRailViewport(899)).toBe(true);
        expect(isRailViewport(900)).toBe(false);
    });
});
