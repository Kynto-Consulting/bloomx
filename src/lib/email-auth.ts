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
