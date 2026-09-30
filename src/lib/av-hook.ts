import { auditLog } from './audit';

// Hook de antivirus OPCIONAL para adjuntos (CIS v8 10.1 / 9.6, NIST 800-53 SI-3, ISO 27001:2022 A.8.7).
// Si AV_SCAN_URL no esta definida, no hace nada y el flujo continua (status "skipped").
//
// Contrato (compatible con los servicios REST de ClamAV mas comunes): POST multipart/form-data con el archivo en el
// campo AV_SCAN_FIELD (por defecto "file"). Se interpreta como infectado si la respuesta:
//   - es JSON con  Status/status == "FOUND"  |  infected/is_infected == true  |  data.result[].is_infected == true
//   - o es texto que contiene "FOUND" (formato clamd: "stream: Eicar-Test-Signature FOUND")
// Variables:
//   AV_SCAN_URL          endpoint de escaneo (vacio = desactivado)
//   AV_SCAN_TOKEN        (opcional) Authorization: Bearer
//   AV_SCAN_FIELD        nombre del campo multipart (por defecto "file")
//   AV_SCAN_TIMEOUT_MS   por defecto 8000
//   AV_SCAN_MAX_BYTES    por defecto 25 MB; mas grande => "skipped"
//   AV_FAIL_MODE         "open" (por defecto: si el AV falla, se acepta y se audita) | "closed" (si falla, se trata como no seguro)

export type AvStatus = 'clean' | 'infected' | 'skipped' | 'error';

export interface AvResult {
    status: AvStatus;
    signature?: string;
    detail?: string;
}

export function isAvConfigured(): boolean {
    return !!process.env.AV_SCAN_URL;
}

/** Interpreta la respuesta del servicio (pura, testeable). */
export function parseAvResponse(bodyText: string, contentType = ''): { infected: boolean; signature?: string } {
    const text = String(bodyText || '');
    if (contentType.includes('json') || /^\s*[{[]/.test(text)) {
        try {
            const j = JSON.parse(text);
            const status = String(j?.Status ?? j?.status ?? '').toUpperCase();
            if (status === 'FOUND') return { infected: true, signature: String(j?.Description ?? j?.description ?? j?.signature ?? '') || undefined };
            if (j?.infected === true || j?.is_infected === true) return { infected: true, signature: Array.isArray(j?.viruses) ? j.viruses[0] : undefined };
            const results = j?.data?.result ?? j?.result;
            if (Array.isArray(results)) {
                const hit = results.find((r: any) => r?.is_infected === true || r?.infected === true);
                if (hit) return { infected: true, signature: Array.isArray(hit.viruses) ? hit.viruses[0] : undefined };
            }
            return { infected: false };
        } catch {
            /* caer a texto */
        }
    }
    const m = /:\s*(.+?)\s+FOUND\b/i.exec(text);
    if (m) return { infected: true, signature: m[1] };
    return { infected: /\bFOUND\b/.test(text) };
}

export async function scanBuffer(buffer: Buffer, filename: string, ctx: { userId?: string } = {}): Promise<AvResult> {
    const url = process.env.AV_SCAN_URL;
    if (!url) return { status: 'skipped', detail: 'not_configured' };

    const maxBytes = Number(process.env.AV_SCAN_MAX_BYTES) || 25 * 1024 * 1024;
    if (buffer.byteLength > maxBytes) return { status: 'skipped', detail: 'too_large' };

    const timeoutMs = Number(process.env.AV_SCAN_TIMEOUT_MS) || 8000;
    const field = process.env.AV_SCAN_FIELD || 'file';
    const failClosed = process.env.AV_FAIL_MODE === 'closed';

    try {
        const form = new FormData();
        form.append(field, new Blob([new Uint8Array(buffer)]), String(filename || 'file').slice(0, 200));
        const headers: Record<string, string> = {};
        if (process.env.AV_SCAN_TOKEN) headers.Authorization = `Bearer ${process.env.AV_SCAN_TOKEN}`;

        const res = await fetch(url, { method: 'POST', body: form, headers, signal: AbortSignal.timeout(timeoutMs) });
        const bodyText = await res.text();
        if (!res.ok && res.status !== 406 && res.status !== 418) {
            // Algunos servicios responden 406/418 cuando hay infeccion
            throw new Error(`AV HTTP ${res.status}`);
        }
        const parsed = parseAvResponse(bodyText, res.headers.get('content-type') || '');
        if (parsed.infected || res.status === 406 || res.status === 418) {
            auditLog('av.infected', { userId: ctx.userId, signature: parsed.signature?.slice(0, 120), filename: String(filename).slice(0, 120) });
            return { status: 'infected', signature: parsed.signature };
        }
        return { status: 'clean' };
    } catch (err: any) {
        auditLog('av.error', { userId: ctx.userId, error: String(err?.name || err?.message || 'unknown').slice(0, 80), failMode: failClosed ? 'closed' : 'open' });
        return { status: 'error', detail: failClosed ? 'fail_closed' : 'fail_open' };
    }
}

/** True si, dado el resultado, el adjunto NO debe aceptarse. */
export function avShouldBlock(r: AvResult): boolean {
    if (r.status === 'infected') return true;
    if (r.status === 'error' && process.env.AV_FAIL_MODE === 'closed') return true;
    return false;
}
