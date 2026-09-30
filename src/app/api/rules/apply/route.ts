import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { applyRulesToEmails, loadRules } from '@/lib/rules/store';

const APPLY_LIMIT = 500;

/** Aplica las reglas activas a los ultimos correos de bandeja/archivo del usuario. Idempotente. */
export async function POST() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rules = await loadRules(user.id, true);
    if (rules.length === 0) return NextResponse.json({ processed: 0, changed: 0 });

    const emails = await prisma.email.findMany({
        where: { userId: user.id, folder: { in: ['inbox', 'archive'] } },
        orderBy: { createdAt: 'desc' },
        take: APPLY_LIMIT,
        select: {
            id: true, from: true, to: true, subject: true, snippet: true, folder: true, read: true, starred: true,
            labels: { select: { id: true, name: true } },
            _count: { select: { attachments: true } },
        },
    });
    const result = await applyRulesToEmails(user.id, rules, emails.map((e) => ({ ...e, _attachments: e._count.attachments })));
    return NextResponse.json(result);
}
