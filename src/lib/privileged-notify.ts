import { rateLimitAsync } from './security';

/**
 * Avisos de seguridad de las sesiones privilegiadas: correo transaccional de la instancia (con la marca del dominio, es + en) y push PWA a
 * las suscripciones de la cuenta. Mejor esfuerzo: nunca rompen el inicio de sesion. Rate limit / dedupe: como mucho 1 aviso por minuto
 * por cuenta y tipo. NUNCA incluyen tokens, cookies ni datos sensibles: solo tipo de sesion, dispositivo aproximado, IP y hora.
 */

export interface DeviceInfo { kind: 'web' | 'cli' | null; ip: string | null; device: string; at: string | null }

export type Notice =
    | { type: 'superseded'; old: DeviceInfo; now: DeviceInfo; suspicious: boolean }
    | { type: 'expired'; old: DeviceInfo; reason: 'expired_idle' | 'expired_absolute' }
    | { type: 'lockout'; replacements: number; windowMinutes: number }
    | { type: 'lockout_alert'; targetEmail: string; replacements: number; windowMinutes: number }
    | { type: 'suspicious_alert'; targetEmail: string; old: DeviceInfo; now: DeviceInfo };

export interface Recipient { userId: string | null; email: string }

export interface Transports {
    email: (to: string, subject: string, html: string, text: string) => Promise<void>;
    push: (userId: string, payload: { title: string; body: string; url: string; tag: string }) => Promise<void>;
}

let override: Partial<Transports> | null = null;
/** Solo para tests: sustituye el envio real. */
export function __setNotifyTransports(t: Partial<Transports> | null) { override = t; }

export function deviceLabel(ua: string | null | undefined): string {
    const s = String(ua ?? '');
    if (!s) return 'unknown';
    if (/bloomx-cli/i.test(s)) return s.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 40);
    const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /curl|node|undici/i.test(s) ? 'script' : 'browser';
    const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad|iOS/.test(s) ? 'iOS' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
    return os ? `${browser} / ${os}` : browser;
}

/** Clave de comparacion de dispositivo (navegador + sistema, sin versiones) para decidir si un reemplazo es "sospechoso". */
export const deviceKey = (ua: string | null | undefined): string => deviceLabel(ua).toLowerCase();

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const when = (iso: string | null) => (iso ? iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '-');
const kindName = (k: DeviceInfo['kind'], loc: 'es' | 'en') => (k === 'cli' ? (loc === 'es' ? 'CLI (bloomx)' : 'CLI (bloomx)') : k === 'web' ? (loc === 'es' ? 'consola web de administración' : 'web administration console') : '-');

interface Rendered { subject: string; lines: { es: string; en: string }[]; cta?: { es: string; en: string }; title: { es: string; en: string }; push: { title: string; body: string } }

