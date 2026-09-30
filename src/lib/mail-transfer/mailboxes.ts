/**
 * mailboxes.ts - dominios de la instancia, busqueda de buzones (User) y estado de una direccion frente a la instancia.
 */
import { query } from '@/lib/admin/sql';
import { ownDomains } from '@/lib/backend-auth';

/** Dominios en los que esta instancia puede tener buzones: TOP_DOMAIN + host de NEXT_PUBLIC_APP_URL (+ MAIL_TRANSFER_ALLOWED_DOMAINS). */
export function allowedDomains(env: NodeJS.ProcessEnv = process.env): string[] {
    const set = new Set<string>();
    // Sin TOP_DOMAIN (instancias locales/E2E) los buzones viven en el dominio de los administradores configurados.
    if (!env.TOP_DOMAIN) {
        for (const a of String(env.ADMIN_EMAILS || '').split(',')) {
            const d = a.trim().toLowerCase().split('@')[1];
            if (d && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) set.add(d);
        }
    }
    for (const d of ownDomains(env as any)) set.add(d);
    for (const d of String(env.MAIL_TRANSFER_ALLOWED_DOMAINS || '').split(',')) {
        const v = d.trim().toLowerCase();
        if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) set.add(v);
    }
    return [...set];
}

/** Dominio "principal" de la instancia (para etiquetar los trabajos). */
export function instanceDomain(env: NodeJS.ProcessEnv = process.env): string {
    return allowedDomains(env)[0] || 'localhost';
}

export function domainOf(address: string): string {
    const at = address.lastIndexOf('@');
    return at < 0 ? '' : address.slice(at + 1).toLowerCase();
}

export function isInstanceAddress(address: string, domains: string[] = allowedDomains()): boolean {
    const d = domainOf(address);
    return !!d && domains.includes(d);
}

export type MailboxStatus = 'exists' | 'missing' | 'foreign_domain';

export interface MailboxLookup {
    id: string;
    email: string;
    name: string | null;
}

/** Usuarios existentes para un conjunto de direcciones (comparacion en minusculas). */
export async function findUsersByEmail(addresses: string[]): Promise<Map<string, MailboxLookup>> {
    const out = new Map<string, MailboxLookup>();
    const list = Array.from(new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean)));
    for (let i = 0; i < list.length; i += 500) {
        const rows = await query<MailboxLookup>(`SELECT "id","email","name" FROM "User" WHERE lower("email") = ANY($1::text[])`, list.slice(i, i + 500));
        for (const r of rows) out.set(r.email.toLowerCase(), r);
    }
    return out;
}

export async function mailboxStatuses(addresses: string[], domains = allowedDomains()): Promise<Map<string, MailboxStatus>> {
    const users = await findUsersByEmail(addresses);
    const out = new Map<string, MailboxStatus>();
    for (const a of addresses) {
        const k = a.trim().toLowerCase();
        out.set(a, users.has(k) ? 'exists' : isInstanceAddress(k, domains) ? 'missing' : 'foreign_domain');
    }
    return out;
}

export const EMAIL_SHAPE = /^[^\s@,;<>"()]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
