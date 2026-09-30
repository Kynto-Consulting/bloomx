/** Preparacion unica de los datos derivados que comparten todas las familias de senales (puro). */
import type { AuthSummary, HeaderBag } from './headers-parse';
import { authOf, bagOf, envelopeDomain, first, messageIdDomain } from './headers-parse';
import type { SpamInput } from './types';
import { domainOf, extractLinks, normalizeText, visibleText, type LinkInfo } from './text';

export interface Prepared {
    input: SpamInput;
    now: Date;
    bag: HeaderBag;
    hasHeaders: boolean;
    auth: AuthSummary;
    fromEmail: string;
    fromName: string;
    fromDomain: string;
    envDomain: string;
    msgIdDomain: string;
    subject: string;
    /** Texto legible: cuerpo de texto o texto visible del HTML. */
    body: string;
    html: string;
    links: LinkInfo[];
    /** Asunto + cuerpo normalizados (para el lexico). */
    norm: string;
    ownDomains: string[];
}

const MAX_BODY = 40_000;

/** Une letras sueltas separadas ("v i a g r a", "v.i.a.g.r.a") para que el lexico las vea. */
export function despace(s: string): string {
    return s.replace(/(?<![\p{L}\p{N}])(?:\p{L}[ .\-*_]){3,}\p{L}(?![\p{L}\p{N}])/gu, (m) => m.replace(/[ .\-*_]/g, ''));
}

export function prepare(input: SpamInput, ownDomains: string[]): Prepared {
    const bag = bagOf(input.headers);
    const auth = authOf(bag);
    const html = String(input.html ?? '').slice(0, 300_000);
    const text = String(input.text ?? '').slice(0, 100_000);
    const vis = html ? visibleText(html) : '';
    const body = (text && vis ? (text.length >= vis.length ? text : vis) : text || vis).slice(0, MAX_BODY);
    const fromEmail = String(input.from?.email ?? '').toLowerCase();
    const subject = String(input.subject ?? '').slice(0, 1000);
    return {
        input,
        now: input.now ?? new Date(),
        bag,
        hasHeaders: Object.keys(bag).length > 0,
        auth,
        fromEmail,
        fromName: String(input.from?.name ?? '').trim(),
        fromDomain: domainOf(fromEmail),
        envDomain: envelopeDomain(bag, input.envelopeFrom, auth),
        msgIdDomain: messageIdDomain(bag),
        subject,
        body,
        html,
        links: extractLinks(html, text || body),
        norm: despace(normalizeText(`${subject}\n${body}`)).slice(0, MAX_BODY),
        ownDomains: ownDomains.map((d) => d.toLowerCase()),
    };
}

export { first };
