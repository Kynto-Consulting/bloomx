'use client';

import * as React from 'react';
import { adminFetch } from '@/components/admin/console/api';
import { TERMINAL, type JobPublic } from './api';

/**
 * Sondeo de un trabajo (1,5 s). Si el trabajo sigue "vivo" pero nadie lo procesa (bloqueo caducado o sin cambios desde hace
 * `stallMs`), EMPUJA un tick desde el navegador (POST /jobs/:id/tick), igual que el worker de Elixir cuando se atasca el cron.
 */
export function useJob(base: string, jobId: string | null, opts: { intervalMs?: number; stallMs?: number; onStalled?: () => void } = {}) {
    const interval = opts.intervalMs ?? 1500;
    const stallMs = opts.stallMs ?? 15_000;
    const [job, setJob] = React.useState<JobPublic | null>(null);
    const [error, setError] = React.useState<unknown>(null);
    const pushing = React.useRef(false);
    const onStalled = React.useRef(opts.onStalled);
    onStalled.current = opts.onStalled;

    const refresh = React.useCallback(async (): Promise<JobPublic | null> => {
        if (!jobId) return null;
        try {
            const r = await adminFetch<{ job: JobPublic }>(`${base}/jobs/${jobId}`);
            setJob(r.job);
            setError(null);
            return r.job;
        } catch (e) {
            setError(e);
            return null;
        }
    }, [base, jobId]);

    React.useEffect(() => {
        setJob(null);
        setError(null);
        if (!jobId) return;
        let stop = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const loop = async () => {
            const j = await refresh();
            if (stop) return;
            if (j && !TERMINAL.includes(j.status) && ['analyzing', 'queued', 'running'].includes(j.status)) {
                const idle = Date.now() - new Date(j.updatedAt ?? Date.now()).getTime();
                if ((j.stale || idle > stallMs) && !pushing.current) {
                    pushing.current = true;
                    onStalled.current?.();
                    try {
                        const r = await adminFetch<{ job: JobPublic }>(`${base}/jobs/${jobId}/tick`, { method: 'POST' });
                        if (!stop) setJob(r.job);
                    } catch { /* se reintenta en el siguiente ciclo */ } finally {
                        pushing.current = false;
                    }
                }
            }
            if (j && TERMINAL.includes(j.status)) return;
            if (!stop) timer = setTimeout(loop, interval);
        };
        void loop();
        return () => { stop = true; if (timer) clearTimeout(timer); };
    }, [base, jobId, interval, stallMs, refresh]);

    return { job, error, refresh };
}
