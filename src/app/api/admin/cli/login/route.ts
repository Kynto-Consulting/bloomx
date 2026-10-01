import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { ownDomains } from '@/lib/backend-auth';
import { mfaRequiredFor, getMfaStatus, verifyMfa } from '@/lib/mfa';
import { refreshPermissions } from '@/lib/permissions';
import { effectiveLevelSync } from '@/lib/permissions-core';
import { mfaAttemptLimit } from '@/lib/mfa-http';
import { verifyManagerCookieOwnsInstance } from '@/lib/manager-auth';
import { auditLog, getClientIp, getDummyBcryptHash, rateLimitAsync, rateLimitResetAsync } from '@/lib/security';
import { findUserByEmail } from '@/lib/user-lookup';
import { getUserState } from '@/lib/admin/user-state';
import { backendBaseUrl } from '@/lib/backend-auth';
import { clampTtlHours, createCliToken, normalizeScopes, scopesAllowedForLevel } from '@/lib/admin-cli/tokens';
import { CmdError } from '@/lib/admin-cli/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    NextResponse.json({ error, code, ...extra }, { status, headers: { ...NO_STORE, ...headers } });

/**
 * POST /api/admin/cli/login { email, password, code?, recoveryCode?, name?, scopes?, ttlHours? }
 *   -> { token, tokenId, scopes, expiresAt, account: { email, kind }, domain }   (el token se muestra UNA vez)
 *   -> { mfaRequired: true }  (contrasena correcta; reintentar con `code` o `recoveryCode`)
 *
 * Publico (es el login), por eso: limite por IP y por cuenta, bcrypt de tiempo constante, mensajes genericos y auditoria.
 * Solo emite tokens a ADMINISTRADORES de ESTA instancia:
 *   - usuario de la app con permission_level >= 1 (ADMIN_EMAILS = 4, o concedido desde la consola) y MFA verificado; el token queda
 *     acotado al nivel de la cuenta (nunca mas) y sus ambitos tambien (read desde 1, write y security desde 2); o
 *   - manager del backend compartido que es DUENO del dominio de la instancia (verifyManagerCookieOwnsInstance).
 * Cualquier otra cuenta recibe el mismo 401. Un manager con MFA propio en el backend crea el token desde la consola web
 * (`tokens create`), donde ya hay sesion.
 */
