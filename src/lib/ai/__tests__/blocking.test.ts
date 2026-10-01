import { describe, expect, it } from 'vitest';
import { AI_ALL_ENABLED, declaredAiFeatures, extensionRequiresAi, isExtensionBlockedByAi } from '../blocking';
import type { AiBlockState } from '../types';

const state = (over: Partial<AiBlockState> = {}): AiBlockState => ({ ...structuredClone(AI_ALL_ENABLED), ...over });
const off = (f: string): AiBlockState => state({ features: { ...AI_ALL_ENABLED.features, [f]: false } as AiBlockState['features'] });

describe('extensionRequiresAi', () => {
    it('permiso AI / AI_GENERATE, categoria ai (string o lista) y bloque ai', () => {
        expect(extensionRequiresAi({ permissions: ['AI'] })).toBe(true);
        expect(extensionRequiresAi({ permissions: ['AI_GENERATE'] })).toBe(true);
        expect(extensionRequiresAi({ category: 'AI' })).toBe(true);
        expect(extensionRequiresAi({ categories: ['tools', 'ai'] })).toBe(true);
        expect(extensionRequiresAi({ ai: { features: ['composer'] } })).toBe(true);
        expect(extensionRequiresAi(JSON.stringify({ permissions: ['AI'] }))).toBe(true);
    });
    it('manifest sin IA o invalido', () => {
        expect(extensionRequiresAi({ permissions: ['MAIL_READ'], category: 'tools' })).toBe(false);
        expect(extensionRequiresAi('{no json')).toBe(false);
        expect(extensionRequiresAi(null)).toBe(false);
    });
    it('declaredAiFeatures normaliza alias y deduplica', () => {
        expect(declaredAiFeatures({ ai: { features: ['smart_reply', 'smart-reply', 'composer-helper', 'zzz'] } })).toEqual(['smart-reply', 'composer']);
    });
});

describe('isExtensionBlockedByAi', () => {
    const m = { id: 'ext.a', permissions: ['AI'], ai: { features: ['summarize'] } };
    it('sin IA nunca se bloquea', () => {
        expect(isExtensionBlockedByAi({ id: 'x' }, state({ enabled: false }))).toMatchObject({ requiresAi: false, blocked: false });
    });
    it('IA global off', () => {
        expect(isExtensionBlockedByAi(m, state({ enabled: false }))).toMatchObject({ blocked: true, reason: 'ai_disabled' });
    });
    it('extension desactivada por el admin', () => {
        expect(isExtensionBlockedByAi(m, state({ extensions: { 'ext.a': false } }))).toMatchObject({ blocked: true, reason: 'extension_disabled' });
        expect(isExtensionBlockedByAi(m, state({ extensions: { 'ext.b': false } })).blocked).toBe(false);
    });
    it('funcion desactivada', () => {
        expect(isExtensionBlockedByAi(m, off('summarize'))).toMatchObject({ blocked: true, reason: 'feature_disabled', disabledFeatures: ['summarize'] });
        expect(isExtensionBlockedByAi(m, off('translate')).blocked).toBe(false);
    });
    it('required:false degrada en lugar de bloquear', () => {
        const opt = { ...m, ai: { features: ['summarize'], required: false } };
        expect(isExtensionBlockedByAi(opt, state({ enabled: false }))).toMatchObject({ blocked: false, degraded: true });
        expect(isExtensionBlockedByAi(opt, off('summarize'))).toMatchObject({ blocked: false, degraded: true });
        expect(isExtensionBlockedByAi(opt, state())).toMatchObject({ blocked: false, degraded: false });
    });
    it('reactivar desbloquea', () => {
        expect(isExtensionBlockedByAi(m, state({ enabled: false })).blocked).toBe(true);
        expect(isExtensionBlockedByAi(m, state({ enabled: true })).blocked).toBe(false);
        expect(isExtensionBlockedByAi(m, state({ extensions: { 'ext.a': false } })).blocked).toBe(true);
        expect(isExtensionBlockedByAi(m, state({ extensions: {} })).blocked).toBe(false);
    });
    it('instancia antigua (todo permitido)', () => {
        expect(isExtensionBlockedByAi(m, AI_ALL_ENABLED).blocked).toBe(false);
    });
});
