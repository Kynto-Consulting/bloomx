import { getUserState } from '@/lib/admin/user-state';
import { getExternalClients } from '@/lib/external-auth';
import type { FlowDeps } from '@/lib/external-auth-flow';
import { getCodeStore } from '@/lib/external-auth-store';
import { prisma } from '@/lib/prisma';
import { auditLog, rateLimitAsync } from '@/lib/security';

export function defaultFlowDeps(): FlowDeps {
    return {
        clients: getExternalClients(),
        store: getCodeStore(),
        async getUser(userId) {
            const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } });
            return u && u.email ? { id: u.id, email: u.email, name: u.name ?? null } : null;
        },
        async isDisabled(userId) {
            return (await getUserState(userId)).disabled;
        },
        rateLimit: (key, limit, windowMs) => rateLimitAsync(key, limit, windowMs),
        audit: (event, data) => auditLog(event, data),
    };
}
