import { NextResponse } from 'next/server';
import { verifyManagerSession } from '@/lib/manager-auth';

export async function POST(req: Request) {
    const manager = await verifyManagerSession(req as any);
    if (!manager) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev';
        const cookieStore = req.headers.get('cookie') || '';

        const response = await fetch(`${backendUrl}/api/manager/extensions/install`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookieStore,
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        console.error('[ADMIN_EXTENSION_INSTALL_PROXY]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}