/**
 * Orquestacion del filtro en la ENTRADA de correo (webhook): bloqueo previo ("ni entra"), motor v2 con contexto del destinatario,
 * listas permitidas (sin eludir suplantacion ni malware), externos y veredicto persistible. Todo con degradacion segura: si algo
 * falla se cae al comportamiento anterior (classifySpamFromHeaders con SPAM_SCORE_THRESHOLD) y el correo nunca se pierde.
 */
import { ownDomains } from '@/lib/backend-auth';
import { adminEmails } from '@/lib/mfa';
import { classifySpamFromHeaders } from '@/lib/spam-headers';
import { execute, isMissingRelation, query } from '@/lib/admin/sql';
import { prisma } from '@/lib/prisma';
import { classifyForUser, getUserPrefs, senderCounts } from './learning-store';
import { authOf, bagOf, envelopeDomain } from './headers-parse';
import { getSpamConfig } from './config-store';
import { bandOf, decisionFor, type SpamConfig } from './config-core';
import { DEFAULT_ENGINE_CONFIG, aggregateSignals, evaluateSpam } from './engine';
import { classifyExternal, type ExternalVerdict } from './external';
import { describeEntries, getCompiledList, recordHits, DOMAIN_OWNER } from './lists-store';
import { identityOf, type Identity } from './lists-core';
import { recordEvent, purgeEvents, type CompactReason } from './events-store';
import { packVerdict, type PackedVerdict } from './verdict';
import { domainOf, extractLinks, normalizeText, parseAddress, visibleText } from './text';
import type { AttachmentInfo, Band, Decision, EngineConfig, RecipientContext, Signal, SpamInput } from './types';

export interface InboundUser { id: string; email: string }

export interface InboundMail {
    headers: Record<string, unknown>;
    from: { name: string; email: string };
    envelopeFrom?: string | null;
    replyTo?: string | null;
    subject: string;
    text: string;
    html: string;
    attachments: AttachmentInfo[];
    recipients: string[];
}

const toInput = (m: InboundMail): SpamInput => ({
    headers: m.headers, from: m.from, envelopeFrom: m.envelopeFrom, replyTo: m.replyTo, subject: m.subject, text: m.text, html: m.html,
    attachments: m.attachments, recipients: m.recipients,
});

export function internalDomainsFor(cfg: SpamConfig, extra: string[] = []): string[] {
    return Array.from(new Set([...ownDomains(), ...cfg.external.internalDomains, ...extra].map((d) => d.toLowerCase()).filter(Boolean)));
}

export function engineConfigFor(cfg: SpamConfig, internal: string[]): EngineConfig {
    return {
        ...DEFAULT_ENGINE_CONFIG,
        familyWeights: cfg.familyWeights,
        ownDomains: internal,
        contentEnabled: cfg.engine.content,
        linksEnabled: cfg.engine.links,
        learningEnabled: cfg.engine.learning,
        contextEnabled: cfg.engine.context,
    };
}

// ---------------------------------------------------------------------------
// 1) Blocklist previa a guardar nada
// ---------------------------------------------------------------------------
export interface BlockOutcome {
    survivors: InboundUser[];
    blocked: Array<{ user: InboundUser; ruleId: string; ruleLabel: string; scope: string }>;
}

/** Identidades a comprobar: remitente del sobre, From y dominio de la firma DKIM (solo dominio). */
export function senderIdentities(m: Pick<InboundMail, 'headers' | 'from' | 'envelopeFrom'>): Identity[] {
    const bag = bagOf(m.headers);
    const auth = authOf(bag);
    const out: Identity[] = [];
    const push = (i: Identity) => { if ((i.email || i.domain) && !out.some((o) => o.email === i.email && o.domain === i.domain)) out.push(i); };
    const envRaw = m.envelopeFrom || bag['return-path']?.[0] || bag['x-envelope-from']?.[0] || '';
    const env = parseAddress(String(envRaw).replace(/^<|>$/g, '')).email;
    if (env) push(identityOf(env));
    if (m.from.email) push(identityOf(m.from.email));
    for (const d of auth.dkimDomains.slice(0, 4)) push({ email: '', domain: d });
    const envDom = envelopeDomain(bag, m.envelopeFrom, auth);
    if (envDom && !env) push({ email: '', domain: envDom });
    return out;
}