export async function POST(req: NextRequest) {
    const ip = getClientIp(req);
    try {
        const ipRl = await rateLimitAsync(`admin:cli:login:ip:${ip}`, 15, 15 * 60_000);
        if (!ipRl.ok) {
            auditLog('admin.cli.login_rate_limited', { ip, scope: 'ip' });
            return fail(429, 'Too many attempts. Try again later.', 'rate_limited', {}, { 'Retry-After': String(ipRl.retryAfter) });
        }
        const raw = await req.text().catch(() => '');
        let body: Record<string, unknown>;
        try { body = raw.length < 8192 ? JSON.parse(raw) : {}; } catch { body = {}; }
        const email = typeof body.email === 'string' ? body.email.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (!email || !password || email.length > 254 || password.length > 1024) return fail(400, 'Missing fields', 'missing_fields');

        let scopes; let ttl: number; let name: string;
        try {
            scopes = body.scopes === undefined ? (['read', 'write'] as const).slice() : normalizeScopes(body.scopes);
            ttl = clampTtlHours(body.ttlHours);
            name = (typeof body.name === 'string' ? body.name : 'cli').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60) || 'cli';
        } catch (e) {
            return fail(400, e instanceof CmdError ? e.message : 'Invalid options', 'invalid_options');
        }

        const acctKey = `admin:cli:login:acct:${email.toLowerCase()}`;
        const acct = await rateLimitAsync(acctKey, 8, 15 * 60_000);
        if (!acct.ok) {
            auditLog('admin.cli.login_locked', { email, ip });
            return fail(429, 'Too many attempts. Try again later.', 'rate_limited', {}, { 'Retry-After': String(acct.retryAfter) });
        }

        const domain = ownDomains()[0] ?? null;
        const invalid = () => {
            auditLog('admin.cli.login_failure', { email, ip });
            return fail(401, 'Invalid credentials', 'invalid_credentials');
        };

        // --- a) usuario de la app con rol de administrador ---
        const user = await findUserByEmail(email);
        await refreshPermissions();
        const eff = user ? effectiveLevelSync(user.email) : { level: 0 as const, source: 'none' as const };
        if (user && eff.level >= 1) {
            const hash = user.password || (await getDummyBcryptHash());
            const ok = await bcrypt.compare(password, hash);
            if (!ok || !user.password) return invalid();
            if ((await getUserState(user.id)).disabled) { auditLog('admin.cli.login_disabled', { userId: user.id, ip }); return fail(403, 'Account disabled', 'account_disabled'); }

            const required = mfaRequiredFor(user.email);
            const mfa = await getMfaStatus(user.id);
            if (required && !mfa.available) return fail(503, 'Service temporarily unavailable', 'service_unavailable');
            if (mfa.available && (mfa.enabled || required)) {
                if (!mfa.enabled) return fail(403, 'Enrol MFA in the web console first', 'mfa_enroll_required');
                const code = typeof body.code === 'string' ? body.code : undefined;
                const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode : undefined;
                if (!code && !recoveryCode) return NextResponse.json({ mfaRequired: true }, { headers: NO_STORE });
                const limited = await mfaAttemptLimit(req, user.id, 'cli-login');
                if (limited) return limited;
                const v = await verifyMfa(user.id, { code, recoveryCode });
                if (!v.ok) { auditLog('admin.cli.login_mfa_failed', { userId: user.id, ip }); return fail(401, 'Invalid code', 'invalid_mfa'); }
            }
            await rateLimitResetAsync(acctKey);
            const allowed = scopesAllowedForLevel(eff.level);
            const granted = body.scopes === undefined ? scopes.filter((s) => allowed.includes(s)) : scopes;
            if (granted.length === 0 || granted.some((s) => !allowed.includes(s))) return fail(403, `Scope not allowed for permission_level ${eff.level}`, 'scope_exceeds_level');
            const { token, record } = await createCliToken({ kind: 'user', adminId: user.id, adminEmail: user.email, name, scopes: granted, ttlHours: ttl, ip, domain, permissionLevel: eff.level });
            auditLog('admin.cli.login', { userId: user.id, email: user.email, ip, kind: 'user', scopes: scopes.join(','), ttlHours: ttl });
            return NextResponse.json({ token, tokenId: record.id, scopes: record.scopes, expiresAt: record.expiresAt, account: { email: user.email, kind: 'user' }, domain }, { headers: NO_STORE });
        }

        // --- b) manager del backend compartido, solo si es DUENO del dominio de esta instancia ---
        const res = await fetch(`${backendBaseUrl()}/api/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), cache: 'no-store', signal: AbortSignal.timeout(8000),
        }).catch(() => null);
        if (!res) return fail(503, 'Service temporarily unavailable', 'backend_unavailable');
        if (res.status >= 500) return fail(503, 'Service temporarily unavailable', 'backend_unavailable');
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok) return res.status === 429 ? fail(429, 'Too many attempts. Try again later.', 'rate_limited') : invalid();
        if (data?.mfaRequired || data?.mfaEnrollRequired) {
            return fail(409, 'This manager account uses MFA on the shared backend. Create a token from the web console (tokens create) and use --token.', 'manager_mfa_unsupported');
        }
        const issued = /(?:^|[,;\s])auth_session=([^;,\s]+)/.exec(res.headers.get('set-cookie') || '')?.[1];
        const own = await verifyManagerCookieOwnsInstance(issued);
        if (!own.ok) {
            auditLog('admin.access_denied', { reason: `cli_login_manager_${own.reason}`, ip, path: '/api/admin/cli/login' });
            if (own.reason === 'backend_unavailable') return fail(503, 'Service temporarily unavailable', 'backend_unavailable');
            // Misma respuesta que unas credenciales invalidas hacia fuera de la propiedad: no se revela si la cuenta existe
            return fail(403, 'Forbidden: this account does not manage this domain', 'domain_not_owned');
        }
        await rateLimitResetAsync(acctKey);
        const { token, record } = await createCliToken({
            kind: 'manager', adminId: own.managerId ?? email.toLowerCase(), adminEmail: own.email ?? email, name, scopes, ttlHours: ttl, ip, domain, managerSession: issued, permissionLevel: 4,
        });
        auditLog('admin.cli.login', { userId: own.managerId, email: own.email ?? email, ip, kind: 'manager', scopes: scopes.join(','), ttlHours: ttl });
        return NextResponse.json({ token, tokenId: record.id, scopes: record.scopes, expiresAt: record.expiresAt, account: { email: own.email ?? email, kind: 'manager' }, domain }, { headers: NO_STORE });
    } catch (error) {
        if (error instanceof CmdError && error.code === 'token_limit') return fail(409, error.message, 'token_limit');
        console.error('[ADMIN_CLI_LOGIN]', error instanceof Error ? error.message.slice(0, 200) : 'error');
        return fail(500, 'Internal server error', 'internal');
    }
}
