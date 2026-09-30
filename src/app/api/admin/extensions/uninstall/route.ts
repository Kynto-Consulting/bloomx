import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

export async function POST(req: Request) {
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    try {
        const body = await req.json();
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev';
        const cookieStore = req.headers.get('cookie') || '';

        const response = await fetch(`${backendUrl}/api/manager/extensions/uninstall`, {
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
        console.error('[ADMIN_EXTENSION_UNINSTALL_PROXY]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}