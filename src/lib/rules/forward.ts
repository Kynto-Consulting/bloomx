/**
 * Accion de regla "reenviar a": DESACTIVADA por defecto (RULES_FORWARD_ENABLED=true para habilitarla) y limitada a
 * direcciones VERIFICADAS del propio usuario (las cuentas vinculadas a su usuario; nunca terceros). Solo actua al RECIBIR
 * un correo (jamas en aplicaciones retroactivas), con tope por hora y sin bucles (no reenvia correos automaticos ni reenvios).
 */
import { prisma } from '@/lib/prisma';

export const FORWARD_HOURLY_LIMIT = 30;

export const forwardingEnabled = () => String(process.env.RULES_FORWARD_ENABLED || '').toLowerCase() === 'true';

/** Direcciones a las que se puede reenviar: cuentas vinculadas del usuario, distintas de su direccion principal. */
export async function verifiedForwardTargets(userId: string): Promise<string[]> {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, accounts: { select: { providerAccountId: true } } } });
    const primary = (u?.email ?? '').toLowerCase();
    return Array.from(new Set((u?.accounts ?? []).map((a) => String(a.providerAccountId || '').trim().toLowerCase()).filter((v) => v.includes('@') && v !== primary)));
}

/** Filtra las direcciones pedidas por una regla a las permitidas hoy. */
export async function allowedForwardAddresses(userId: string, wanted: string[]): Promise<string[]> {
    if (!forwardingEnabled() || wanted.length === 0) return [];
    const ok = new Set(await verifiedForwardTargets(userId));
    return wanted.map((w) => w.toLowerCase()).filter((w) => ok.has(w));
}

export interface ForwardSource {
    userId: string;
    userEmail: string;
    from: string;
    subject: string;
    text: string;
    html: string;
    hdrs: Record<string, string>;
}

/** Reenvia una copia. `send` es inyectable (pruebas); por defecto usa Resend. Devuelve las direcciones a las que se envio. */
export async function runForwards(
    src: ForwardSource,
    addresses: string[],
    send?: (payload: { from: string; to: string; subject: string; text?: string; html?: string; headers: Record<string, string> }) => Promise<void>,
): Promise<string[]> {
    const targets = await allowedForwardAddresses(src.userId, addresses);
    if (targets.length === 0) return [];
    const auto = (src.hdrs['auto-submitted'] || '').toLowerCase();
    if ((auto && auto !== 'no') || src.hdrs['x-bloomx-forwarded'] || /^\s*(fwd?):/i.test(src.subject)) return [];
    const { rateLimitAsync } = await import('@/lib/security');
    const sender = send ?? (async (payload) => {
        const { resend } = await import('@/lib/resend');
        await resend.emails.send(payload as any);
    });
    const sent: string[] = [];
    for (const to of targets) {
        const rl = await rateLimitAsync(`rule-forward:${src.userId}`, FORWARD_HOURLY_LIMIT, 3_600_000);
        if (!rl.ok) break;
        try {
            await sender({
                from: src.userEmail,
                to,
                subject: `Fwd: ${src.subject}`.slice(0, 300),
                ...(src.html ? { html: src.html } : { text: src.text }),
                headers: { 'Auto-Submitted': 'auto-forwarded', 'X-Bloomx-Forwarded': '1' },
            });
            sent.push(to);
        } catch (e) {
            console.error('[rules] forward failed:', (e as any)?.message);
        }
    }
    return sent;
}
