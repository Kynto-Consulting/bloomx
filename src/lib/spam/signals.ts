/**
 * Senales del motor v2, por familia. Cada funcion es pura y devuelve senales con su PESO BASE (el motor aplica el multiplicador
 * de familia y el tope). Ids estables: reasons.ts los traduce (es/en).
 */
import { classifySpamFromHeaders } from '../spam-headers';
import { brandInDisplayName, isLegitBrandDomain, lookalikeBrand } from './brand-match';
import { BRANDS } from './brands';
import { first, parseAddressList, type HeaderBag } from './headers-parse';
import { attrValue, innerTextAfter, scanTags } from './html-scan';
import {
    ARCHIVE_EXT, ARCHIVE_PASSWORD_HINTS, DANGEROUS_EXT, DOC_EXT, FREEMAIL, HTML_EXT, LEXICON, MACRO_EXT, RISKY_TLDS, ROLE_WORDS, SUSPICIOUS_MAILERS, URL_SHORTENERS,
    type LexCategory,
} from './lexicon';
import type { Prepared } from './prepare';
import type { RecipientContext, Signal } from './types';
import {
    countZeroWidth, decodePunycodeHost, foldHomoglyphs, hasMixedScriptWord, hostShownInText, isIpHost, normalizeText, registrable, sameOrg, tldOf,
} from './text';

type Sig = Omit<Signal, 'family'>;
const sig = (family: Signal['family'], id: string, weight: number, extra: Partial<Signal> = {}): Signal => ({ id, family, weight, ...extra });

const hasOwn = (p: Prepared, domain: string) => p.ownDomains.some((d) => domain === d || domain.endsWith(`.${d}`));

// ---------------------------------------------------------------------------
// Origen (X-Spam-* del proveedor) — reutiliza classifySpamFromHeaders como una senal mas
// ---------------------------------------------------------------------------
export function originSignals(p: Prepared): Signal[] {
    const only: Record<string, unknown> = {};
    for (const k of ['x-spam-flag', 'x-spam-status', 'x-spam-score']) if (p.bag[k]) only[k] = p.bag[k][0];
    if (Object.keys(only).length === 0) return [];
    const c = classifySpamFromHeaders(only, 60);
    if (!c.isSpam) {
        return c.score >= 30 ? [sig('origin', 'origin.xspam_partial', 10, { params: { score: Math.round(c.score) } })] : [];
    }
    const strong = c.reasons.some((r) => r === 'x-spam-flag=yes' || r === 'x-spam-status=yes');
    return [sig('origin', 'origin.xspam', strong ? 45 : 30, { params: { score: Math.round(c.score) } })];
}

// ---------------------------------------------------------------------------
// Autenticacion
// ---------------------------------------------------------------------------
export function authSignals(p: Prepared): Signal[] {
    const { auth } = p;
    const out: Signal[] = [];
    if (!p.hasHeaders) return out;
    if (!auth.present) {
        out.push(sig('auth', 'auth.none', 6));
        return out;
    }
    const aligned = alignment(p);
    if (auth.dmarc === 'fail') out.push(sig('auth', 'auth.dmarc_fail', 30, { critical: true }));
    else if (auth.dmarc === 'pass' && !FREEMAIL.has(p.fromDomain)) out.push(sig('auth', 'auth.dmarc_pass', -6));
    if (auth.spf === 'fail') out.push(sig('auth', 'auth.spf_fail', 18));
    else if (auth.spf === 'softfail') out.push(sig('auth', 'auth.spf_softfail', 8));
    else if (auth.spf === 'permerror') out.push(sig('auth', 'auth.spf_error', 5));
    else if (auth.spf === 'neutral') out.push(sig('auth', 'auth.spf_neutral', 2));
    if (auth.dkim === 'fail') out.push(sig('auth', 'auth.dkim_fail', 18));
    const noneAll = ['none', 'unknown'].includes(auth.spf) && ['none', 'unknown'].includes(auth.dkim) && ['none', 'unknown'].includes(auth.dmarc);
    if (noneAll) out.push(sig('auth', 'auth.no_results', 8));
    if (auth.dmarc !== 'pass' && !aligned.dkim && !aligned.spf && (auth.dkim === 'pass' || auth.spf === 'pass')) {
        out.push(sig('auth', 'auth.not_aligned', 10));
    }
    if (auth.arc === 'fail') out.push(sig('auth', 'auth.arc_fail', 8));
    else if (auth.arc === 'pass' && (auth.spf === 'fail' || auth.dkim === 'fail' || auth.dmarc === 'fail')) out.push(sig('auth', 'auth.arc_pass', -8));
    return out;
}

