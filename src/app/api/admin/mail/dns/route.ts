import { z } from 'zod';
import { adminRoute, parseQuery } from '@/lib/admin/http';
import { ownDomains } from '@/lib/backend-auth';
import { DKIM_SELECTOR_RE, getDnsHealth, isPlausibleDomain } from '@/lib/admin/dns-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
    selector: z.string().trim().toLowerCase().regex(DKIM_SELECTOR_RE).optional(),
    fresh: z.enum(['1']).optional(),
});

/**
 * GET /api/admin/mail/dns?selector=&fresh=1 -> salud DNS de SOLO LECTURA (SPF, DKIM, DMARC, MX).
 * El dominio es SIEMPRE el activo de la instancia (nunca uno recibido del cliente). Cache de 60 s; `fresh=1` la omite
 * (limitado por el rate limit de la ruta).
 */
export const GET = adminRoute({ scope: 'mail.dns', limit: 20 }, async ({ req }) => {
    const { selector, fresh } = parseQuery(req, schema);
    const domain = ownDomains()[0];
    if (!isPlausibleDomain(domain)) {
        return { configured: false, domain: null, checkedAt: new Date().toISOString(), spf: null, dkim: null, dmarc: null, mx: null };
    }
    return { ...(await getDnsHealth(domain, { selector: selector ?? null, fresh: fresh === '1' })) };
});
