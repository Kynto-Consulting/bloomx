'use client';

import { useEffect } from 'react';

const INTERVAL_MS = 5 * 60 * 1000;
// Espera tras un fallo (red caida, 5xx): evita martillar el servidor cada vez que la pestana vuelve al frente.
const FAILURE_COOLDOWN_MS = 60 * 1000;

/**
 * Dispara /api/cron/run desde el navegador (recordatorios push). Es un respaldo: el cron fiable debe
 * ser de servidor (Vercel Cron); esto solo corre con una pestana abierta.
 * - Solo con la pestana visible y con conexion (una pestana oculta no necesita sondear).
 * - Nunca solapa dos ejecuciones.
 * - Al volver a la pestana ejecuta si ya paso el intervalo.
 */
export function CronTrigger() {
    useEffect(() => {
        let inFlight = false;
        let lastAttemptAt = 0;
        let lastFailed = false;

        const runCron = async () => {
            if (inFlight) return;
            if (document.visibilityState !== 'visible' || !navigator.onLine) return;
            const elapsed = Date.now() - lastAttemptAt;
            if (elapsed < (lastFailed ? FAILURE_COOLDOWN_MS : INTERVAL_MS - 1000)) return;

            inFlight = true;
            lastAttemptAt = Date.now();
            try {
                const res = await fetch('/api/cron/run', { method: 'POST' });
                lastFailed = !res.ok;
            } catch {
                lastFailed = true;
            } finally {
                inFlight = false;
            }
        };

        // Run immediately on load
        void runCron();

        const interval = setInterval(() => void runCron(), INTERVAL_MS);
        const onVisible = () => {
            if (document.visibilityState === 'visible') void runCron();
        };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', onVisible);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', onVisible);
        };
    }, []);

    return null; // Invisible
}
