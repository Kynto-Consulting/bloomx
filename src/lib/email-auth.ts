/**
 * Extraccion de resultados de autenticacion de correo entrante (RFC 8601):
 * SPF, DKIM, DMARC (y ARC si existe) a partir de Authentication-Results / Received-SPF.
 *
 * Nota de confianza: solo es fiable la cabecera anadida por NUESTRO MTA receptor (Resend).
 * Si el proveedor no elimina Authentication-Results preexistentes, un remitente podria
 * falsificarla; por eso se prioriza la primera (mas reciente) y se marca `trusted:false`
 * cuando hay varias con veredictos distintos.
 *
 * Controles: NIST SP 800-177r1 sec. 4.2 (SPF), 4.3 (DKIM), 4.5 (DMARC); ISO 27002:2022 5.14.
 */

export type AuthVerdict = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror' | 'unknown';

export type EmailAuthentication = {
    spf: AuthVerdict;
    dkim: AuthVerdict;
    dmarc: AuthVerdict;
    arc: AuthVerdict;
    trusted: boolean;
    /** Resumen legible para UI: 'verified' | 'partial' | 'failed' | 'unknown' */
    summary: 'verified' | 'partial' | 'failed' | 'unknown';
};

const KNOWN: AuthVerdict[] = ['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror'];

function toValues(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((v) => String(v ?? '')).filter(Boolean);
    if (value === null || value === undefined) return [];
    const s = String(value);
    return s ? [s] : [];
}

function getHeader(headers: Record<string, unknown>, name: string): string[] {
    const out: string[] = [];
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === name) out.push(...toValues(value));
    }
    return out;
}

function verdictFrom(text: string, method: string): AuthVerdict {
    const m = text.match(new RegExp(`(?:^|[;\\s])${method}\\s*=\\s*([a-z]+)`, 'i'));
    const v = (m?.[1] || '').toLowerCase() as AuthVerdict;
    return KNOWN.includes(v) ? v : 'unknown';
}

export function parseAuthenticationResults(headersInput: unknown): EmailAuthentication | null {
    if (!headersInput || typeof headersInput !== 'object') return null;
    const headers = headersInput as Record<string, unknown>;

    const authResults = getHeader(headers, 'authentication-results');
    const receivedSpf = getHeader(headers, 'received-spf');
    if (authResults.length === 0 && receivedSpf.length === 0) return null;

    const primary = authResults[0] || '';
    let spf = verdictFrom(primary, 'spf');
    const dkim = verdictFrom(primary, 'dkim');
    const dmarc = verdictFrom(primary, 'dmarc');
    const arc = verdictFrom(primary, 'arc');

    if (spf === 'unknown' && receivedSpf[0]) {
        const m = receivedSpf[0].trim().match(/^([a-z]+)/i);
        const v = (m?.[1] || '').toLowerCase() as AuthVerdict;
        if (KNOWN.includes(v)) spf = v;
    }

    // Si hay varias Authentication-Results con veredictos DMARC/DKIM contradictorios, no confiar.
    let trusted = true;
    if (authResults.length > 1) {
        const others = authResults.slice(1);
        trusted = others.every((h) => verdictFrom(h, 'dmarc') === dmarc || verdictFrom(h, 'dmarc') === 'unknown');
    }

    let summary: EmailAuthentication['summary'] = 'unknown';
    if (dmarc === 'pass' || (dkim === 'pass' && spf === 'pass')) summary = 'verified';
    else if (dmarc === 'fail' || dkim === 'fail' || spf === 'fail') summary = 'failed';
    else if (dkim === 'pass' || spf === 'pass') summary = 'partial';

    return { spf, dkim, dmarc, arc, trusted, summary };
}

