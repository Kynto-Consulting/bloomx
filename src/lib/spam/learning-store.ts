/**
 * Aprendizaje por usuario: tabla SpamToken (modelo bayesiano, tope 5000 tokens con expulsion LRU), SpamSender (contadores por
 * remitente/dominio) y preferencias (AdminSetting 'spamUser:<id>': aprender + sensibilidad). Todo tolerante a tabla ausente.
 */
import { execute, isMissingRelation, num, query } from '@/lib/admin/sql';
import { prisma } from '@/lib/prisma';
import { COUNTER_TOKEN, MAX_TOKENS_PER_USER, classify, tokenize, type BayesResult, type Model, type MessageForTokens } from './bayes';
import { domainOf, parseAddress } from './text';

export const USER_PREFS_PREFIX = 'spamUser:';

export interface UserSpamPrefs {
    /** "Aprender de mis marcas" (por defecto activado). */
    learn: boolean;
    /** -1 menos estricto, 0 igual que el dominio, +1 mas estricto. */
    sensitivity: -1 | 0 | 1;
}
export const DEFAULT_PREFS: UserSpamPrefs = { learn: true, sensitivity: 0 };

export function sanitizePrefs(raw: unknown, base: UserSpamPrefs = DEFAULT_PREFS): UserSpamPrefs {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const s = Number(o.sensitivity);
    return {
        learn: typeof o.learn === 'boolean' ? o.learn : base.learn,
        sensitivity: s === -1 || s === 1 ? s : Number.isFinite(s) && s === 0 ? 0 : base.sensitivity,
    };
}

export async function getUserPrefs(userId: string): Promise<UserSpamPrefs> {
    try {
        const rows = await query<{ value: unknown }>(`SELECT "value" FROM "AdminSetting" WHERE "key" = $1`, `${USER_PREFS_PREFIX}${userId}`);
        return sanitizePrefs(rows[0]?.value);
    } catch { return DEFAULT_PREFS; }
}

export async function saveUserPrefs(userId: string, patch: unknown): Promise<UserSpamPrefs> {
    const next = sanitizePrefs(patch, await getUserPrefs(userId));
    await execute(
        `INSERT INTO "AdminSetting" ("key","value","updatedAt","updatedBy") VALUES ($1,$2::jsonb,NOW(),$3)
         ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW(), "updatedBy" = EXCLUDED."updatedBy"`,
        `${USER_PREFS_PREFIX}${userId}`, JSON.stringify(next), userId.slice(0, 200),
    );
    return next;
}

// ---------------------------------------------------------------------------
// Modelo bayesiano
// ---------------------------------------------------------------------------
/** Carga solo lo necesario: la fila contador y los tokens del mensaje. */
export async function loadModel(userId: string, tokens: string[]): Promise<Model> {
    const model: Model = { spamMessages: 0, hamMessages: 0, tokens: new Map() };
    try {
        const rows = await query<{ tokenHash: string; spam: number; ham: number }>(
            `SELECT "tokenHash","spam","ham" FROM "SpamToken" WHERE "userId" = $1 AND "tokenHash" = ANY($2::text[])`, userId, [COUNTER_TOKEN, ...tokens.slice(0, 200)],
        );
        for (const r of rows) {
            if (r.tokenHash === COUNTER_TOKEN) { model.spamMessages = num(r.spam); model.hamMessages = num(r.ham); }
            else model.tokens.set(r.tokenHash, { spam: num(r.spam), ham: num(r.ham) });
        }
    } catch (error) {
        if (!isMissingRelation(error)) console.error('[spam-learn] model load failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
    }
    return model;
}

export async function classifyForUser(userId: string, msg: MessageForTokens): Promise<BayesResult | null> {
    const tokens = tokenize(msg);
    if (tokens.length === 0) return null;
    return classify(tokens, await loadModel(userId, tokens));
}

/**
 * Entrena con un mensaje. `label` es lo que el usuario ha decidido; `undo` (opcional) es la marca contraria previa que se retira
 * (p. ej. lo marco spam y ahora dice "no es spam": se resta de spam y se suma a ham). Aplica el tope de 5000 tokens (LRU).
 */
export async function train(userId: string, msg: MessageForTokens, label: 'spam' | 'ham', opts: { undo?: boolean } = {}): Promise<void> {
    const tokens = tokenize(msg);
    if (tokens.length === 0) return;
    const inc = label === 'spam' ? [1, 0] : [0, 1];
    const dec = opts.undo ? (label === 'spam' ? [0, 1] : [1, 0]) : [0, 0];
    try {
        await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `spamtok:${userId}`);
            const upsert = (hash: string, s: number, h: number) => tx.$executeRawUnsafe(
                `INSERT INTO "SpamToken" ("userId","tokenHash","spam","ham","updatedAt") VALUES ($1,$2,GREATEST($3,0),GREATEST($4,0),NOW())
                 ON CONFLICT ("userId","tokenHash") DO UPDATE SET "spam" = GREATEST("SpamToken"."spam" + $3, 0), "ham" = GREATEST("SpamToken"."ham" + $4, 0), "updatedAt" = NOW()`,
                userId, hash, s, h,
            );
            const ds = inc[0] - dec[0], dh = inc[1] - dec[1];
            await upsert(COUNTER_TOKEN, ds, dh);
            for (const t of tokens) await upsert(t, ds, dh);
            // Tope LRU: se conservan los MAX_TOKENS_PER_USER mas recientes (el contador no cuenta).
            await tx.$executeRawUnsafe(
                `DELETE FROM "SpamToken" WHERE "userId" = $1 AND "tokenHash" <> $2 AND ("userId","tokenHash") IN (
                    SELECT "userId","tokenHash" FROM "SpamToken" WHERE "userId" = $1 AND "tokenHash" <> $2
                    ORDER BY "updatedAt" DESC, "tokenHash" ASC OFFSET $3)`,
                userId, COUNTER_TOKEN, MAX_TOKENS_PER_USER,
            );
        }, { timeout: 30_000, maxWait: 10_000 });
    } catch (error) {
        if (!isMissingRelation(error)) console.error('[spam-learn] train failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
    }
}

