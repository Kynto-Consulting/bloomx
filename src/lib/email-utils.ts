/**
 * Email normalization utilities for Gmail-style aliasing
 */

/**
 * Normalizes an email address by removing dots and plus-tags from the local part
 * Examples:
 * - john.doe@example.com -> johndoe@example.com
 * - john+tag@example.com -> john@example.com
 * - john.doe+tag@example.com -> johndoe@example.com
 */
export function normalizeEmailAddress(email: string): string {
    const [localPart, domain] = email.toLowerCase().split('@');

    if (!domain) return email.toLowerCase();

    // Remove dots from local part
    let normalized = localPart.replace(/\./g, '');

    // Remove everything after and including the first '+'
    const plusIndex = normalized.indexOf('+');
    if (plusIndex !== -1) {
        normalized = normalized.substring(0, plusIndex);
    }

    return `${normalized}@${domain}`;
}

/**
 * Checks if an email belongs to the configured TOP_DOMAIN
 */
export function isValidDomain(email: string): boolean {
    const topDomain = process.env.TOP_DOMAIN;
    if (!topDomain) return true; // No domain restriction if not configured

    const domain = email.toLowerCase().split('@')[1];
    return domain === topDomain.toLowerCase();
}

/**
 * Extracts the domain from an email address
 */
export function extractDomain(email: string): string | null {
    const parts = email.split('@');
    return parts.length === 2 ? parts[1] : null;
}

/**
 * Parses an email string in the format "Name <email@domain.com>" or just "email@domain.com"
 * Returns { name, email }
 */
export function parseEmailAddress(emailString: string): { name: string | null; email: string } {
    const match = emailString.match(/^(.+?)\s*<(.+?)>$/);

    if (match) {
        return {
            name: match[1].trim(),
            email: match[2].trim()
        };
    }

    return {
        name: null,
        email: emailString.trim()
    };
}

/**
 * Formats an email address as "Name <email@domain.com>"
 */
export function formatEmailAddress(name: string | null, email: string): string {
    if (!name) return email;
    return `${name} <${email}>`;
}

/**
 * Splits an address list ("A <a@x>, "Doe, John" <j@x>, b@y") on top-level commas,
 * ignoring commas that appear inside double quotes or angle brackets.
 */
export function splitAddressList(value?: string | null): string[] {
    const source = String(value || '');
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    let angleDepth = 0;

    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (ch === '\\' && inQuotes && i + 1 < source.length) {
            current += ch + source[++i];
            continue;
        }
        if (ch === '"') inQuotes = !inQuotes;
        else if (!inQuotes && ch === '<') angleDepth++;
        else if (!inQuotes && ch === '>' && angleDepth > 0) angleDepth--;

        if ((ch === ',' || ch === ';') && !inQuotes && angleDepth === 0) {
            if (current.trim()) parts.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

/** Returns the bare lowercase email of a single address entry ("Name <a@b>" or "a@b"), or '' if none. */
export function extractEmailOnly(entry?: string | null): string {
    const raw = String(entry || '').trim();
    if (!raw) return '';
    const angled = raw.match(/<([^<>]+)>\s*$/) || raw.match(/<([^<>]+)>/);
    const candidate = (angled?.[1] || raw).trim().replace(/^"+|"+$/g, '').toLowerCase();
    return candidate.includes('@') ? candidate : '';
}

/**
 * Computes Reply-All recipients: primary target (Reply-To or From) in `to`; every other original
 * To + Cc address in `cc`. De-duplicated, excluding the user's own addresses. Display names are kept.
 */
export function buildReplyAllRecipients(opts: {
    from?: string | null;
    replyTo?: string | null;
    to?: string | null;
    cc?: string | null;
    ownEmails: Iterable<string>;
}): { to: string[]; cc: string[] } {
    const own = new Set<string>();
    for (const e of opts.ownEmails) {
        const email = extractEmailOnly(e);
        if (email) { own.add(email); own.add(normalizeEmailAddress(email)); }
    }
    const isOwn = (email: string) => own.has(email) || own.has(normalizeEmailAddress(email));

    const seen = new Set<string>();
    const pick = (entries: string[]): string[] => {
        const out: string[] = [];
        for (const entry of entries) {
            const email = extractEmailOnly(entry);
            if (!email || isOwn(email) || seen.has(email)) continue;
            seen.add(email);
            // Names containing commas/quotes are dropped to a bare address so downstream naive
            // comma-splitting (API validation) can never break the recipient.
            out.push(/[",;]/.test(entry.replace(/<[^>]*>\s*$/, '')) ? email : entry);
        }
        return out;
    };

    const primarySource = splitAddressList(opts.replyTo).length > 0 ? opts.replyTo : opts.from;
    let to = pick(splitAddressList(primarySource));
    let cc: string[];

    if (to.length === 0) {
        // Replying to our own message: address the original To, keep original Cc.
        to = pick(splitAddressList(opts.to));
        cc = pick(splitAddressList(opts.cc));
    } else {
        cc = pick([...splitAddressList(opts.to), ...splitAddressList(opts.cc)]);
    }
    return { to, cc };
}
