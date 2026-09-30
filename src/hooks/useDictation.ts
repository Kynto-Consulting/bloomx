'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    classifyDictationError, collectTranscript, formatDictatedText, getSpeechRecognitionCtor, shouldRestart, speechLang,
    type DictationIssue, type SpeechRecognitionLike,
} from '@/lib/dictation/dictation';

export type DictationStatus = 'idle' | 'starting' | 'listening';

export interface UseDictationOptions {
    /** Idioma de la app (es/en): define el idioma de reconocimiento. */
    locale: string;
    /** Recibe el fragmento FINAL ya formateado (HTML escapado + espacio final) para insertarlo en el cursor. */
    onText: (html: string) => void;
}

/**
 * Dictado con la Web Speech API. `interim` es el texto provisional (aun no confirmado); `issue` la ultima incidencia
 * (permiso denegado, sin microfono, red...). Se detiene solo al desmontar; `stop()` es seguro de llamar siempre.
 */
export function useDictation({ locale, onText }: UseDictationOptions) {
    const [supported, setSupported] = useState(true);
    const [status, setStatus] = useState<DictationStatus>('idle');
    const [interim, setInterim] = useState('');
    const [issue, setIssue] = useState<DictationIssue | null>(null);
    const recRef = useRef<SpeechRecognitionLike | null>(null);
    const wantedRef = useRef(false);
    const fatalRef = useRef(false);
    const restartsRef = useRef(0);
    const onTextRef = useRef(onText);
    onTextRef.current = onText;
    const localeRef = useRef(locale);
    localeRef.current = locale;

    // Solo en cliente: durante SSR no se sabe, asi que se evalua al montar.
    useEffect(() => {
        setSupported(getSpeechRecognitionCtor(typeof window === 'undefined' ? null : window) !== null);
    }, []);

    const teardown = useCallback(() => {
        const rec = recRef.current;
        recRef.current = null;
        if (rec) {
            rec.onstart = rec.onend = rec.onerror = rec.onresult = null;
            try { rec.abort(); } catch { /* ya parado */ }
        }
    }, []);

    const begin = useCallback((): boolean => {
        const Ctor = getSpeechRecognitionCtor(typeof window === 'undefined' ? null : window);
        if (!Ctor) { setIssue('unsupported'); setSupported(false); return false; }
        const rec = new Ctor();
        rec.lang = speechLang(localeRef.current);
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.onstart = () => setStatus('listening');
        rec.onresult = (event) => {
            restartsRef.current = 0;
            const { final, interim: provisional } = collectTranscript(event);
            setInterim(provisional);
            if (final) {
                const html = formatDictatedText(final);
                if (html) onTextRef.current(html);
            }
        };
        rec.onerror = (event) => {
            const { issue: found, fatal } = classifyDictationError(event?.error);
            if (fatal) fatalRef.current = true;
            if (found) setIssue(found);
        };
        rec.onend = () => {
            setInterim('');
            if (recRef.current !== rec) return;
            if (shouldRestart({ wanted: wantedRef.current, fatal: fatalRef.current, restarts: restartsRef.current })) {
                restartsRef.current += 1;
                try { rec.start(); return; } catch { /* cae al cierre */ }
            }
            wantedRef.current = false;
            recRef.current = null;
            setStatus('idle');
        };
        recRef.current = rec;
        try {
            rec.start();
            return true;
        } catch {
            recRef.current = null;
            setIssue('other');
            return false;
        }
    }, []);

    const start = useCallback(() => {
        if (recRef.current) return;
        setIssue(null);
        setInterim('');
        wantedRef.current = true;
        fatalRef.current = false;
        restartsRef.current = 0;
        setStatus('starting');
        if (!begin()) { wantedRef.current = false; setStatus('idle'); }
    }, [begin]);

    const stop = useCallback(() => {
        wantedRef.current = false;
        teardown();
        setInterim('');
        setStatus('idle');
    }, [teardown]);

    const toggle = useCallback(() => { if (recRef.current || wantedRef.current) stop(); else start(); }, [start, stop]);

    useEffect(() => () => { wantedRef.current = false; teardown(); }, [teardown]);

    return { supported, status, listening: status !== 'idle', interim, issue, start, stop, toggle, clearIssue: () => setIssue(null) };
}
