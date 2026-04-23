import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from "@/lib/session";

import { encryptObject, decryptObject } from '@/lib/encryption';

export async function GET(req: NextRequest) {
    const currentUser = await getCurrentUser();
    if (!currentUser?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email: currentUser.email },
            select: { id: true, signature: true, expansionSettings: true }
        });

        let isGoogleLinked = false;
        if (user) {
            // @ts-ignore
            const count = await prisma.account.count({
                where: {
                    userId: user.id,
                    provider: 'google'
                }
            });
            isGoogleLinked = count > 0;
        }

        const rawSettings = user?.expansionSettings || {};
        const decryptedSettings = decryptObject(rawSettings);

        const isGoogleMeetAvailable = isGoogleLinked || Boolean(process.env.GOOGLE_MEET_ADMIN_REFRESH_TOKEN);

        return NextResponse.json({
            signature: user?.signature || '',
            expansionSettings: decryptedSettings,
            isGoogleLinked,
            isGoogleMeetAvailable,
        });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const currentUser = await getCurrentUser();
    if (!currentUser?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { signature, expansionSettings } = body;

        const data: any = {};
        if (signature !== undefined) data.signature = signature;
        if (expansionSettings !== undefined) {
            // Encrypt settings before saving
            // We need to fetch existing to merge? Or just overwrite?
            // Usually settings updates are partial or full?
            // The frontend usually sends the full object for a specific key (e.g. core-notion).
            // But here we are updating the entire `expansionSettings` field or merging?
            // Prisma JSON updates: if we pass a new object, it replaces.
            // But if the frontend only sends { "core-notion": ... }, we might lose others if we don't merge.
            // Let's assume the frontend sends the *Partial* update or user logic handles it?
            // Looking at the SettingsModal or similar logic might verify. 
            // `SettingsModal.tsx` calls `updateSettings({ expansionSettings: { ...settings, [activeTab]: data } })`. 
            // It spreads existing settings. So it sends the FULL object. Good.

            data.expansionSettings = encryptObject(expansionSettings);
        }

        await prisma.user.update({
            where: { email: currentUser.email },
            data
        });

        return NextResponse.json({ success: true, ...data });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }
}
