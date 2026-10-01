import { describe, expect, it } from 'vitest';
import { applyBodyPolicy, applySystemPrefix, runInputGuardrails, runOutputGuardrails } from '../guardrails';
import { DEFAULT_CONFIG, type AiGuardrails, type GuardrailMode } from '../types';

const g = (over: Partial<AiGuardrails> = {}): AiGuardrails => ({ ...structuredClone(DEFAULT_CONFIG.guardrails), ...over });
const CARD = '4111 1111 1111 1111';
const MODES: GuardrailMode[] = ['off', 'log', 'warn', 'enforce'];

describe('runInputGuardrails', () => {
    for (const mode of MODES) {
        it(`redaccion modo ${mode}`, () => {
            const r = runInputGuardrails([`tarjeta ${CARD}`], g({ redaction: { mode, categories: DEFAULT_CONFIG.guardrails.redaction.categories } }));
            if (mode === 'enforce') { expect(r.texts[0]).toBe('tarjeta [REDACTED:card]'); expect(r.redactions).toBe(1); expect(r.warnings).toContain('redacted'); }
            else { expect(r.texts[0]).toContain(CARD); expect(r.redactions).toBe(0); }
            if (mode === 'off') expect(r.flags).toEqual([]);
            if (mode === 'log') { expect(r.flags).toEqual(['pii:1']); expect(r.warnings).toEqual([]); }
            if (mode === 'warn') { expect(r.flags).toEqual(['pii:1']); expect(r.warnings).toEqual(['sensitive_data']); }
        });
    }
    for (const mode of MODES) {
        it(`temas bloqueados modo ${mode}`, () => {
            const r = runInputGuardrails(['hablemos de armas'], g({ blockedTopics: { mode, patterns: ['armas?'] } }));
            expect(r.blocked).toBe(mode === 'enforce' ? 'blocked_topic' : null);
            expect(r.flags.includes('topic')).toBe(mode !== 'off');
            expect(r.warnings.includes('blocked_topic')).toBe(mode === 'warn');
        });
    }
    it('un patron peligroso (ReDoS) no cuelga la peticion', () => {
        const t0 = Date.now();
        runInputGuardrails(['a'.repeat(5000) + '!'], g({ blockedTopics: { mode: 'enforce', patterns: ['(a+)+$'] } }));
        expect(Date.now() - t0).toBeLessThan(2000);
    });
    it('sin coincidencia no bloquea', () => {
        expect(runInputGuardrails(['hola'], g({ blockedTopics: { mode: 'enforce', patterns: ['armas'] } })).blocked).toBeNull();
    });
});

describe('runOutputGuardrails', () => {
    it('patron: enforce bloquea; warn avisa; log marca; off ignora', () => {
        const mk = (mode: GuardrailMode) => runOutputGuardrails('texto secreto', g({ output: { mode, maxChars: 1000, patterns: ['secreto'] } }));
        expect(mk('enforce').blocked).toBe('output_pattern');
        expect(mk('warn')).toMatchObject({ blocked: null, warnings: ['output_pattern'] });
        expect(mk('log')).toMatchObject({ blocked: null, warnings: [], flags: ['output_pattern'] });
        expect(mk('off')).toMatchObject({ blocked: null, flags: [] });
    });
    it('trunca por longitud solo en enforce', () => {
        const long = 'x'.repeat(300);
        expect(runOutputGuardrails(long, g({ output: { mode: 'enforce', maxChars: 100, patterns: [] } })).text).toHaveLength(100);
        const w = runOutputGuardrails(long, g({ output: { mode: 'warn', maxChars: 100, patterns: [] } }));
        expect(w.text).toHaveLength(300);
        expect(w.warnings).toEqual(['output_long']);
    });
});

describe('applyBodyPolicy / applySystemPrefix', () => {
    it('full, subject-only y snippet', () => {
        const parts = { subject: 'Hola', body: 'a'.repeat(50) };
        expect(applyBodyPolicy(parts, { mode: 'full', snippetChars: 10 }).trimmed).toBe(false);
        const so = applyBodyPolicy(parts, { mode: 'subject-only', snippetChars: 10 });
        expect(so.text).toBe('Subject: Hola');
        expect(so.trimmed).toBe(true);
        const sn = applyBodyPolicy(parts, { mode: 'snippet', snippetChars: 10 });
        expect(sn.text).toBe(`Subject: Hola\n\nBody:\n${'a'.repeat(10)}`);
        expect(sn.trimmed).toBe(true);
        expect(applyBodyPolicy({ body: 'corto' }, { mode: 'snippet', snippetChars: 10 }).trimmed).toBe(false);
    });
    it('prefijo de system', () => {
        expect(applySystemPrefix('P', 'S')).toBe('P\n\nS');
        expect(applySystemPrefix('P', undefined)).toBe('P');
        expect(applySystemPrefix('', 'S')).toBe('S');
        expect(applySystemPrefix('  ', '')).toBe('');
    });
});