/**
 * Evalua la blocklist del dominio y la personal de cada destinatario ANTES de guardar nada. Si acierta: se cuenta el acierto, se
 * registra un evento SIN contenido y el llamador debe omitir a ese usuario (sin cuerpo, sin adjuntos, sin rebote).
 */
export async function applyBlocklist(mail: Pick<InboundMail, 'headers' | 'from' | 'envelopeFrom'>, users: InboundUser[], now = new Date()): Promise<BlockOutcome> {
    const outcome: BlockOutcome = { survivors: users, blocked: [] };
    try {
        const ids = senderIdentities(mail);
        if (ids.length === 0) return outcome;
        const cfg = await getSpamConfig();
        const internal = internalDomainsFor(cfg);
        // El correo interno (mismo dominio propio) nunca se bloquea por lista.
        const fromDom = domainOf(mail.from.email);
        if (fromDom && internal.some((d) => fromDom === d || fromDom.endsWith(`.${d}`))) return outcome;
        const domainList = await getCompiledList('domain', DOMAIN_OWNER, 'block', now.getTime());
        const hits: Array<{ user: InboundUser; ruleId: string; scope: string }> = [];
        for (const u of users) {
            let id: string | null = null;
            let scope = 'domain';
            for (const who of ids) { id = domainList.match(who, now); if (id) break; }
            if (!id) {
                const personal = await getCompiledList('user', u.id, 'block', now.getTime());
                scope = 'user';
                for (const who of ids) { id = personal.match(who, now); if (id) break; }
            }
            if (id) hits.push({ user: u, ruleId: id, scope });
        }
        if (hits.length === 0) return outcome;
        const desc = await describeEntries([...new Set(hits.map((h) => h.ruleId))]);
        const sender = (mail.from.email || ids[0].email || ids[0].domain).toLowerCase();
        for (const h of hits) {
            const d = desc.get(h.ruleId);
            const label = d ? `block.${d.matchType}:${d.value}`.slice(0, 300) : 'block';
            outcome.blocked.push({ user: h.user, ruleId: h.ruleId, ruleLabel: label, scope: h.scope });
            await recordEvent({ userId: h.user.id, recipient: h.user.email, sender, decision: 'blocked', ruleId: h.ruleId, ruleLabel: label });
        }
        void recordHits(hits.map((h) => h.ruleId));
        const gone = new Set(hits.map((h) => h.user.id));
        outcome.survivors = users.filter((u) => !gone.has(u.id));
        maybePurge(cfg);
    } catch (error) {
        // Fallo del filtro: el correo entra (nunca se pierde por un error interno).
        console.error('[spam] blocklist evaluation failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
    }
    return outcome;
}

let purgeCounter = 0;
function maybePurge(cfg: SpamConfig) {
    if (++purgeCounter % 50 === 0) void purgeEvents(cfg.logRetentionDays);
}

// ---------------------------------------------------------------------------
// 2) Contexto del destinatario
// ---------------------------------------------------------------------------
let namesCache: { at: number; names: Set<string> } | null = null;
async function internalNames(): Promise<Set<string>> {
    if (namesCache && Date.now() - namesCache.at < 60_000) return namesCache.names;
    const names = new Set<string>();
    try {
        const rows = await query<{ name: string }>(`SELECT "name" FROM "User" WHERE "name" IS NOT NULL LIMIT 5000`);
        for (const r of rows) names.add(normalizeText(r.name));
    } catch { /* sin datos */ }
    namesCache = { at: Date.now(), names };
    return names;
}
export function resetInternalNamesCache() { namesCache = null; }

export async function recipientContext(user: InboundUser, mail: InboundMail, cfg: SpamConfig, learn: boolean): Promise<{ ctx: RecipientContext; firstTime: boolean }> {
    const sender = mail.from.email.toLowerCase();
    const ctx: RecipientContext = {};
    if (!sender) return { ctx, firstTime: false };
    if (cfg.engine.context) {
        try {
            const contact = await prisma.contact.findFirst({ where: { userId: user.id, email: sender }, select: { id: true } });
            ctx.senderInContacts = !!contact;
        } catch { /* sin contactos */ }
        try {
            const sent = await query<{ x: number }>(`SELECT 1 AS x FROM "Email" WHERE "userId" = $1 AND "folder" = 'sent' AND lower("to") LIKE $2 LIMIT 1`, user.id, `%${sender.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
            ctx.userRepliedBefore = sent.length > 0;
        } catch { /* */ }
        try {
            const seen = await query<{ x: number }>(
                `SELECT 1 AS x FROM (SELECT "from" FROM "Email" WHERE "userId" = $1 AND "folder" <> 'sent' ORDER BY "createdAt" DESC LIMIT 5000) t WHERE lower(t."from") LIKE $2 LIMIT 1`,
                user.id, `%${sender.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
            );
            ctx.firstTime = seen.length === 0 && !ctx.senderInContacts;
        } catch { /* */ }
        // In-Reply-To / References apuntan a un mensaje propio (si la columna de hilos existe)
        try {
            const bag = bagOf(mail.headers);
            const refs = [...(bag['in-reply-to'] ?? []), ...(bag['references'] ?? [])].join(' ').match(/<[^<>\s]+>/g)?.map((x) => x.slice(1, -1).toLowerCase()).slice(0, 30) ?? [];
            if (refs.length) {
                const own = await query<{ x: number }>(`SELECT 1 AS x FROM "Email" WHERE "userId" = $1 AND "folder" = 'sent' AND lower("rfcMessageId") = ANY($2::text[]) LIMIT 1`, user.id, refs);
                ctx.inReplyToOwn = own.length > 0;
            }
        } catch (error) { if (!isMissingRelation(error)) { /* la columna aun no existe */ } }
        Object.assign(ctx, await senderCounts(user.id, sender));
    }
    if (cfg.engine.learning && learn) {
        const links = extractLinks(mail.html, mail.text).map((l) => l.host);
        const body = mail.text || visibleText(mail.html);
        const b = await classifyForUser(user.id, { subject: mail.subject, body, fromDomain: domainOf(sender), linkHosts: links });
        if (b) ctx.bayes = { points: b.points, tokens: b.tokens, samples: b.samples };
    }
    return { ctx, firstTime: ctx.firstTime === true };
}

// ---------------------------------------------------------------------------
// 3) Clasificacion por usuario
// ---------------------------------------------------------------------------
export interface UserVerdict {
    score: number | null;
    band: Band;
    decision: Exclude<Decision, 'blocked'>;
    folder: 'inbox' | 'spam';
    signals: Signal[];
    raw: Signal[];
    category: 'personal' | 'promotional' | 'unknown';
    external: ExternalVerdict;
    allowId: string | null;
    packed: PackedVerdict | null;
    engine: 'v2' | 'legacy' | 'off';
}

const NO_EXTERNAL: ExternalVerdict = { external: false, trusted: false, warn: false, colleagueSpoof: false, firstTime: false };

function legacy(mail: InboundMail): UserVerdict {
    const thrRaw = Number.parseFloat(String(process.env.SPAM_SCORE_THRESHOLD || '60'));
    const thr = Number.isFinite(thrRaw) ? Math.min(100, Math.max(0, thrRaw)) : 60;
    const auto = String(process.env.ENABLE_AUTO_SPAM_DETECTION || 'true').toLowerCase() !== 'false';
    const c = classifySpamFromHeaders(mail.headers, thr);
    const spam = auto && c.isSpam;
    return { score: Math.round(c.score), band: spam ? 'spam' : 'clean', decision: spam ? 'spam' : 'delivered', folder: spam ? 'spam' : 'inbox', signals: [], raw: [], category: 'unknown', external: NO_EXTERNAL, allowId: null, packed: null, engine: 'legacy' };
}

export async function classifyForRecipient(user: InboundUser, mail: InboundMail, opts: { now?: Date } = {}): Promise<UserVerdict> {
    try {
        const cfg = await getSpamConfig();
        const prefs = await getUserPrefs(user.id);
        const internal = internalDomainsFor(cfg, [domainOf(user.email)]);
        const sender = mail.from.email.toLowerCase();
        const [domainTrusted, userTrusted, names] = await Promise.all([
            getCompiledList('domain', DOMAIN_OWNER, 'external'), getCompiledList('user', user.id, 'external'), internalNames(),
        ]);
        const { ctx, firstTime } = await recipientContext(user, mail, cfg, prefs.learn);
        const ext = sender
            ? classifyExternal({
                fromEmail: sender, fromName: mail.from.name, internalDomains: internal, internalNames: names, firstTime, colleagueSpoof: cfg.external.colleagueSpoof,
                trusted: {
                    match: (who: Identity, at?: Date) => domainTrusted.match(who, at) ?? userTrusted.match(who, at),
                },
            })
            : NO_EXTERNAL;
        if (cfg.level === 'off') {
            return { score: null, band: 'clean', decision: 'delivered', folder: 'inbox', signals: [], raw: [], category: 'unknown', external: ext, allowId: null, packed: null, engine: 'off' };
        }
        const result = evaluateSpam({ ...toInput(mail), now: opts.now }, engineConfigFor(cfg, internal), ctx);
        // Permitidos (dominio o personal): entregan normal, pero NO eluden suplantacion ni malware.
        const who = identityOf(sender);
        const allowId = sender ? ((await getCompiledList('domain', DOMAIN_OWNER, 'allow')).match(who) ?? (await getCompiledList('user', user.id, 'allow')).match(who)) : null;
        let raw = result.raw;
        let { score, signals } = { score: result.score, signals: result.signals };
        let forceClean = false;
        if (allowId) {
            if (result.authFailed) {
                raw = [...raw, { id: 'imp.allow_spoof', family: 'impersonation', weight: 40, critical: true }];
                const agg = aggregateSignals(raw, engineConfigFor(cfg, internal), ctx.firstTime === true);
                score = agg.score; signals = agg.signals;
            } else if (!result.dangerousAttachment) forceClean = true;
        }
        const band: Band = forceClean ? 'clean' : bandOf(score, cfg, prefs.sensitivity);
        const d = decisionFor(band, cfg);
        const packed = packVerdict({
            decision: d.decision, band, signals, raw,
            ext: { ...(ext.colleagueSpoof ? { c: 1 as const } : {}), ...(ext.firstTime ? { f: 1 as const } : {}), ...(ext.trusted ? { t: 1 as const } : {}) },
            allowId: forceClean ? allowId : null,
        });
        return { score, band, decision: d.decision, folder: d.folder, signals, raw, category: result.category, external: ext, allowId, packed, engine: 'v2' };
    } catch (error) {
        console.error('[spam] v2 failed, using legacy classifier:', error instanceof Error ? error.message.slice(0, 200) : 'error');
        return legacy(mail);
    }
}

// ---------------------------------------------------------------------------
// 4) Persistencia del veredicto
// ---------------------------------------------------------------------------
export async function persistVerdict(emailId: string, user: InboundUser, mail: InboundMail, v: UserVerdict): Promise<void> {
    if (v.engine !== 'v2' && v.engine !== 'off') return;
    try {
        await execute(
            `UPDATE "Email" SET "spamScore" = $2, "spamReasons" = $3::jsonb, "isExternal" = $4 WHERE "id" = $1`,
            emailId, v.score, v.packed ? JSON.stringify(v.packed) : null, v.external.external,
        );
    } catch (error) {
        if (!isMissingRelation(error)) console.error('[spam] persist verdict failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
    }
    try {
        const cfg = await getSpamConfig();
        if (v.decision !== 'delivered' || cfg.logDelivered || v.allowId) {
            const reasons: CompactReason[] = v.signals.map((s) => ({ i: s.id, w: s.weight }));
            await recordEvent({
                userId: user.id, recipient: user.email, sender: mail.from.email || 'unknown', decision: v.decision, score: v.score,
                ruleId: v.allowId, ruleLabel: v.allowId ? 'allow' : null, reasons, external: v.external.external,
            });
        }
        if (v.allowId) void recordHits([v.allowId]);
        maybePurge(cfg);
    } catch { /* el registro es opcional */ }
}
