import { describe, it, expect } from 'vitest';
import { THEMES, applyBrand } from '../themes';

const light = THEMES.find((t) => t.id === 'light')!;

describe('applyBrand con fondo de marca oscuro', () => {
    it('no pinta de oscuro el tema claro, pero conserva el primario', () => {
        const out = applyBrand(light, { backgroundColor: '#0d1117', textColor: '#e6edf3', primaryColor: '#2563eb' } as any);
        expect(out.background).toBeUndefined();
        expect(out.foreground).toBeUndefined();
        expect(out.primary).toBeDefined();
    });

    it('sigue aplicando un fondo de marca claro al tema claro', () => {
        const out = applyBrand(light, { backgroundColor: '#f5f5f0' } as any);
        expect(out.background).toBe('#f5f5f0');
    });
});
