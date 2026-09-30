/**
 * Corpus SINTETICO etiquetado para medir el motor (es/en/pt). Todo el texto, dominios y direcciones son inventados aqui:
 * no hay correos ni personas reales. Generacion determinista (PRNG con semilla) a partir de plantillas y fragmentos,
 * de modo que cada mensaje es distinto pero el resultado es reproducible.
 */
import type { AttachmentInfo, RecipientContext, SpamInput } from '../types';

export type Label = 'ham' | 'spam';
export type Lang = 'es' | 'en' | 'pt';
export interface Sample {
    label: Label;
    kind: string;
    lang: Lang;
    /** Caso deliberadamente dificil (autenticacion valida en spam, sin autenticacion o palabras "de spam" en ham). */
    hard: boolean;
    input: SpamInput;
    ctx?: RecipientContext;
}

export function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const NOW = new Date('2026-05-04T10:00:00Z');
export const CORPUS_NOW = NOW;

export class Gen {
    r = mulberry32(20260504);
    n = 0;
    pick<T>(a: readonly T[]): T { return a[Math.floor(this.r() * a.length)]; }
    pickN<T>(a: readonly T[], n: number): T[] {
        const c = [...a];
        const out: T[] = [];
        while (out.length < n && c.length) out.push(c.splice(Math.floor(this.r() * c.length), 1)[0]);
        return out;
    }
    chance(p: number) { return this.r() < p; }
    int(a: number, b: number) { return a + Math.floor(this.r() * (b - a + 1)); }
    id() { return `${(++this.n).toString(36)}${Math.floor(this.r() * 1e9).toString(36)}`; }
}

export interface HdrOpts {
    from: string;
    env?: string;
    dkim?: string | null;
    spf?: string;
    dkimV?: string;
    dmarc?: string;
    msgDomain?: string | null;
    listUnsub?: boolean;
    listId?: boolean;
    replyTo?: string;
    date?: string | null;
    noAuth?: boolean;
    mailer?: string;
    received?: string[];
    bulk?: boolean;
    to?: string;
    xspam?: string;
    subjectRaw?: string;
}

export function hdr(g: Gen, o: HdrOpts): Record<string, unknown> {
    const env = o.env ?? o.from;
    const dk = o.dkim === undefined ? o.from : o.dkim;
    const h: Record<string, unknown> = {
        to: o.to ?? 'usuario@bloomx.test',
        received: o.received ?? [`from mail.${env} (mail.${env} [203.0.113.${g.int(2, 250)}]) by mx.bloomx.test with ESMTPS`],
    };
    if (!o.noAuth) {
        const parts = [`mx.bloomx.test`, `spf=${o.spf ?? 'pass'} smtp.mailfrom=${env}`];
        parts.push(dk ? `dkim=${o.dkimV ?? 'pass'} header.d=${dk}` : 'dkim=none');
        parts.push(`dmarc=${o.dmarc ?? ((o.spf ?? 'pass') === 'pass' || (o.dkimV ?? 'pass') === 'pass' ? 'pass' : 'fail')} header.from=${o.from}`);
        h['authentication-results'] = parts.join('; ');
    }
    if (o.msgDomain !== null) h['message-id'] = `<${g.id()}@${o.msgDomain ?? o.from}>`;
    if (o.date !== null) h['date'] = o.date ?? new Date(NOW.getTime() - g.int(1, 3000) * 60_000).toUTCString();
    h['return-path'] = `<bounce-${g.id()}@${env}>`;
    if (o.listUnsub) h['list-unsubscribe'] = `<https://${env}/u/${g.id()}>, <mailto:unsub@${env}>`;
    if (o.listId) h['list-id'] = `<list.${o.from}>`;
    if (o.replyTo) h['reply-to'] = o.replyTo;
    if (o.mailer) h['x-mailer'] = o.mailer;
    if (o.bulk) h['precedence'] = 'bulk';
    if (o.xspam) h['x-spam-flag'] = o.xspam;
    if (o.subjectRaw) h['subject'] = o.subjectRaw;
    return h;
}

export const html = (paras: string[], links: Array<[string, string]> = [], extra = '') =>
    `<html><body style="font-family:Arial"><table><tr><td><div>${paras.map((p) => `<p>${p}</p>`).join('')}${links.map(([u, t]) => `<p><a href="${u}">${t}</a></p>`).join('')}${extra}</div></td></tr></table></body></html>`;

export const NAMES = ['Ana', 'Luis', 'Marta', 'Jorge', 'Carla', 'Pedro', 'Lucía', 'Andrés', 'Sofía', 'Diego', 'Elena', 'Tomás', 'Paula', 'Rafael', 'Inés', 'Bruno', 'Camila', 'Gonzalo', 'Valeria', 'Hugo'];
export const SURN = ['Ruiz', 'Vega', 'Soto', 'Mora', 'Paz', 'Lima', 'Rojas', 'Silva', 'Costa', 'Ortiz', 'Pardo', 'Navarro', 'Campos', 'Ferreira', 'Molina'];
export const person = (g: Gen) => `${g.pick(NAMES)} ${g.pick(SURN)}`;
export const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '');

