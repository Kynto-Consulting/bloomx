/**
 * Logica PURA del dictado por voz del compositor (sin React ni DOM): deteccion de la Web Speech API, idioma de
 * reconocimiento, clasificacion de errores, extraccion del texto final/provisional, formato del texto insertado y
 * textos es/en. El hook `useDictation` solo orquesta esto con el objeto SpeechRecognition del navegador.
 */

export type DictationLocale = 'es' | 'en';

/** Forma minima que usamos de SpeechRecognition (el tipo DOM no esta en todos los lib.dom de TS). */
export interface SpeechRecognitionLike {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives?: number;
    onstart: ((ev: unknown) => void) | null;
    onend: ((ev: unknown) => void) | null;
    onerror: ((ev: { error?: string; message?: string }) => void) | null;
    onresult: ((ev: SpeechResultEventLike) => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
}

export interface SpeechResultEventLike {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } | undefined; length?: number }>;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognitionCtor(win: unknown): SpeechRecognitionCtor | null {
    if (!win || typeof win !== 'object') return null;
    const w = win as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    return typeof ctor === 'function' ? (ctor as SpeechRecognitionCtor) : null;
}

/** Idioma BCP-47 del reconocedor a partir del idioma de la app (es -> es-ES, en -> en-US). */
export function speechLang(locale: string | undefined | null): string {
    const raw = String(locale || '').trim();
    if (/^[a-z]{2}-[A-Za-z]{2}$/.test(raw)) return raw;
    const base = raw.toLowerCase().split('-')[0];
    if (base === 'en') return 'en-US';
    if (base === 'es') return 'es-ES';
    if (base === 'pt') return 'pt-BR';
    if (base === 'fr') return 'fr-FR';
    if (base === 'de') return 'de-DE';
    if (base === 'it') return 'it-IT';
    return 'es-ES';
}

export function dictationLocale(locale: string | undefined | null): DictationLocale {
    return String(locale || '').toLowerCase().startsWith('en') ? 'en' : 'es';
}

// ---------------------------------------------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------------------------------------------

export type DictationIssue = 'denied' | 'no-speech' | 'no-mic' | 'network' | 'unsupported' | 'language' | 'other';

export interface ClassifiedError {
    issue: DictationIssue | null;
    /** true = no tiene sentido reintentar solo (permiso denegado, sin micrófono...). */
    fatal: boolean;
}

/** Codigo `error` de SpeechRecognition -> incidencia. `aborted` (parada voluntaria) no es un error. */
export function classifyDictationError(code: string | undefined | null): ClassifiedError {
    switch (code) {
        case 'not-allowed':
        case 'service-not-allowed':
            return { issue: 'denied', fatal: true };
        case 'audio-capture':
            return { issue: 'no-mic', fatal: true };
        case 'network':
            return { issue: 'network', fatal: true };
        case 'language-not-supported':
            return { issue: 'language', fatal: true };
        case 'no-speech':
            return { issue: 'no-speech', fatal: false };
        case 'aborted':
            return { issue: null, fatal: false };
        default:
            return { issue: 'other', fatal: true };
    }
}

/** Reinicio automatico: Chrome corta la escucha tras unos segundos de silencio aunque `continuous` sea true. */
export const MAX_AUTO_RESTARTS = 8;

export function shouldRestart(input: { wanted: boolean; fatal: boolean; restarts: number }): boolean {
    return input.wanted && !input.fatal && input.restarts < MAX_AUTO_RESTARTS;
}

// ---------------------------------------------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------------------------------------------

/** Junta los fragmentos nuevos de un evento de resultado: texto final (a insertar) y provisional (a mostrar). */
export function collectTranscript(event: SpeechResultEventLike): { final: string; interim: string } {
    let final = '';
    let interim = '';
    const results = event?.results;
    if (!results) return { final, interim };
    const start = Number.isFinite(event.resultIndex) ? Math.max(0, event.resultIndex) : 0;
    for (let i = start; i < results.length; i++) {
        const item = results[i];
        const piece = item && item[0] && typeof item[0].transcript === 'string' ? item[0].transcript : '';
        if (!piece) continue;
        if (item.isFinal) final += piece;
        else interim += piece;
    }
    return { final: final.trim(), interim: interim.trim() };
}

export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Texto final -> fragmento HTML para `editor.insertContent`. Escapa HTML (lo dictado es texto, nunca marcado),
 * normaliza espacios y deja un espacio final para el siguiente fragmento. Vacio si no hay nada que insertar.
 */
export function formatDictatedText(text: string): string {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    return `${escapeHtml(clean)} `;
}

// ---------------------------------------------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------------------------------------------

export interface DictationMessages {
    start: string;
    stop: string;
    listening: string;
    starting: string;
    unsupportedTooltip: string;
    unsupportedStatus: string;
    heardNothing: string;
    errors: Record<Exclude<DictationIssue, 'unsupported' | 'no-speech'>, string>;
}

const ES: DictationMessages = {
    start: 'Dictar',
    stop: 'Detener dictado',
    listening: 'Escuchando... habla ahora',
    starting: 'Activando el micrófono...',
    unsupportedTooltip: 'Tu navegador no admite el dictado por voz. Usa Chrome, Edge o Safari.',
    unsupportedStatus: 'El dictado por voz no está disponible en este navegador.',
    heardNothing: 'No se escuchó nada. Pulsa el micrófono para intentarlo de nuevo.',
    errors: {
        denied: 'Permiso de micrófono denegado. Permítelo en los ajustes del sitio del navegador y vuelve a intentarlo.',
        'no-mic': 'No se encontró ningún micrófono. Conecta uno y vuelve a intentarlo.',
        network: 'El servicio de reconocimiento de voz no respondió (se necesita conexión a internet).',
        language: 'El navegador no reconoce este idioma para el dictado.',
        other: 'No se pudo dictar. Vuelve a intentarlo.',
    },
};

const EN: DictationMessages = {
    start: 'Dictate',
    stop: 'Stop dictation',
    listening: 'Listening... speak now',
    starting: 'Turning on the microphone...',
    unsupportedTooltip: 'Your browser does not support voice dictation. Use Chrome, Edge or Safari.',
    unsupportedStatus: 'Voice dictation is not available in this browser.',
    heardNothing: 'Nothing was heard. Press the microphone to try again.',
    errors: {
        denied: 'Microphone permission denied. Allow it in the browser site settings and try again.',
        'no-mic': 'No microphone found. Connect one and try again.',
        network: 'The speech recognition service did not respond (an internet connection is required).',
        language: 'The browser does not recognise this language for dictation.',
        other: 'Dictation failed. Please try again.',
    },
};

export function dictationMessages(locale: string | undefined | null): DictationMessages {
    return dictationLocale(locale) === 'en' ? EN : ES;
}

export function issueMessage(issue: DictationIssue | null, messages: DictationMessages): string {
    if (!issue) return '';
    if (issue === 'unsupported') return messages.unsupportedStatus;
    if (issue === 'no-speech') return messages.heardNothing;
    return messages.errors[issue];
}