export type TransportDetails = {
    /** Dominio del remitente de sobre (Return-Path). */
    mailedBy: string | null;
    /** Dominio que firmo con DKIM (d=). */
    signedBy: string | null;
    /** Cifrado del ultimo salto: true/false si se pudo determinar, null si no hay datos. */
    encrypted: boolean | null;
    tlsVersion: string | null;
    cipher: string | null;
    /** Servidor que recibio el mensaje (primer `by` de Received) y servidor de origen (ultimo `from`). */
    receivedBy: string | null;
    originServer: string | null;
    /** Programa/servicio de envio (X-Mailer, User-Agent) o proveedor deducido. */
    provider: string | null;
    messageId: string | null;
    replyTo: string | null;
};

function domainOf(value: string | null | undefined): string | null {
    if (!value) return null;
    const m = value.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
    return m ? m[1].toLowerCase() : null;
}

const PROVIDER_HINTS: Array<[RegExp, string]> = [
    [/google\.com|gmail/i, 'Google'],
    [/outlook\.com|protection\.outlook|hotmail|microsoft/i, 'Microsoft'],
    [/titan\.email|flockmail/i, 'Titan'],
    [/amazonses|amazonaws/i, 'Amazon SES'],
    [/resend/i, 'Resend'],
    [/sendgrid/i, 'SendGrid'],
    [/mailgun/i, 'Mailgun'],
    [/zoho/i, 'Zoho'],
    [/yahoo/i, 'Yahoo'],
    [/icloud|apple\.com/i, 'Apple'],
];

/** Datos tecnicos del transporte a partir de las cabeceras crudas (Received, Return-Path, DKIM-Signature...). */
export function parseTransportDetails(headersInput: unknown): TransportDetails | null {
    if (!headersInput || typeof headersInput !== 'object') return null;
    const headers = headersInput as Record<string, unknown>;
    const received = getHeader(headers, 'received');
    const first = (name: string) => getHeader(headers, name)[0]?.trim() || null;

    const returnPath = first('return-path');
    const dkimSig = first('dkim-signature');
    const authRes = getHeader(headers, 'authentication-results')[0] || '';
    const signedBy = dkimSig?.match(/(?:^|[;\s])d\s*=\s*([^;\s]+)/i)?.[1]?.toLowerCase()
        || authRes.match(/header\.d=([^\s;]+)/i)?.[1]?.toLowerCase() || null;

    const hop = received[0] || '';
    const tlsVersion = hop.match(/version\s*=\s*(TLSv?[\d._]+)/i)?.[1] || hop.match(/using\s+(TLSv?[\d._]+)/i)?.[1] || null;
    const cipher = hop.match(/cipher\s*=\s*([A-Za-z0-9_-]+)/i)?.[1] || hop.match(/with cipher\s+([A-Za-z0-9_-]+)/i)?.[1] || null;
    let encrypted: boolean | null = null;
    if (tlsVersion || cipher || /\bwith\s+(E?SMTPS|ESMTPSA)\b/i.test(hop)) encrypted = true;
    else if (received.length > 0) encrypted = /\bwith\s+E?SMTP\b/i.test(hop) ? false : null;

    const receivedBy = hop.match(/\bby\s+([^\s;()]+)/i)?.[1]?.toLowerCase() || null;
    const originServer = (received[received.length - 1] || '').match(/\bfrom\s+([^\s;()]+)/i)?.[1]?.toLowerCase() || null;

    const mailer = first('x-mailer') || first('user-agent');
    const hay = [originServer, signedBy, domainOf(returnPath)].filter(Boolean).join(' ');
    const provider = mailer || PROVIDER_HINTS.find(([re]) => re.test(hay))?.[1] || null;

    const out: TransportDetails = {
        mailedBy: domainOf(returnPath),
        signedBy,
        encrypted,
        tlsVersion: tlsVersion ? tlsVersion.replace(/_/g, '.').replace(/^TLS(?=\d)/i, 'TLS') : null,
        cipher,
        receivedBy,
        originServer,
        provider,
        messageId: first('message-id'),
        replyTo: first('reply-to'),
    };
    return Object.values(out).every((v) => v === null) ? null : out;
}
