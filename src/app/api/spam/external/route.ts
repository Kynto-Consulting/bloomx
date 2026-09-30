import { ownDomains } from '@/lib/backend-auth';
import { getSpamConfig } from '@/lib/spam/config-store';
import { DEFAULT_EXTERNAL_TEXT } from '@/lib/spam/external';
import { MAX_EXTERNAL_ENTRIES } from '@/lib/spam/lists-core';
import { DOMAIN_OWNER, listEntries } from '@/lib/spam/lists-store';
import { domainOf } from '@/lib/spam/text';
import { userRoute } from '@/lib/spam/user-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Politica PUBLICA de correos externos para el cliente (insignia en la lista, aviso en el lector). Solo lo necesario para decidir
 * en el navegador: dominios internos, textos, opciones y la whitelist de confiables (dominio + personal, sin regex).
 */
export const GET = userRoute({ scope: 'external.read', limit: 120 }, async ({ user }) => {
    const cfg = await getSpamConfig();
    const e = cfg.external;
    const internal = Array.from(new Set([...ownDomains(), ...e.internalDomains, domainOf(user.email)].filter(Boolean)));
    const trusted: Array<{ t: string; v: string; s: boolean }> = [];
    if (e.enabled) {
        for (const [scope, owner] of [['domain', DOMAIN_OWNER], ['user', user.id]] as const) {
            const r = await listEntries({ scope, ownerKey: owner, kind: 'external', status: 'active', pageSize: 200, page: 1 });
            let page = 1;
            let rows = r.rows;
            while (rows.length > 0 && trusted.length < MAX_EXTERNAL_ENTRIES * 2) {
                for (const x of rows) if (x.matchType !== 'regex') trusted.push({ t: x.matchType, v: x.value, s: x.includeSubdomains });
                if (rows.length < 200) break;
                page += 1;
                rows = (await listEntries({ scope, ownerKey: owner, kind: 'external', status: 'active', pageSize: 200, page })).rows;
            }
        }
    }
    return {
        enabled: e.enabled, style: e.style, subjectTag: e.subjectTag, colleagueSpoof: e.colleagueSpoof, firstTime: e.firstTime,
        hardenLinks: e.hardenLinks, hardenAttachments: e.hardenAttachments,
        text: { es: e.text.es || DEFAULT_EXTERNAL_TEXT.es, en: e.text.en || DEFAULT_EXTERNAL_TEXT.en },
        internalDomains: internal, trusted,
    };
});
