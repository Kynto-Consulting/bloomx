/**
 * Normaliza (y VALIDA) lo que devuelve una extension de conferencia o un adaptador del host antes de enviarlo al
 * navegador: el resultado de una extension es un dato externo, no se confia en su forma.
 */
import { analyzeMeetingUrl } from './hosts';
import {
    ConferencingError,
    PROVIDER_INFO,
    type ConferencingAuthMode,
    type ConferencingMeeting,
    type ConferencingProviderId,
    type DialIn,
    type MeetingAttachment,
} from './types';

const MODES: readonly string[] = ['server-to-server', 'user-oauth', 'service-account', 'google-account', 'custom-link'];
const MAX_ATTACHMENT_B64 = 300_000;

function str(v: unknown, max: number): string | null {
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    // eslint-disable-next-line no-control-regex
    const s = String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    return s ? s.slice(0, max) : null;
}

function cleanDialIn(raw: unknown): DialIn[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const out: DialIn[] = [];
    for (const item of raw.slice(0, 10)) {
        const number = str((item as any)?.number, 40);
        if (!number || !/^[+0-9()\-\s.,#*;x]{3,40}$/i.test(number)) continue;
        const country = str((item as any)?.country, 60) ?? undefined;
        const code = str((item as any)?.code, 40) ?? undefined;
        out.push({ number, ...(country ? { country } : {}), ...(code ? { code } : {}) });
    }
    return out.length ? out : undefined;
}

function cleanAttachment(raw: any): MeetingAttachment | null {
    if (!raw || typeof raw !== 'object') return null;
    const filename = str(raw.filename, 120)?.replace(/[\\/:*?"<>|]+/g, '_');
    const mimeType = str(raw.mimeType, 100);
    const b64 = typeof raw.contentBase64 === 'string' ? raw.contentBase64 : '';
    if (!filename || !mimeType || !/^text\/calendar/i.test(mimeType)) return null;
    if (!b64 || b64.length > MAX_ATTACHMENT_B64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
    return { filename, mimeType, contentBase64: b64 };
}

/** Extrae el codigo de una sala de Google Meet de su enlace (abc-defg-hij) para usarlo como id de reserva. */
function meetCodeFromUrl(url: string): string | null {
    const m = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i.exec(url);
    return m ? m[1].toLowerCase() : null;
}

export function normalizeMeeting(provider: ConferencingProviderId, raw: any, fallbackMode: ConferencingAuthMode | null = null): ConferencingMeeting {
    const joinCandidate = raw?.joinUrl ?? raw?.meetUrl ?? raw?.join_url ?? raw?.meetingUri;
    const join = analyzeMeetingUrl(joinCandidate);
    if (!join) throw new ConferencingError('provider_error', 'The provider returned an invalid meeting link');

    const host = raw?.hostUrl ?? raw?.start_url;
    const hostInfo = host ? analyzeMeetingUrl(host) : null;
    const meetingId = str(raw?.meetingId ?? raw?.id, 200) ?? meetCodeFromUrl(join.url) ?? join.url.slice(-60);
    const mode = typeof raw?.mode === 'string' && MODES.includes(raw.mode) ? (raw.mode as ConferencingAuthMode) : fallbackMode;
    const attachment = cleanAttachment(raw?.attachment);

    return {
        provider,
        providerName: PROVIDER_INFO[provider].name,
        joinUrl: join.url,
        hostUrl: hostInfo ? hostInfo.url : null,
        meetingId,
        passcode: str(raw?.passcode ?? raw?.password, 64),
        dialIn: cleanDialIn(raw?.dialIn),
        topic: str(raw?.topic, 200),
        mode,
        ...(attachment ? { attachment } : {}),
    };
}