function render(n: Notice, base: string): Rendered {
    const dev = (d: DeviceInfo) => `${d.device} · ${d.ip ?? '?'} · ${when(d.at)}`;
    switch (n.type) {
        case 'superseded': {
            const warn = n.suspicious
                ? { es: 'ATENCIÓN: la nueva sesión viene de una IP o dispositivo DISTINTO. Si NO fuiste tú: cambia tu contraseña y cierra todas las sesiones ahora (Seguridad).', en: 'WARNING: the new session came from a DIFFERENT IP or device. If it was NOT you: change your password and sign out of all sessions now (Security).' }
                : { es: 'Si no fuiste tú: cambia tu contraseña y cierra todas las sesiones desde Seguridad.', en: 'If this was not you: change your password and sign out of all sessions from Security.' };
            return {
                subject: n.suspicious ? 'Alerta: tu sesión de administración fue reemplazada desde otro dispositivo / Alert: your administration session was replaced from another device' : 'Tu sesión de administración se cerró porque iniciaste otra / Your administration session was closed because you started another',
                title: { es: 'Se cerró tu sesión de administración', en: 'Your administration session was closed' },
                lines: [
                    { es: `Sesión cerrada: ${kindName(n.old.kind, 'es')} — ${dev(n.old)}.`, en: `Closed session: ${kindName(n.old.kind, 'en')} — ${dev(n.old)}.` },
                    { es: `Nueva sesión: ${kindName(n.now.kind, 'es')} — ${dev(n.now)}.`, en: `New session: ${kindName(n.now.kind, 'en')} — ${dev(n.now)}.` },
                    { es: 'Solo puede haber UNA sesión de administración abierta a la vez (consola web + CLI).', en: 'Only ONE administration session can be open at a time (web console + CLI).' },
                    warn,
                ],
                cta: { es: 'Cambiar contraseña y cerrar sesiones', en: 'Change password and sign out of all sessions' },
                push: { title: n.suspicious ? 'Alerta de seguridad: sesión de administración reemplazada' : 'Tu sesión de administración se cerró', body: `${n.now.device} · ${n.now.ip ?? '?'} · ${n.suspicious ? 'Si no fuiste tú, cambia tu contraseña. / If not you, change your password.' : 'Solo se permite una sesión a la vez. / Only one session at a time.'}` },
            };
        }
        case 'expired':
            return {
                subject: 'Tu sesión de administración caducó / Your administration session expired',
                title: { es: 'Tu sesión de administración caducó', en: 'Your administration session expired' },
                lines: [{ es: n.reason === 'expired_idle' ? 'Se cerró por inactividad.' : 'Se alcanzó el tiempo máximo de una sesión de administración (12 h).', en: n.reason === 'expired_idle' ? 'It was closed for inactivity.' : 'The maximum duration of an administration session (12 h) was reached.' }],
                push: { title: 'Sesión de administración caducada', body: 'Vuelve a iniciar sesión. / Please sign in again.' },
            };
        case 'lockout':
            return {
                subject: 'Acceso de administración bloqueado por seguridad / Administration access locked for security',
                title: { es: 'Acceso de administración bloqueado', en: 'Administration access locked' },
                lines: [
                    { es: `Se detectaron ${n.replacements} reemplazos de sesión de administración en ${n.windowMinutes} minutos. Por seguridad se bloqueó tu acceso privilegiado (web y CLI). El correo web normal no se toca.`, en: `${n.replacements} administration session replacements were detected within ${n.windowMinutes} minutes. For security your privileged access (web and CLI) was locked. Your normal web mail is not affected.` },
                    { es: 'Qué hacer: cambia tu contraseña, rota tu MFA y cierra todas las sesiones. Un superadministrador podrá desbloquearte.', en: 'What to do: change your password, rotate your MFA and sign out of all sessions. A super administrator can unlock you.' },
                ],
                cta: { es: 'Cambiar contraseña y cerrar sesiones', en: 'Change password and sign out of all sessions' },
                push: { title: 'Acceso de administración bloqueado', body: 'Demasiados reemplazos de sesión. Cambia tu contraseña y contacta con un superadministrador. / Too many session replacements.' },
            };
        case 'lockout_alert':
            return {
                subject: `Alerta: acceso de administración bloqueado para ${n.targetEmail} / Alert: administration access locked for ${n.targetEmail}`,
                title: { es: 'Cuenta de administración bloqueada', en: 'Administration account locked' },
                lines: [
                    { es: `${n.targetEmail} acumuló ${n.replacements} reemplazos de sesión de administración en ${n.windowMinutes} minutos y quedó bloqueada.`, en: `${n.targetEmail} accumulated ${n.replacements} administration session replacements within ${n.windowMinutes} minutes and was locked.` },
                    { es: 'Revisa la auditoría (admin.session.lockout) y desbloquea con "perms unlock <correo>" o desde la vista Permisos (step-up con MFA) si es legítimo.', en: 'Review the audit log (admin.session.lockout) and unlock with "perms unlock <email>" or from the Permissions view (MFA step-up) if legitimate.' },
                ],
                push: { title: 'Cuenta de administración bloqueada', body: `${n.targetEmail}: ${n.replacements} reemplazos de sesión / session replacements` },
            };
        case 'suspicious_alert':
            return {
                subject: `Alerta de seguridad: sesión de administración de ${n.targetEmail} reemplazada desde otro dispositivo / Security alert: ${n.targetEmail}'s administration session replaced from another device`,
                title: { es: 'Reemplazo sospechoso de sesión de administración', en: 'Suspicious administration session replacement' },
                lines: [
                    { es: `Cuenta: ${n.targetEmail}. Sesión cerrada: ${dev(n.old)}.`, en: `Account: ${n.targetEmail}. Closed session: ${dev(n.old)}.` },
                    { es: `Nueva sesión (IP o dispositivo distinto): ${dev(n.now)}.`, en: `New session (different IP or device): ${dev(n.now)}.` },
                    { es: 'Si no es legítimo, revoca sus sesiones y restablece su contraseña / MFA.', en: 'If this is not legitimate, revoke its sessions and reset its password / MFA.' },
                ],
                push: { title: 'Alerta: reemplazo sospechoso de sesión', body: `${n.targetEmail} · ${n.now.device} · ${n.now.ip ?? '?'}` },
            };
    }
    void base;
}

