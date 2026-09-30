/**
 * prepareManifest: migra el formato antiguo, valida el UI y aisla los errores por mount (un mount roto no tumba
 * la extension ni la app). Incluye los 21 manifests reales.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getPreparedManifest, prepareManifest } from '../prepare-manifest';

const EXT_ROOT = path.resolve(__dirname, '../../../../../bloomx-extensions');
const base = (mounts: any[], extra: Record<string, any> = {}) => ({ manifestVersion: '2.0', id: 'core-t', name: 'T', version: '1.0.0', mounts, ...extra });

describe('prepareManifest', () => {
    it('un manifest invalido no se carga y devuelve los motivos', () => {
        const prepared = prepareManifest('core-t', { id: 'core-t' });
        expect(prepared.ok).toBe(false);
        expect(prepared.errors.length).toBeGreaterThan(0);
        expect(prepareManifest('x', null).ok).toBe(false);
        expect(prepareManifest('x', [] as any).ok).toBe(false);
    });

    it('migra el formato antiguo y reporta avisos de obsolescencia', () => {
        const prepared = prepareManifest('core-t', base([{ point: 'EMAIL_TOOLBAR', component: { type: 'BUTTON', props: { label: 'Hola', variant: 'primary', className: 'w-full text-purple-600', onClick: { action: 'TOAST', message: 'x' } } } }]));
        expect(prepared.ok).toBe(true);
        expect(prepared.errors).toEqual([]);
        const button = prepared.template.mounts[0].component;
        expect(button.props).toMatchObject({ tone: 'primary', variant: 'solid', fullWidth: true });
        expect(button.props).not.toHaveProperty('className');
        expect(prepared.warnings.some((w) => /className/.test(w.message))).toBe(true);
    });

    it('un mount con UI invalida se sustituye por un estado de error; los demas mounts siguen', () => {
        const prepared = prepareManifest('core-t', base([
            { point: 'EMAIL_TOOLBAR', component: { type: 'BADGE', props: { label: 'x', tone: 'rainbow' } } },
            { point: 'EMAIL_FOOTER', component: { type: 'TEXT', props: { content: 'ok' } } },
        ]));
        expect(prepared.ok).toBe(true);
        expect(prepared.brokenCount).toBe(1);
        expect(prepared.errors[0]).toMatchObject({ path: 'mounts[0].component.props.tone' });
        expect(prepared.template.mounts[0].component.type).toBe('__EXTENSION_ERROR__');
        expect(prepared.template.mounts[0].component.props.issues[0].path).toBe('mounts[0].component.props.tone');
        expect(prepared.template.mounts[1].component).toMatchObject({ type: 'TEXT' });
    });

    it('overlays con errores tambien se aislan y las expresiones invalidas se senalan', () => {
        const prepared = prepareManifest('core-t', base([], { overlays: { a: { type: 'TEXT', props: { content: '${a +}' } }, b: { type: 'TEXT', props: { content: 'ok' } } } }));
        expect(prepared.brokenCount).toBe(1);
        expect(prepared.errors[0].path).toBe('overlays.a.props.content');
        expect(prepared.template.overlays.b.type).toBe('TEXT');
    });

    it('mounts heredados (component como texto, COMPOSER_INIT con config) se normalizan', () => {
        const prepared = prepareManifest('core-t', base([
            { point: 'SETTINGS_TAB', component: 'MODAL', props: { title: 'T', children: [{ type: 'TEXT', props: { content: 'x' } }] } },
            { point: 'COMPOSER_INIT', config: { action: 'APPEND_BODY', storageKey: 'sig' } },
        ]));
        expect(prepared.ok).toBe(true);
        expect(prepared.template.mounts[0].component).toMatchObject({ type: 'MODAL', children: [{ type: 'TEXT' }] });
        expect(prepared.template.mounts[1].component).toMatchObject({ type: 'HEADLESS' });
        expect(prepared.errors).toEqual([]);
    });

    it('no repite avisos de "Componente desconocido" del schema de manifest (manda el de UI)', () => {
        const prepared = prepareManifest('core-t', base([{ point: 'EMAIL_TOOLBAR', component: { type: 'STACK', children: [] } }]));
        expect(prepared.warnings.some((w) => /Componente desconocido/.test(w.message))).toBe(false);
    });

    it('cache: mismo objeto -> mismo resultado; contenido cambiado sin cambiar version -> se recalcula', () => {
        const manifest = base([{ point: 'EMAIL_TOOLBAR', component: { type: 'TEXT', props: { content: 'a' } } }]);
        const first = getPreparedManifest('core-t', manifest);
        expect(getPreparedManifest('core-t', manifest)).toBe(first);
        const edited = base([{ point: 'EMAIL_TOOLBAR', component: { type: 'TEXT', props: { content: 'b' } } }]);
        expect(getPreparedManifest('core-t', edited)).not.toBe(first);
        expect(getPreparedManifest('core-t', edited).template.mounts[0].component.props.content).toBe('b');
    });

    describe('los 21 manifests reales', () => {
        const exists = fs.existsSync(EXT_ROOT);
        const ids = exists ? fs.readdirSync(EXT_ROOT).filter((d) => !d.startsWith('_') && fs.existsSync(path.join(EXT_ROOT, d, 'manifest.json'))) : [];
        it.skipIf(!exists).each(ids)('%s: se prepara sin errores ni mounts rotos', (id) => {
            const manifest = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, id, 'manifest.json'), 'utf8'));
            const prepared = prepareManifest(manifest.id || id, manifest);
            expect(prepared.ok).toBe(true);
            expect(prepared.errors.map((e) => `${e.path}: ${e.message}`)).toEqual([]);
            expect(prepared.brokenCount).toBe(0);
        });
    });
});
