'use client';

import { useEffect, useRef } from 'react';
import { useCache } from '@/contexts/CacheContext';
import { toast } from 'sonner';
import { usePathname } from 'next/navigation';
import { useSession } from '@/components/SessionProvider';
import { EMAIL_LISTS_AND_COUNTS_PATTERN } from '@/lib/mail-list';

const MAX_BACKOFF_MS = 60_000;

export function RealTimeListener() {
    const { status } = useSession();
    const { invalidate } = useCache();
    const pathname = usePathname();

    // Refs para que el efecto de conexion NO dependa de pathname/invalidate:
    // reconectar en cada navegacion era innecesario.
    const invalidateRef = useRef(invalidate);
    invalidateRef.current = invalidate;
    const onLoginRef = useRef(pathname === '/login');
    onLoginRef.current = pathname === '/login';

    useEffect(() => {
        if (status !== 'authenticated') return;

        let eventSource: EventSource | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let attempts = 0;
        let disposed = false;
        // Ultimo id de evento recibido: en una reconexion manual (el navegador ya no la hace sola)
        // se envia como ?lastEventId= para que el servidor reponga lo perdido.
        let lastEventId = '';

        // Un solo aviso: invalida todas las listas (`emails:<sig>:<ctx>`) y los contadores.
        // EmailList y Sidebar estan suscritos y se refrescan solos, sin recargar la pagina.
        const refreshMail = () => {
            void invalidateRef.current(EMAIL_LISTS_AND_COUNTS_PATTERN);
        };

        const connect = () => {
            if (disposed) return;
            if (onLoginRef.current) {
                retryTimer = setTimeout(connect, 2000);
                return;
            }

            const es = new EventSource(lastEventId ? `/api/sse?lastEventId=${encodeURIComponent(lastEventId)}` : '/api/sse');
            eventSource = es;

            es.onopen = () => {
                // Tras un corte, refrescar por si llegaron correos mientras no habia canal.
                if (attempts > 0) refreshMail();
                attempts = 0;
            };

            es.onmessage = (event) => {
                if (event.lastEventId) lastEventId = event.lastEventId;
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'NEWMESSAGE') {
                        toast.info('New message received!');
                        refreshMail();
                    }
                } catch (e) {
                    console.error('SSE Parse Error', e);
                }
            };

            es.onerror = () => {
                // Si el navegador ya esta reconectando (CONNECTING) lo dejamos.
                // Solo si la conexion quedo CLOSED reconectamos nosotros con backoff exponencial.
                if (es.readyState !== EventSource.CLOSED) return;
                es.close();
                if (disposed) return;
                attempts += 1;
                const delay = Math.min(1000 * 2 ** Math.min(attempts, 6), MAX_BACKOFF_MS);
                retryTimer = setTimeout(connect, delay);
            };
        };

        // Pequeno retraso para no competir con la redireccion de login.
        retryTimer = setTimeout(connect, 1000);

        // Al volver a la pestana se refresca por si hubo correos mientras estaba oculta.
        const onVisible = () => {
            if (document.visibilityState === 'visible') refreshMail();
        };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            disposed = true;
            if (retryTimer) clearTimeout(retryTimer);
            eventSource?.close();
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [status]);

    return null;
}
