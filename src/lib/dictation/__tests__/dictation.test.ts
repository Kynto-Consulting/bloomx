import { describe, expect, it } from 'vitest';
import {
    MAX_AUTO_RESTARTS, classifyDictationError, collectTranscript, dictationLocale, dictationMessages, formatDictatedText, getSpeechRecognitionCtor,
    issueMessage, shouldRestart, speechLang,
} from '../dictation';

const result = (text: string, isFinal: boolean) => ({ isFinal, 0: { transcript: text }, length: 1 });

describe('getSpeechRecognitionCtor', () => {
    it('prefers the standard constructor and falls back to webkit', () => {
        class A {}
        class B {}
        expect(getSpeechRecognitionCtor({ SpeechRecognition: A, webkitSpeechRecognition: B })).toBe(A);
        expect(getSpeechRecognitionCtor({ webkitSpeechRecognition: B })).toBe(B);
    });
    it('returns null when unsupported or no window', () => {
        expect(getSpeechRecognitionCtor({})).toBeNull();
        expect(getSpeechRecognitionCtor(null)).toBeNull();
        expect(getSpeechRecognitionCtor({ SpeechRecognition: 'x' })).toBeNull();
    });
});

describe('speechLang / dictationLocale', () => {
    it('maps app locales to BCP-47', () => {
        expect(speechLang('es')).toBe('es-ES');
        expect(speechLang('en')).toBe('en-US');
        expect(speechLang('en-GB')).toBe('en-GB');
        expect(speechLang('pt')).toBe('pt-BR');
        expect(speechLang(undefined)).toBe('es-ES');
    });
    it('narrows to es/en for messages', () => {
        expect(dictationLocale('en-US')).toBe('en');
        expect(dictationLocale('fr')).toBe('es');
    });
});

describe('classifyDictationError', () => {
    it('flags permission, microphone and network problems as fatal', () => {
        expect(classifyDictationError('not-allowed')).toEqual({ issue: 'denied', fatal: true });
        expect(classifyDictationError('service-not-allowed')).toEqual({ issue: 'denied', fatal: true });
        expect(classifyDictationError('audio-capture')).toEqual({ issue: 'no-mic', fatal: true });
        expect(classifyDictationError('network')).toEqual({ issue: 'network', fatal: true });
    });
    it('treats no-speech as recoverable and aborted as not an error', () => {
        expect(classifyDictationError('no-speech')).toEqual({ issue: 'no-speech', fatal: false });
        expect(classifyDictationError('aborted')).toEqual({ issue: null, fatal: false });
    });
    it('unknown codes are fatal generic errors', () => {
        expect(classifyDictationError('weird')).toEqual({ issue: 'other', fatal: true });
        expect(classifyDictationError(undefined)).toEqual({ issue: 'other', fatal: true });
    });
});

describe('shouldRestart', () => {
    it('restarts only while wanted, not fatal and under the cap', () => {
        expect(shouldRestart({ wanted: true, fatal: false, restarts: 0 })).toBe(true);
        expect(shouldRestart({ wanted: false, fatal: false, restarts: 0 })).toBe(false);
        expect(shouldRestart({ wanted: true, fatal: true, restarts: 0 })).toBe(false);
        expect(shouldRestart({ wanted: true, fatal: false, restarts: MAX_AUTO_RESTARTS })).toBe(false);
    });
});

describe('collectTranscript', () => {
    it('splits final and interim from resultIndex on', () => {
        const event = { resultIndex: 1, results: [result('old ', true), result(' hola ', true), result('que tal', false)] };
        expect(collectTranscript(event)).toEqual({ final: 'hola', interim: 'que tal' });
    });
    it('is safe with empty or malformed input', () => {
        expect(collectTranscript({ resultIndex: 0, results: [] })).toEqual({ final: '', interim: '' });
        expect(collectTranscript({ resultIndex: NaN, results: [{ isFinal: true, 0: undefined }] })).toEqual({ final: '', interim: '' });
        expect(collectTranscript(undefined as never)).toEqual({ final: '', interim: '' });
    });
});

describe('formatDictatedText', () => {
    it('escapes markup, collapses whitespace and leaves a trailing space', () => {
        expect(formatDictatedText('  a <b>  &  c ')).toBe('a &lt;b&gt; &amp; c ');
    });
    it('returns empty when there is nothing to insert', () => {
        expect(formatDictatedText('   ')).toBe('');
        expect(formatDictatedText(undefined as never)).toBe('');
    });
});

describe('messages', () => {
    it('provides es and en with the same shape', () => {
        const es = dictationMessages('es');
        const en = dictationMessages('en');
        expect(Object.keys(es.errors).sort()).toEqual(Object.keys(en.errors).sort());
        expect(es.start).not.toBe(en.start);
    });
    it('maps every issue to a message', () => {
        const m = dictationMessages('en');
        for (const issue of ['denied', 'no-speech', 'no-mic', 'network', 'unsupported', 'language', 'other'] as const) expect(issueMessage(issue, m)).not.toBe('');
        expect(issueMessage(null, m)).toBe('');
    });
});
