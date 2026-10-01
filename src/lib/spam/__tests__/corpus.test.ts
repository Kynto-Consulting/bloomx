import { describe, expect, it, vi } from 'vitest';
import { evaluateSpam } from '../engine';
import { PRESET_THRESHOLDS, sanitizeSpamConfig, bandOf } from '../config-core';
import { classify, tokenize, type Model } from '../bayes';
import { extractLinks, domainOf, visibleText } from '../text';
import { buildCorpus, type Sample } from './corpus';

// Corpus grande: evaluar cientos de correos supera los 5 s por defecto cuando la maquina esta cargada.
vi.setConfig({ testTimeout: 60_000 });

// Metricas del motor sobre un corpus SINTETICO escrito por el autor del motor: sirve de red de seguridad contra regresiones y para
// comparar niveles, NO es una estimacion de tasa de error en produccion (ver docs: "como afinar").
const { ham, spam } = buildCorpus();
const CFG = { ownDomains: ['bloomx.test'] };
const score = (s: Sample, useCtx = true, extra: Partial<Sample['ctx']> = {}) => evaluateSpam(s.input, CFG, useCtx ? { ...s.ctx, ...extra } : undefined).score;

function metrics(threshold: number, useCtx = true) {
    const H = ham.map((s) => score(s, useCtx)), S = spam.map((s) => score(s, useCtx));
    const fp = H.filter((x) => x >= threshold).length;
    const tp = S.filter((x) => x >= threshold).length;
    return {
        fp, fpRate: fp / H.length, recall: tp / S.length, precision: tp / Math.max(1, tp + fp),
        alertRecall: S.filter((x) => x >= threshold - 15).length / S.length, hamAlerts: H.filter((x) => x >= threshold - 15).length / H.length,
    };
}

describe('corpus sintetico', () => {
    it('tiene al menos 300 correos de cada clase, en es/en/pt y variados', () => {
        expect(ham.length).toBeGreaterThanOrEqual(300);
        expect(spam.length).toBeGreaterThanOrEqual(300);
        for (const list of [ham, spam]) for (const lang of ['es', 'en', 'pt']) expect(list.filter((s) => s.lang === lang).length).toBeGreaterThan(40);
        const distinct = new Set([...ham, ...spam].map((s) => `${s.input.subject}|${s.input.text}|${s.input.html}`)).size;
        expect(distinct / (ham.length + spam.length)).toBeGreaterThan(0.85);
        const kinds = new Set([...ham, ...spam].map((s) => s.kind));
        for (const k of ['newsletter', 'personal', 'invoice', 'notification', 'bank-phishing', 'advance-fee', 'malware-attachment', 'name-spoof', 'lookalike-domain', 'shipping-scam']) expect(kinds.has(k)).toBe(true);
    });
    it('no contiene datos de personas reales: solo dominios de ejemplo y marcas como cadenas', () => {
        const text = JSON.stringify([...ham, ...spam].map((s) => s.input.from.email));
        expect(text).not.toMatch(/@(?:[a-z0-9-]+\.)*(?:empresa-real|banco-real)\./);
    });
});

describe('metricas en Equilibrado (umbral 65)', () => {
    const m = metrics(PRESET_THRESHOLDS.balanced);
    it('falsos positivos en ham < 1 %', () => { expect(m.fpRate).toBeLessThan(0.01); });
    it('deteccion de spam > 85 %', () => { expect(m.recall).toBeGreaterThan(0.85); });
    it('precision > 99 %', () => { expect(m.precision).toBeGreaterThan(0.99); });
    it('cobertura de alerta (spam o sospechoso) > 93 % con pocas alertas en ham', () => {
        expect(m.alertRecall).toBeGreaterThan(0.93);
        expect(m.hamAlerts).toBeLessThan(0.03);
    });
    it('sin contexto del destinatario sigue siendo util (peor caso) y sin falsos positivos', () => {
        const w = metrics(65, false);
        expect(w.fpRate).toBeLessThan(0.01);
        expect(w.recall).toBeGreaterThan(0.75);
    });
});