async function defaultEmail(to: string, subject: string, html: string, text: string): Promise<void> {
    const topDomain = process.env.TOP_DOMAIN;
    if (!topDomain || !process.env.RESEND_API_KEY) return;
    const { resend } = await import('./resend');
    await resend.emails.send({ from: `noreply@${topDomain}`, to, subject, html, text, headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' } });
}
async function defaultPush(userId: string, payload: { title: string; body: string; url: string; tag: string }): Promise<void> {
    const { sendPushNotification } = await import('./notifications/web-push');
    await sendPushNotification(userId, payload);
}

async function brand(): Promise<{ name: string; color: string; onColor: string; locale: 'es' | 'en' | null }> {
    try {
        const { fetchDomainEmailContext, resolveEmailHost } = await import('./calendar/email-brand-server');
        const { getEmailBrand } = await import('./calendar/email-brand');
        const b = getEmailBrand(await fetchDomainEmailContext(resolveEmailHost(null)));
        return { name: b.name, color: b.color, onColor: b.onColor, locale: b.locale };
    } catch {
        return { name: process.env.NEXT_PUBLIC_BRAND_NAME || 'Bloom', color: '#2563eb', onColor: '#ffffff', locale: null };
    }
}

function html(b: Awaited<ReturnType<typeof brand>>, r: Rendered, link: string): string {
    const order: ('es' | 'en')[] = b.locale === 'en' ? ['en', 'es'] : ['es', 'en'];
    const blocks = order.map((l) => `<h2 style="font:600 18px system-ui,sans-serif;margin:18px 0 8px;color:#111">${esc(r.title[l])}</h2>${r.lines.map((x) => `<p style="font:14px/1.5 system-ui,sans-serif;margin:6px 0;color:#222">${esc(x[l])}</p>`).join('')}${r.cta ? `<p><a href="${esc(link)}" style="display:inline-block;padding:10px 16px;background:${esc(b.color)};color:${esc(b.onColor)};border-radius:6px;text-decoration:none;font:600 14px system-ui,sans-serif">${esc(r.cta[l])}</a></p>` : ''}`).join('<hr style="border:0;border-top:1px solid #ddd;margin:20px 0">');
    return `<!doctype html><html><body style="margin:0;background:#f4f4f5"><div style="max-width:560px;margin:0 auto;background:#fff"><div style="background:${esc(b.color)};color:${esc(b.onColor)};padding:14px 20px;font:700 16px system-ui,sans-serif">${esc(b.name)}</div><div style="padding:8px 20px 20px">${blocks}</div></div></body></html>`;
}

/** Envia el aviso (correo + push) con dedupe de 1/min por cuenta y tipo. Nunca lanza. */
export async function sendNotice(to: Recipient, n: Notice): Promise<boolean> {
    try {
        const rl = await rateLimitAsync(`priv:notice:${n.type}:${to.userId ?? to.email}`, 1, 60_000);
        if (!rl.ok) return false;
        const base = (process.env.NEXTAUTH_URL || (process.env.TOP_DOMAIN ? `https://${process.env.TOP_DOMAIN}` : '')).replace(/\/+$/, '');
        const link = `${base}/security`;
        const r = render(n, base);
        const b = await brand();
        const text = `${b.name}\n\n${r.title.es}\n${r.lines.map((l) => `- ${l.es}`).join('\n')}${r.cta ? `\n${r.cta.es}: ${link}` : ''}\n\n---\n${r.title.en}\n${r.lines.map((l) => `- ${l.en}`).join('\n')}${r.cta ? `\n${r.cta.en}: ${link}` : ''}\n`;
        const t = { email: override?.email ?? defaultEmail, push: override?.push ?? defaultPush };
        await t.email(to.email, r.subject, html(b, r, link), text).catch(() => undefined);
        if (to.userId) await t.push(to.userId, { title: r.push.title, body: r.push.body, url: '/security', tag: `bloomx-priv-${n.type}` }).catch(() => undefined);
        return true;
    } catch {
        return false;
    }
}