export function alignment(p: Prepared): { dkim: boolean; spf: boolean; any: boolean } {
    const dkim = p.auth.dkim === 'pass' && p.auth.dkimDomains.some((d) => sameOrg(d, p.fromDomain));
    const spf = p.auth.spf === 'pass' && !!p.envDomain && sameOrg(p.envDomain, p.fromDomain);
    return { dkim, spf, any: dkim || spf || p.auth.dmarc === 'pass' };
}

// ---------------------------------------------------------------------------
// Cabeceras
// ---------------------------------------------------------------------------
function receivedAnomaly(bag: HeaderBag): 'ip' | 'odd' | null {
    let odd = false;
    for (const r of (bag['received'] ?? []).slice(0, 12)) {
        if (/^\s*from\s+\[?\d{1,3}(?:\.\d{1,3}){3}\]?\s/i.test(r)) return 'ip';
        if (/\(may be forged\)|from\s+(?:localhost|unknown)\b|helo=(?:localhost|unknown)/i.test(r)) odd = true;
    }
    return odd ? 'odd' : null;
}

export function headerSignals(p: Prepared): Signal[] {
    const out: Signal[] = [];
    const { bag } = p;
    if (!p.fromEmail) out.push(sig('headers', 'hdr.from_missing', 10));
    else if (RISKY_TLDS.has(tldOf(p.fromDomain))) out.push(sig('headers', 'hdr.from_risky_tld', 14, { params: { tld: tldOf(p.fromDomain) } }));
    if (p.hasHeaders) {
        if (!bag['message-id']) out.push(sig('headers', 'hdr.msgid_missing', 8));
        else if (p.msgIdDomain && p.fromDomain && !sameOrg(p.msgIdDomain, p.fromDomain)
            && !p.auth.dkimDomains.some((d) => sameOrg(d, p.msgIdDomain)) && !(p.envDomain && sameOrg(p.envDomain, p.msgIdDomain))) {
            out.push(sig('headers', 'hdr.msgid_mismatch', 3, { params: { domain: p.msgIdDomain } }));
        }
        const dateRaw = first(bag, 'date');
        if (!dateRaw) out.push(sig('headers', 'hdr.date_missing', 6));
        else {
            const t = Date.parse(dateRaw);
            if (Number.isNaN(t)) out.push(sig('headers', 'hdr.date_invalid', 4));
            else if (t > p.now.getTime() + 2 * 86_400_000) out.push(sig('headers', 'hdr.date_future', 8));
        }
        const listy = !!(bag['list-id'] || bag['list-unsubscribe']);
        const replyTo = parseAddressList(first(bag, 'reply-to') || p.input.replyTo || '')[0];
        if (replyTo && p.fromDomain && !listy) {
            const rd = replyTo.split('@')[1] ?? '';
            if (rd && !sameOrg(rd, p.fromDomain) && !(p.envDomain && sameOrg(rd, p.envDomain))) out.push(sig('headers', 'hdr.replyto_mismatch', 8, { params: { domain: rd } }));
        }
        if (p.envDomain && p.fromDomain && !sameOrg(p.envDomain, p.fromDomain) && !alignment(p).dkim && !listy) {
            out.push(sig('headers', 'hdr.envelope_mismatch', 3, { params: { domain: p.envDomain } }));
        }
        const rec = receivedAnomaly(bag);
        if (rec === 'ip') out.push(sig('headers', 'hdr.received_ip', 5));
        else if (rec === 'odd') out.push(sig('headers', 'hdr.received_odd', 4));
        const mailer = normalizeText(`${first(bag, 'x-mailer')} ${first(bag, 'user-agent')}`);
        const bad = mailer ? SUSPICIOUS_MAILERS.find((m) => mailer.includes(m)) : undefined;
        if (bad) out.push(sig('headers', 'hdr.mailer', 8, { params: { mailer: bad } }));
        const rcpts = new Set([...parseAddressList(first(bag, 'to')), ...parseAddressList(first(bag, 'cc')), ...(p.input.recipients ?? []).map((r) => r.toLowerCase())]);
        if (rcpts.size >= 50) out.push(sig('headers', 'hdr.recipients', 12, { params: { n: rcpts.size } }));
        else if (rcpts.size >= 20) out.push(sig('headers', 'hdr.recipients', 6, { params: { n: rcpts.size } }));
        const prec = normalizeText(first(bag, 'precedence'));
        if (/^(bulk|junk|list)/.test(prec) && !bag['list-unsubscribe']) out.push(sig('headers', 'hdr.bulk_no_unsub', 6));
        if (bag['list-unsubscribe']) out.push(sig('headers', 'hdr.list_unsub', -5));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Contenido
// ---------------------------------------------------------------------------
function decodeEncodedWords(raw: string): string[] {
    const out: string[] = [];
    for (const m of raw.matchAll(/=\?([\w-]+)\?([bq])\?([^?]*)\?=/gi)) {
        try {
            const enc = m[2].toLowerCase();
            const buf = enc === 'b' ? Buffer.from(m[3], 'base64') : Buffer.from(m[3].replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1');
            out.push(buf.toString('utf8'));
        } catch { /* ignorar */ }
    }
    return out;
}

const HIDE_STYLE = /display:none|visibility:hidden|font-size:0(?![.\d])|font-size:1px|opacity:0(?![.\d])|max-height:0|height:0(?![.\d])/;
const WHITE_STYLE = /(?:^|;)color:(?:#fff(?:fff)?|white|rgb\(255,255,255\))(?:;|$)/;

function count(re: RegExp, s: string): number { return (s.match(re) ?? []).length; }

export function contentSignals(p: Prepared): Signal[] {
    const out: Signal[] = [];
    const { norm, subject, body, html } = p;
    // Lexico por categoria
    const lex: Signal[] = [];
    for (const cat of Object.keys(LEXICON) as LexCategory[]) {
        const def = LEXICON[cat];
        const hits: Array<[string, number]> = [];
        let sum = 0;
        for (const [phrase, w] of def.phrases) {
            if (norm.includes(phrase)) { hits.push([phrase, w]); sum += w; }
        }
        if (sum > 0) {
            hits.sort((a, b) => b[1] - a[1]);
            lex.push(sig('content', `content.lex.${cat}`, Math.min(def.cap, sum), { params: { phrases: hits.slice(0, 3).map((h) => h[0]).join(', '), n: hits.length } }));
        }
    }
    out.push(...lex);
    const distinct = lex.reduce((a, s) => a + Number(s.params?.n ?? 0), 0);
    if (distinct >= 9) out.push(sig('content', 'content.density', 18, { params: { n: distinct } }));
    else if (distinct >= 6) out.push(sig('content', 'content.density', 12, { params: { n: distinct } }));
    else if (distinct >= 4) out.push(sig('content', 'content.density', 6, { params: { n: distinct } }));

    // Mayusculas / signos
    const subjLetters = subject.replace(/[^A-Za-zÀ-ɏ]/g, '');
    if (subjLetters.length >= 8 && subjLetters.replace(/[^A-ZÀ-Þ]/g, '').length / subjLetters.length > 0.7) out.push(sig('content', 'content.subject_caps', 5));
    if (count(/!/g, subject) >= 3) out.push(sig('content', 'content.subject_exclaim', 4));
    const letters = body.replace(/[^A-Za-zÀ-ɏ]/g, '');
    if (letters.length >= 80 && letters.replace(/[^A-ZÀ-Þ]/g, '').length / letters.length > 0.35) out.push(sig('content', 'content.body_caps', 6));
    if (count(/!{3,}|(?:!\s*){4,}/g, body) >= 1) out.push(sig('content', 'content.body_exclaim', 3));

    // Texto oculto
    if (html) {
        let hidden = 0;
        let candidates = 0;
        for (const tag of scanTags(html)) {
            if (tag.closing || candidates >= 200) continue;
            const rawStyle = attrValue(tag.attrs, 'style');
            if (rawStyle === null) continue;
            const style = rawStyle.toLowerCase().replace(/\s+/g, '');
            const hide = HIDE_STYLE.test(style);
            const white = WHITE_STYLE.test(style) && !style.includes('background');
            if (!hide && !white) continue;
            candidates++;
            const inner = innerTextAfter(html, tag, 4000);
            if (hide && inner.length > 300) hidden = Math.max(hidden, inner.length);
            else if (white && inner.length >= 80) hidden = Math.max(hidden, inner.length);
        }
        if (hidden > 0) out.push(sig('content', 'content.hidden_text', 12, { params: { chars: hidden } }));
        const imgs = count(/<img\b/gi, html);
        if (imgs >= 1 && body.replace(/\s+/g, '').length < 25) out.push(sig('content', 'content.image_only', 10));
        // HTML mal balanceado
        let unbalanced = 0;
        for (const tag of ['table', 'tr', 'td', 'div', 'span', 'a', 'font', 'p', 'b', 'i']) {
            unbalanced += Math.abs(count(new RegExp(`<${tag}\\b`, 'gi'), html) - count(new RegExp(`</${tag}\\s*>`, 'gi'), html));
        }
        if (html.length > 300 && unbalanced >= 12) out.push(sig('content', 'content.html_broken', 5, { params: { n: unbalanced } }));
        const visLen = body.replace(/\s+/g, ' ').length;
        if (html.length > 6000 && visLen < 300 && html.length / Math.max(1, visLen) > 40 && imgs === 0) out.push(sig('content', 'content.html_ratio', 4));
    }

    if (p.links.length >= 1 && body.replace(/\s+/g, ' ').replace(/https?:\/\/\S+/g, '').trim().length < 80 && !p.bag['list-unsubscribe']) out.push(sig('content', 'content.link_only', 6));

    // Base64 gigante
    const noData = (html + '\n' + p.input.text).replace(/data:[a-z0-9+/.;-]+,[A-Za-z0-9+/=%]+/gi, '');
    if (/[A-Za-z0-9+/]{1500,}={0,2}/.test(noData)) out.push(sig('content', 'content.base64', 8));

    // Ofuscacion
    const head = `${subject}\n${body.slice(0, 6000)}`;
    if (hasMixedScriptWord(head)) out.push(sig('content', 'content.homoglyph', 14));
    const zw = countZeroWidth(head);
    if (zw >= 3) out.push(sig('content', 'content.zero_width', 8, { params: { n: zw } }));
    const spaced = count(/(?<![a-z0-9])(?:[a-z][ .\-*_]){5,}[a-z](?![a-z0-9])/gi, head.replace(/\s+/g, ' '));
    if (spaced >= 1) out.push(sig('content', 'content.spaced', 8));

    // Asunto codificado sospechoso: encoded-word cuyo contenido es ASCII simple
    const rawSubject = String(p.bag['subject']?.[0] ?? '');
    if (rawSubject.includes('=?')) {
        const decoded = decodeEncodedWords(rawSubject);
        if (decoded.some((d) => d.length >= 12 && /^[\x20-\x7e]+$/.test(d))) out.push(sig('content', 'content.subject_encoded', 5));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Enlaces
// ---------------------------------------------------------------------------
const ESP_TRACKERS = new Set([
    'sendgrid.net', 'mailchimp.com', 'list-manage.com', 'mailchi.mp', 'mandrillapp.com', 'constantcontact.com', 'hubspot.com', 'hubspotemail.net', 'sparkpostmail.com',
    'mailgun.org', 'amazonses.com', 'rsgsv.net', 'createsend.com', 'cmail19.com', 'cmail20.com', 'campaign-archive.com', 'sailthru.com', 'klclick.com', 'klaviyomail.com', 'exacttarget.com',
    'marketo.net', 'mktdns.com', 'salesforce.com', 'pardot.com', 'sendinblue.com', 'brevo.com', 'mailjet.com', 'customeriomail.com', 'intercom-mail.com', 'substack.com', 'beehiiv.com',
    'convertkit.com', 'ck.page', 'ctctcdn.com', 'e.com', 'braze.com', 'iterable.com', 'ghost.io', 'medium.com', 'linkedin.com', 'google.com', 'youtube.com', 'facebook.com', 'twitter.com',
]);
const TRACKER_LABEL = /^(click|clicks|track|tracking|trk|links?|email|em|e|go|mail|m|r|l|t|u|url|redirect|news|newsletter|mkt|marketing|info|comms|email-link|ablink|sg|ct|s|d|ea|tr|t2)\d*$/;

export function linkSignals(p: Prepared): Signal[] {
    const out: Signal[] = [];
    const links = p.links;
    if (links.length === 0) return out;
    const seenHosts = new Set<string>();
    const add = (s: Signal) => { if (!out.some((o) => o.id === s.id)) out.push(s); };
    let shorteners = 0;
    for (const l of links) {
        const host = l.host;
        if (isIpHost(host)) add(sig('links', 'link.ip_host', 22, { critical: true, params: { host } }));
        if (host.split('.').some((x) => x.startsWith('xn--'))) {
            const uni = decodePunycodeHost(host);
            const folded = foldHomoglyphs(uni);
            const asBrand = lookalikeBrand(folded) ?? BRANDS.find((b) => b.labels.includes(registrable(folded).split('.')[0]) && !isLegitBrandDomain(b, host));
            if (hasMixedScriptWord(uni) || asBrand) add(sig('links', 'link.homograph', 20, { critical: true, params: { host: uni } }));
            else add(sig('links', 'link.punycode', 8, { params: { host: uni } }));
        }
        if (URL_SHORTENERS.has(host) || URL_SHORTENERS.has(registrable(host))) shorteners++;
        if (RISKY_TLDS.has(tldOf(host))) add(sig('links', 'link.risky_tld', 12, { params: { tld: tldOf(host) } }));
        if (l.port && !['80', '443'].includes(l.port)) add(sig('links', 'link.odd_port', 8, { params: { port: l.port } }));
        if (l.userinfo) add(sig('links', 'link.userinfo', 16, { critical: true, params: { host } }));
        if (l.href.length > 400 && /https?%3a%2f%2f|https?:\/\/[^?]*\?.*https?:\/\//i.test(l.href)) add(sig('links', 'link.long_redirect', 5));
        if (!seenHosts.has(host)) {
            seenHosts.add(host);
            const look = lookalikeBrand(host);
            if (look && !hasOwn(p, host)) add(sig('links', 'link.lookalike', 20, { critical: true, params: { host, brand: look.brand.id } }));
        }
        // Texto del enlace muestra un dominio y el href va a otro
        const shown = hostShownInText(l.text);
        if (shown && !sameOrg(shown, host)) {
            const tracker = TRACKER_LABEL.test(host.split('.')[0]) || ESP_TRACKERS.has(registrable(host)) || (p.fromDomain && sameOrg(shown, p.fromDomain));
            if (tracker) add(sig('links', 'link.text_mismatch_soft', 4, { params: { shown, host } }));
            else add(sig('links', 'link.text_mismatch', 18, { critical: true, params: { shown, host } }));
        }
    }
    if (shorteners > 0) add(sig('links', 'link.shortener', links.length === shorteners ? 8 : 4, { params: { n: shorteners } }));
    if (links.length > 60) add(sig('links', 'link.many', 10, { params: { n: links.length } }));
    else if (links.length > 25) add(sig('links', 'link.many', 5, { params: { n: links.length } }));
    return out;
}

// ---------------------------------------------------------------------------
// Adjuntos
// ---------------------------------------------------------------------------
export function attachmentSignals(p: Prepared): Signal[] {
    const out: Signal[] = [];
    const add = (s: Signal) => { if (!out.some((o) => o.id === s.id && o.params?.file === s.params?.file)) out.push(s); };
    let archive = false;
    for (const a of (p.input.attachments ?? []).slice(0, 100)) {
        const name = String(a.filename ?? '');
        const lower = name.toLowerCase().replace(/[\s.]+$/g, '');
        const exts = lower.split('.').slice(1);
        const ext = exts[exts.length - 1] ?? '';
        const prev = exts[exts.length - 2] ?? '';
        const file = name.slice(0, 60);
        if (a.dangerous) add(sig('attachments', 'att.blocked_type', 55, { critical: true, params: { file } }));
        else if (DANGEROUS_EXT.has(ext)) add(sig('attachments', 'att.dangerous_ext', 55, { critical: true, params: { file, ext } }));
        if (MACRO_EXT.has(ext)) add(sig('attachments', 'att.macro', 28, { params: { file } }));
        if (HTML_EXT.has(ext)) add(sig('attachments', 'att.html', 22, { params: { file } }));
        if ((DOC_EXT.has(prev) && (DANGEROUS_EXT.has(ext) || HTML_EXT.has(ext) || ext === 'zip')) || /[‮]/.test(name) || /\.(pdf|docx?|xlsx?|jpe?g|png)\s{2,}\.[a-z]{2,4}$/i.test(name)) {
            add(sig('attachments', 'att.double_ext', 22, { critical: true, params: { file } }));
        }
        if (a.mismatch) add(sig('attachments', 'att.type_mismatch', 8, { params: { file } }));
        if (ARCHIVE_EXT.has(ext)) { archive = true; add(sig('attachments', 'att.archive', 6, { params: { file } })); }
    }
    if (archive) {
        const hint = ARCHIVE_PASSWORD_HINTS.find((h) => p.norm.includes(h));
        if (hint) out.push(sig('attachments', 'att.archive_password', 28));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Suplantacion
// ---------------------------------------------------------------------------
export function impersonationSignals(p: Prepared): Signal[] {
    const out: Signal[] = [];
    if (!p.fromEmail) return out;
    const own = hasOwn(p, p.fromDomain);
    const al = alignment(p);
    const authFail = p.auth.dmarc === 'fail' || p.auth.spf === 'fail' || p.auth.dkim === 'fail';
    // Nombre visible que dice ser una marca
    const brand = brandInDisplayName(p.fromName);
    if (brand && !isLegitBrandDomain(brand, p.fromDomain) && !own) {
        out.push(sig('impersonation', 'imp.name_brand', 28, { critical: true, params: { brand: brand.id, domain: p.fromDomain } }));
        if (!al.any) out.push(sig('impersonation', 'imp.brand_noauth', 10, { critical: true }));
    }
    // Dominio del From que imita a una marca
    const look = lookalikeBrand(p.fromDomain);
    if (look && !own) out.push(sig('impersonation', 'imp.lookalike_from', 30, { critical: true, params: { brand: look.brand.id, domain: p.fromDomain } }));
    // Dominio legitimo de una marca con autenticacion fallida = falsificacion directa
    const legit = BRANDS.find((b) => isLegitBrandDomain(b, p.fromDomain));
    if (legit && authFail) out.push(sig('impersonation', 'imp.brand_domain_fail', 20, { critical: true, params: { brand: legit.id } }));
    // Dominio propio falsificado desde fuera
    if (own && authFail && p.auth.present) out.push(sig('impersonation', 'imp.own_domain_spoof', 30, { critical: true }));
    // Nombre de rol/organizacion en una cuenta gratuita ("IT Helpdesk" desde gmail)
    if (p.fromName && FREEMAIL.has(p.fromDomain) && ROLE_WORDS.test(normalizeText(p.fromName))) out.push(sig('impersonation', 'imp.freemail_role', 14, { params: { domain: p.fromDomain } }));
    // Nombre visible con otra direccion o dominio
    if (p.fromName) {
        const addr = p.fromName.match(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/i);
        if (addr && !sameOrg(addr[1], p.fromDomain)) out.push(sig('impersonation', 'imp.name_address', hasOwn(p, addr[1].toLowerCase()) ? 32 : 22, { critical: true, params: { shown: addr[0].toLowerCase() } }));
        else if (!addr) {
            const dom = p.fromName.match(/\b(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i);
            if (dom && !sameOrg(dom[1], p.fromDomain)) out.push(sig('impersonation', 'imp.name_domain', hasOwn(p, dom[1].toLowerCase()) ? 25 : 15, { params: { shown: dom[1].toLowerCase() } }));
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Contexto del destinatario
// ---------------------------------------------------------------------------
export function contextSignals(ctx: RecipientContext | undefined): Signal[] {
    if (!ctx) return [];
    const out: Signal[] = [];
    if (ctx.senderInContacts) out.push(sig('context', 'ctx.contact', -25));
    if (ctx.userRepliedBefore) out.push(sig('context', 'ctx.replied', -20));
    if (ctx.inReplyToOwn) out.push(sig('context', 'ctx.thread', -25));
    const ham = ctx.hamFromSender ?? 0, spam = ctx.spamFromSender ?? 0;
    const hamD = ctx.hamFromDomain ?? 0, spamD = ctx.spamFromDomain ?? 0;
    if (ham > 0) out.push(sig('context', 'ctx.ham_history', -Math.min(20, ham * 4), { params: { n: ham } }));
    else if (hamD > 0) out.push(sig('context', 'ctx.ham_history', -Math.min(10, hamD * 2), { params: { n: hamD } }));
    if (spam > 0) out.push(sig('context', 'ctx.spam_history', Math.min(25, spam * 7), { params: { n: spam } }));
    else if (spamD > 0) out.push(sig('context', 'ctx.spam_history', Math.min(12, spamD * 3), { params: { n: spamD } }));
    if (ctx.bayes && ctx.bayes.points !== 0) {
        out.push(sig('learning', 'learn.bayes', Math.max(-20, Math.min(20, ctx.bayes.points)), { params: { tokens: ctx.bayes.tokens, samples: ctx.bayes.samples } }));
    }
    return out;
}

export type { Sig };
