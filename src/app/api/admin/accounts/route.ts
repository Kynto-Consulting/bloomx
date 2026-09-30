import { adminRoute, parseQuery } from '@/lib/admin/http';
import { pageMeta, parsePaging } from '@/lib/admin/paging';
import { tolerant } from '@/lib/admin/sql';
import { accountFiltersSchema, listAccounts } from '@/lib/admin/accounts-store';

// GET: cuentas vinculadas (OAuth). NUNCA devuelve tokens: el estado se deriva de booleanos y fechas (ver accounts-store.ts).
export const GET = adminRoute({ scope: 'accounts.list' }, async ({ req }) => {
    const filters = parseQuery(req, accountFiltersSchema);
    const paging = parsePaging(new URL(req.url).searchParams, { defaultSize: 25, maxSize: 100 });
    const { rows, total, providers } = await tolerant(
        () => listAccounts(filters, { limit: paging.pageSize, offset: paging.offset }),
        { rows: [], total: 0, providers: [] as string[] },
    );
    return { accounts: rows, providers, page: pageMeta(paging, total) };
});
