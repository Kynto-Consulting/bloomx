import { describe, expect, it } from 'vitest';
import { resolveInstanceUrl } from '../instance-url-hint';

const es = 'Public Key. URL a pegar en "Interactions Endpoint URL": https://<tu-instancia>/api/ext/core-discordlib/interactions';

describe('resolveInstanceUrl', () => {
    it('sustituye el marcador por el origen de la instancia', () => {
        const r = resolveInstanceUrl(es, 'https://bloomx.arubik.dev');
        expect(r.url).toBe('https://bloomx.arubik.dev/api/ext/core-discordlib/interactions');
        expect(r.text).toContain('https://bloomx.arubik.dev/api/ext/core-discordlib/interactions');
        expect(r.text).not.toContain('<tu-instancia>');
    });
    it('funciona en ingles y no toca descripciones sin marcador u origenes no validos', () => {
        expect(resolveInstanceUrl('x https://<your-instance>/api/ext/a/b', 'https://m.example.com').url).toBe('https://m.example.com/api/ext/a/b');
        expect(resolveInstanceUrl('sin url', 'https://m.example.com')).toEqual({ text: 'sin url', url: null });
        expect(resolveInstanceUrl(es, 'javascript:alert(1)').url).toBeNull();
        expect(resolveInstanceUrl(es, '').url).toBeNull();
    });
});
