import { NextResponse } from 'next/server';
import { requireLevel } from '@/lib/admin-auth';
import { refreshPermissions } from '@/lib/permissions';
import { rateLimitAsync } from '@/lib/security';
import { USERS_IDS_MAX, resolveUsers, searchUsers } from '@/lib/admin/extension-users';

/**
 * Buscador de usuarios del dominio para los ajustes de extensiones (`user`, `users`, `userMap`).
 *
 *   GET ?q=&page=0&limit=20&minLevel=&role=   -> { users:[{ id, email, name, disabled, level, levelName }], total, page, limit, hasMore }
 *   GET ?ids=a,b,c                            -> { users:[...encontrados], missing:[ids que ya no existen] }   (max 100)
 *
 * Nivel 3 (admin): editar estos ajustes exige el mismo nivel que `PUT /api/admin/extensions/config` salvo que aqui solo se LEE el directorio
 * (id, correo, nombre, estado, nivel). Aislamiento: la fuente es la base de ESTA instancia (un dominio por instancia), sin parametro de dominio.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(req: Request) {
    const guard = await requireLevel(3, req);
    if (!guard.ok) return guard.response;
    try {
        const limited = await rateLimitAsync(`extusers:${guard.actor.id ?? guard.actor.email ?? 'x'}`, 120, 60_000);
        if (!limited.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(limited.retryAfter) } });
        await refreshPermissions();
        const params = new URL(req.url).searchParams;

        if (params.has('ids')) {
            const ids = (params.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, USERS_IDS_MAX);
            if (ids.some((id) => !ID_RE.test(id))) return NextResponse.json({ error: 'Invalid ids' }, { status: 400, headers: NO_STORE });
            const found = await resolveUsers(ids);
            return NextResponse.json({ users: [...found.values()], missing: ids.filter((id) => !found.has(id)) }, { headers: NO_STORE });
        }

        const minRaw = params.get('minLevel');
        const minLevel = minRaw === null || minRaw === '' ? undefined : Number(minRaw);
        if (minLevel !== undefined && !(Number.isInteger(minLevel) && minLevel >= 0 && minLevel <= 4)) return NextResponse.json({ error: 'Invalid minLevel' }, { status: 400, headers: NO_STORE });
        const roleRaw = params.get('role');
        if (roleRaw && !/^[A-Za-z0-9_-]{1,32}$/.test(roleRaw)) return NextResponse.json({ error: 'Invalid role' }, { status: 400, headers: NO_STORE });
        const out = await searchUsers({
            q: params.get('q') || undefined,
            page: Number(params.get('page') || 0),
            limit: Number(params.get('limit') || 20),
            filter: { ...(minLevel !== undefined ? { minLevel } : {}), ...(roleRaw ? { role: roleRaw } : {}) },
        });
        return NextResponse.json(out, { headers: NO_STORE });
    } catch (error) {
        console.error('[ADMIN_EXTENSION_USERS]', error instanceof Error ? error.message : 'error');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: NO_STORE });
    }
}