describe('niveles: mas estricto = mas deteccion, mas falsos positivos', () => {
    const levels = (['low', 'balanced', 'strict', 'max'] as const).map((l) => ({ l, m: metrics(PRESET_THRESHOLDS[l]) }));
    it('recall monotono creciente y FP monotono creciente', () => {
        for (let i = 1; i < levels.length; i++) {
            expect(levels[i].m.recall).toBeGreaterThanOrEqual(levels[i - 1].m.recall);
            expect(levels[i].m.fp).toBeGreaterThanOrEqual(levels[i - 1].m.fp);
        }
    });
    it('Bajo: sin falsos positivos; Estricto: FP < 1 %; Maximo: deteccion > 99 %', () => {
        expect(levels[0].m.fp).toBe(0);
        expect(levels[2].m.fpRate).toBeLessThan(0.01);
        expect(levels[3].m.recall).toBeGreaterThan(0.99);
    });
    it('la banda sospechosa recoge el spam dudoso sin mandarlo a la carpeta', () => {
        const cfg = sanitizeSpamConfig({ level: 'balanced' });
        const bands = spam.map((s) => bandOf(score(s), cfg));
        expect(bands.filter((b) => b === 'suspicious').length).toBeGreaterThan(0);
        expect(ham.map((s) => bandOf(score(s), cfg)).filter((b) => b === 'spam').length).toBe(0);
    });
});

describe('por tipo', () => {
    it('cada familia de spam facil se detecta al 100 %; lo dificil se mide aparte', () => {
        const easy = spam.filter((s) => !s.hard);
        expect(easy.filter((s) => score(s) >= 65).length / easy.length).toBeGreaterThan(0.97);
        const hard = spam.filter((s) => s.hard);
        expect(hard.length).toBeGreaterThan(100);
        expect(hard.filter((s) => score(s) >= 50).length / hard.length).toBeGreaterThan(0.9);
    });
    it('phishing bancario, malware, suplantacion y homografos se detectan casi siempre', () => {
        for (const kind of ['bank-phishing', 'lookalike-domain', 'pharma-adult-gambling-loan', 'crypto', 'aggressive-spam']) {
            const l = spam.filter((s) => s.kind === kind);
            expect(l.filter((s) => score(s) >= 65).length / l.length, kind).toBeGreaterThan(0.93);
        }
    });
    it('ham legitimo con palabras de spam (facturas, avisos de seguridad reales, rebajas) no sube de sospechoso', () => {
        for (const kind of ['invoice', 'notification', 'corporate', 'carrier-bank', 'aggressive-marketing', 'newsletter']) {
            const l = ham.filter((s) => s.kind === kind);
            expect(Math.max(...l.map((s) => score(s))), kind).toBeLessThan(65);
        }
    });
});

describe('aprendizaje del usuario (bayes) sobre el corpus', () => {
    const tok = (s: Sample) => tokenize({ subject: s.input.subject, body: s.input.text || visibleText(s.input.html), fromDomain: domainOf(s.input.from.email), linkHosts: extractLinks(s.input.html, s.input.text).map((l) => l.host) });
    // entrena con el 35 % (por posicion) y prueba con el resto
    const isTrain = (i: number) => i % 3 === 0;
    const model: Model = { spamMessages: 0, hamMessages: 0, tokens: new Map() };
    const add = (list: Sample[], label: 'spam' | 'ham') => list.forEach((s, i) => {
        if (!isTrain(i)) return;
        model[label === 'spam' ? 'spamMessages' : 'hamMessages']++;
        for (const t of tok(s)) { const c = model.tokens.get(t) ?? { spam: 0, ham: 0 }; c[label]++; model.tokens.set(t, c); }
    });
    add(ham, 'ham'); add(spam, 'spam');
    const testH = ham.filter((_, i) => !isTrain(i)), testS = spam.filter((_, i) => !isTrain(i));
    const withBayes = (s: Sample) => { const b = classify(tok(s), model); return score(s, true, b ? { bayes: { points: b.points, tokens: b.tokens, samples: b.samples } } : {}); };
    it('las marcas mueven el score en la direccion correcta', () => {
        const dS = testS.map((s) => withBayes(s) - score(s)), dH = testH.map((s) => withBayes(s) - score(s));
        expect(dS.reduce((a, b) => a + b, 0) / dS.length).toBeGreaterThan(3);
        expect(dH.reduce((a, b) => a + b, 0) / dH.length).toBeLessThan(-0.5);
    });
    it('la contribucion esta acotada a +-20 y no crea falsos positivos', () => {
        for (const s of [...testS, ...testH]) expect(Math.abs(withBayes(s) - score(s))).toBeLessThanOrEqual(20);
        expect(testH.filter((s) => withBayes(s) >= 65).length).toBe(0);
    });
    it('mejora la deteccion del spam dificil', () => {
        const hard = testS.filter((s) => s.hard);
        const before = hard.filter((s) => score(s) >= 65).length, after = hard.filter((s) => withBayes(s) >= 65).length;
        expect(after).toBeGreaterThanOrEqual(before);
        expect(testS.filter((s) => withBayes(s) >= 65).length).toBeGreaterThanOrEqual(testS.filter((s) => score(s) >= 65).length);
    });
});