export async function modelStats(userId: string): Promise<{ spamMessages: number; hamMessages: number; tokens: number }> {
    try {
        const c = (await query<{ spam: number; ham: number }>(`SELECT "spam","ham" FROM "SpamToken" WHERE "userId" = $1 AND "tokenHash" = $2`, userId, COUNTER_TOKEN))[0];
        const n = num((await query<{ n: bigint }>(`SELECT COUNT(*) AS n FROM "SpamToken" WHERE "userId" = $1 AND "tokenHash" <> $2`, userId, COUNTER_TOKEN))[0]?.n);
        return { spamMessages: num(c?.spam), hamMessages: num(c?.ham), tokens: n };
    } catch { return { spamMessages: 0, hamMessages: 0, tokens: 0 }; }
}

/** Borra el modelo aprendido del usuario (tokens + contadores por remitente). */
export async function deleteModel(userId: string): Promise<{ tokens: number; senders: number }> {
    let tokens = 0, senders = 0;
    try { tokens = await execute(`DELETE FROM "SpamToken" WHERE "userId" = $1`, userId); } catch (e) { if (!isMissingRelation(e)) throw e; }
    try { senders = await execute(`DELETE FROM "SpamSender" WHERE "userId" = $1`, userId); } catch (e) { if (!isMissingRelation(e)) throw e; }
    return { tokens, senders };
}

// ---------------------------------------------------------------------------
// Contadores por remitente / dominio
// ---------------------------------------------------------------------------
export const senderKeys = (email: string): { e: string; d: string } => {
    const a = parseAddress(email).email || email.trim().toLowerCase();
    return { e: `e:${a}`.slice(0, 320), d: `d:${domainOf(a)}`.slice(0, 260) };
};

export async function bumpSender(userId: string, fromHeader: string, label: 'spam' | 'ham', undo = false): Promise<void> {
    const k = senderKeys(fromHeader);
    if (k.d === 'd:') return;
    const inc = label === 'spam' ? [1, 0] : [0, 1];
    const dec = undo ? (label === 'spam' ? [0, 1] : [1, 0]) : [0, 0];
    try {
        for (const key of [k.e, k.d]) {
            await execute(
                `INSERT INTO "SpamSender" ("userId","senderKey","spamCount","hamCount","updatedAt") VALUES ($1,$2,GREATEST($3,0),GREATEST($4,0),NOW())
                 ON CONFLICT ("userId","senderKey") DO UPDATE SET "spamCount" = GREATEST("SpamSender"."spamCount" + $3, 0), "hamCount" = GREATEST("SpamSender"."hamCount" + $4, 0), "updatedAt" = NOW()`,
                userId, key, inc[0] - dec[0], inc[1] - dec[1],
            );
        }
    } catch (error) {
        if (!isMissingRelation(error)) console.error('[spam-learn] sender count failed:', error instanceof Error ? error.message.slice(0, 200) : 'error');
    }
}

export async function senderCounts(userId: string, fromEmail: string): Promise<{ spamFromSender: number; hamFromSender: number; spamFromDomain: number; hamFromDomain: number }> {
    const k = senderKeys(fromEmail);
    const out = { spamFromSender: 0, hamFromSender: 0, spamFromDomain: 0, hamFromDomain: 0 };
    try {
        const rows = await query<{ senderKey: string; spamCount: number; hamCount: number }>(`SELECT "senderKey","spamCount","hamCount" FROM "SpamSender" WHERE "userId" = $1 AND "senderKey" = ANY($2::text[])`, userId, [k.e, k.d]);
        for (const r of rows) {
            if (r.senderKey === k.e) { out.spamFromSender = num(r.spamCount); out.hamFromSender = num(r.hamCount); }
            else { out.spamFromDomain = num(r.spamCount); out.hamFromDomain = num(r.hamCount); }
        }
    } catch { /* sin tabla */ }
    return out;
}
