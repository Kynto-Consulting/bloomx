import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';

type ContactSuggestion = {
    email: string;
    name?: string;
};

function parseAddress(value: string) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return null;
    }

    const match = normalized.match(/^(.*?)<([^>]+)>$/);
    if (match) {
        const name = match[1].trim().replace(/^"|"$/g, '');
        const email = match[2].trim().toLowerCase();
        return email ? { email, name: name || undefined } : null;
    }

    return normalized.includes('@')
        ? { email: normalized.toLowerCase() }
        : null;
}

function collectAddresses(value: string | null | undefined) {
    return String(value || '')
        .split(',')
        .map((part) => parseAddress(part))
        .filter(Boolean) as ContactSuggestion[];
}

export async function GET(req: NextRequest) {
    const user = await getCurrentUser();
    if (!user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const query = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() || '';
    if (query.length < 1) {
        return NextResponse.json([]);
    }

    const contacts = await prisma.contact.findMany({
        where: {
            userId: user.id,
            OR: [
                { email: { contains: query, mode: 'insensitive' } },
                { name: { contains: query, mode: 'insensitive' } },
            ]
        },
        orderBy: [
            { name: 'asc' },
            { email: 'asc' }
        ],
        take: 8,
    });

    const emails = await prisma.email.findMany({
        where: { userId: user.id },
        select: {
            from: true,
            to: true,
            createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 250,
    });

    const uniqueSuggestions = new Map<string, ContactSuggestion>();

    for (const contact of contacts) {
        uniqueSuggestions.set(contact.email, {
            email: contact.email,
            name: contact.name || undefined,
        });
    }

    for (const email of emails) {
        for (const candidate of [...collectAddresses(email.from), ...collectAddresses(email.to)]) {
            if (!candidate.email || uniqueSuggestions.has(candidate.email)) {
                continue;
            }

            const haystack = `${candidate.name || ''} ${candidate.email}`.toLowerCase();
            if (!haystack.includes(query)) {
                continue;
            }

            uniqueSuggestions.set(candidate.email, candidate);
        }
    }

    return NextResponse.json(Array.from(uniqueSuggestions.values()).slice(0, 8));
}