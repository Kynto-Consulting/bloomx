import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from "@/lib/session";
import { prisma } from '@/lib/prisma';
import {
    ConnectionLimiter,
    DEFAULT_POLL_BACKOFF,
    formatSseEvent,
    nextPollDelay,
    parseResumeCursor,
} from '@/lib/realtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Cada conexion vive poco (ver MAX_LIFETIME_MS) y el navegador reconecta solo con Last-Event-ID.
export const maxDuration = 60;

/** Duracion maxima de una conexion: menos que maxDuration para cerrar limpio antes de que la plataforma la corte. */
const MAX_LIFETIME_MS = 50_000;
const HEARTBEAT_MS = 20_000;
/** Tras un cierre limpio el cliente espera esto antes de reconectar (campo `retry` de SSE). */
const CLIENT_RETRY_MS = 2_000;
const MAX_CONNECTIONS_PER_USER = 3;

// Best-effort por instancia (en serverless cada instancia lleva su propia cuenta).
const limiter = new ConnectionLimiter(MAX_CONNECTIONS_PER_USER);

export async function GET(req: NextRequest) {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // getCurrentUser ya resolvio al usuario por id: no hace falta una segunda consulta.
    const userId = currentUser.id;

    if (!limiter.tryAcquire(userId)) {
        return NextResponse.json(
            { error: 'Too many realtime connections' },
            { status: 429, headers: { 'Retry-After': '30' } },
        );
    }

    // Cursor de reanudacion: Last-Event-ID (reconexion automatica del navegador) o ?lastEventId= (reconexion manual).
    const resumeFrom = parseResumeCursor(
        req.headers.get('last-event-id') || req.nextUrl.searchParams.get('lastEventId'),
    );

    const encoder = new TextEncoder();
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let lifetime: ReturnType<typeof setTimeout> | null = null;

    const stream = new ReadableStream({
        async start(controller) {
            const cleanup = () => {
                if (closed) return;
                closed = true;
                if (timer) clearTimeout(timer);
                if (heartbeat) clearInterval(heartbeat);
                if (lifetime) clearTimeout(lifetime);
                limiter.release(userId);
                try {
                    controller.close();
                } catch {
                    // Ya cerrado por el cliente.
                }
            };

            const send = (chunk: string) => {
                if (closed) return;
                try {
                    controller.enqueue(encoder.encode(chunk));
                } catch {
                    cleanup();
                }
            };

            req.signal.addEventListener('abort', cleanup);

            // Cursor = createdAt del ultimo correo visto (reloj de la BD, no del servidor).
            let cursor: Date;
            try {
                if (resumeFrom) {
                    cursor = resumeFrom;
                } else {
                    const latest = await prisma.email.findFirst({
                        where: { userId, folder: 'inbox' },
                        orderBy: { createdAt: 'desc' },
                        select: { createdAt: true },
                    });
                    cursor = latest?.createdAt ?? new Date(0);
                }
            } catch (e) {
                console.error('SSE init error:', e);
                cleanup();
                return;
            }

            send(formatSseEvent({ retry: CLIENT_RETRY_MS, event: 'ready', data: { type: 'READY' } }));

            let delay: number = DEFAULT_POLL_BACKOFF.minMs;

            const poll = async () => {
                if (closed) return;
                let changed = false;
                try {
                    // Una sola consulta indexada (userId, folder, createdAt): cuenta y ultimo createdAt.
                    const agg = await prisma.email.aggregate({
                        where: { userId, folder: 'inbox', createdAt: { gt: cursor } },
                        _count: { _all: true },
                        _max: { createdAt: true },
                    });
                    const count = agg._count._all;
                    const newest = agg._max.createdAt;
                    if (count > 0 && newest) {
                        changed = true;
                        cursor = newest;
                        send(formatSseEvent({ id: newest.toISOString(), data: { type: 'NEWMESSAGE', count } }));
                    }
                } catch (e) {
                    console.error('SSE poll error:', e);
                }
                delay = nextPollDelay(delay, changed);
                if (!closed) timer = setTimeout(poll, delay);
            };

            timer = setTimeout(poll, delay);

            // Comentario SSE: mantiene viva la conexion a traves de proxies sin disparar onmessage.
            heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);

            // Cierre programado (por inactividad o fin de vida): el cliente reconecta con Last-Event-ID.
            lifetime = setTimeout(cleanup, MAX_LIFETIME_MS);
        },
        cancel() {
            if (closed) return;
            closed = true;
            if (timer) clearTimeout(timer);
            if (heartbeat) clearInterval(heartbeat);
            if (lifetime) clearTimeout(lifetime);
            limiter.release(userId);
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}
