import { regexProblem } from '@/lib/expansions/settings-schema';

/**
 * Vista previa APROXIMADA de la extension DLP, ejecutada en el navegador sobre un texto de ejemplo. Replica la logica de
 * bloomx-extensions/dlp/server.js (palabras clave, detectores con digito de control y patrones propios validados con regexProblem),
 * pero es una APROXIMACION: el servidor es la fuente de verdad. El texto no sale del navegador y el resultado solo lista
 * CATEGORIAS detectadas (nunca el dato encontrado).
 */

export const DLP_DETECTOR_IDS = ['cards', 'iban', 'ssn', 'dni', 'privateKeys', 'apiKeys', 'jwt', 'passwords'] as const;
export type DlpDetectorId = (typeof DLP_DETECTOR_IDS)[number];

const MAX_TEXT = 200_000;
const MAX_CUSTOM = 20;
const ZERO_WIDTH = /[​-‍⁠﻿]/g;

export function normalizeText(input: string): string {
    return input.slice(0, MAX_TEXT).replace(/<[^>]*>/g, ' ').replace(ZERO_WIDTH, '').replace(/[ \t\r\n ]+/g, ' ').toLowerCase();
}

export function luhnValid(digits: string): boolean {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let n = digits.charCodeAt(i) - 48;
        if (alt) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
        alt = !alt;
    }
    return sum % 10 === 0;
}

export function ibanValid(raw: string): boolean {
    const iban = raw.replace(/\s+/g, '').toUpperCase();
    if (iban.length < 15 || iban.length > 34) return false;
    const rearranged = iban.slice(4) + iban.slice(0, 4);
    let remainder = 0;
    for (const ch of rearranged) {
        const code = ch.charCodeAt(0);
        const value = code >= 65 && code <= 90 ? String(code - 55) : ch;
        for (const d of value) remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
    }
    return remainder === 1;
}

const DNI_LETTERS = 'trwagmyfpdxbnjzsqvhlcke';
const dniValid = (digits: string, letter: string) => DNI_LETTERS[Number(digits) % 23] === letter.toLowerCase();

function some(re: RegExp, text: string, test: (m: RegExpExecArray) => boolean): boolean {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) if (test(m)) return true;
    return false;
}

export const DLP_DETECTORS: Record<DlpDetectorId, (text: string) => boolean> = {
    cards: (t) => some(/(?:\d[ -]?){13,19}/g, t, (m) => {
        const digits = m[0].replace(/\D/g, '');
        return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) && !/^(\d)\1+$/.test(digits);
    }),
    iban: (t) => some(/\b[a-z]{2}\d{2}(?: ?[a-z0-9]{4}){2,7}(?: ?[a-z0-9]{1,4})?\b/gi, t, (m) => ibanValid(m[0])),
    ssn: (t) => /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/.test(t),
    dni: (t) => some(/\b([xyz]?)(\d{7,8})[- ]?([a-z])\b/gi, t, (m) => {
        const prefix = m[1].toLowerCase();
        if (prefix) return m[2].length === 7 && dniValid(String('xyz'.indexOf(prefix)) + m[2], m[3]);
        return m[2].length === 8 && dniValid(m[2], m[3]);
    }),
    privateKeys: (t) => /-----begin (?:rsa |ec |dsa |openssh |pgp )?private key-----/.test(t),
    apiKeys: (t) =>
        /\b(?:akia|asia)[0-9a-z]{16}\b/i.test(t) ||
        /\baiza[0-9a-z_-]{35}\b/i.test(t) ||
        /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9a-z]{36,}\b/i.test(t) ||
        /\bxox[abprs]-[0-9a-z-]{10,}\b/i.test(t) ||
        /\bsk_(?:live|test)_[0-9a-z]{16,}\b/i.test(t),
    jwt: (t) => /\beyj[a-z0-9_-]{10,}\.eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/i.test(t),
    passwords: (t) => /\b(?:password|passwd|pwd|secret|api[_ -]?key|token)\s*[:=]\s*\S{6,}/i.test(t),
};

export interface DlpPreviewConfig {
    keywords: string[];
    detectors: string[];
    customPatterns: string[];
}

export type DlpCategory = { id: DlpDetectorId | 'keyword' | 'custom'; count: number };
export interface DlpPreviewResult {
    categories: DlpCategory[];
    /** Patrones propios descartados (el servidor tambien los ignora) con el motivo. */
    ignoredPatterns: { index: number; problem: string }[];
}

export function runDlpPreview(text: string, config: DlpPreviewConfig): DlpPreviewResult {
    const haystack = normalizeText(text);
    const categories: DlpCategory[] = [];

    const keywords = Array.from(new Set(config.keywords.map((k) => normalizeText(k).trim()).filter(Boolean)));
    const keywordHits = keywords.filter((k) => haystack.includes(k)).length;
    if (keywordHits) categories.push({ id: 'keyword', count: keywordHits });

    for (const id of config.detectors) {
        if ((DLP_DETECTOR_IDS as readonly string[]).includes(id) && DLP_DETECTORS[id as DlpDetectorId](haystack)) categories.push({ id: id as DlpDetectorId, count: 1 });
    }

    const ignoredPatterns: DlpPreviewResult['ignoredPatterns'] = [];
    let customHits = 0;
    config.customPatterns.slice(0, MAX_CUSTOM).forEach((pattern, index) => {
        const problem = regexProblem(pattern);
        if (problem) { ignoredPatterns.push({ index, problem }); return; }
        try { if (new RegExp(pattern, 'i').test(haystack)) customHits++; } catch { ignoredPatterns.push({ index, problem: 'invalid' }); }
    });
    if (customHits) categories.push({ id: 'custom', count: customHits });

    return { categories, ignoredPatterns };
}

/** La extension es el DLP del core (id o esquema con `keywords` y `detectors`). */
export function isDlpSchema(extensionId: string, keys: readonly string[]): boolean {
    return extensionId === 'core-dlp' || (keys.includes('keywords') && keys.includes('detectors'));
}
