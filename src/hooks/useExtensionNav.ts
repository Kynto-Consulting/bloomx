'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/components/SessionProvider';
import { useI18n } from '@/components/I18nProvider';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useExtensionPrefs } from '@/hooks/useExtensionPrefs';
import { isMandatoryExtension } from '@/lib/expansions/client/prefs';
import { collectNavItems, parseBadgeValue, type NavItemView } from '@/lib/expansions/nav-entries';
import type { NavSection } from '@/lib/expansions/nav-schema';

export interface UseExtensionNavOptions {
    section?: NavSection;
    /** Menu movil: solo entradas con `mobile !== false`. */
    mobileOnly?: boolean;
    /** Nivel de administrador ya conocido (la consola lo trae de /api/admin/me); por defecto el que envia /api/config. */
    level?: number | null;
    /** Sin sesion de usuario de la app pero con sesion de administrador (consola). */
    signedIn?: boolean;
}

/**
 * Entradas de navegacion de las extensiones para el usuario actual (ver lib/expansions/nav-entries.ts). Respeta las preferencias del usuario
 * (extensiones desactivadas), las pausas (IA, dependencias) y el nivel de administrador.
 */
export function useExtensionNav(options: UseExtensionNavOptions = {}): NavItemView[] {
    const { allExtensions, viewerLevel } = useDomainConfig();
    const { isEnabled } = useExtensionPrefs();
    const { status } = useSession();
    const { locale, t } = useI18n();
    const level = options.level !== undefined ? options.level : viewerLevel;
    const signedIn = options.signedIn ?? status === 'authenticated';
    const { section, mobileOnly } = options;
    const aiText = t('extensionState.nav.pausedAi');
    const depText = t('extensionState.nav.pausedDependency');
    return useMemo(
        () => collectNavItems(allExtensions, {
            who: { signedIn, level }, lang: locale, isEnabled, isMandatory: isMandatoryExtension, section, mobileOnly,
            reasons: { ai: aiText, dependency: depText },
        }),
        [allExtensions, signedIn, level, locale, isEnabled, section, mobileOnly, aiText, depText],
    );
}

const BADGE_TIMEOUT_MS = 8000;
/** Fallos seguidos tras los que una insignia deja de consultarse hasta recargar (evita martillear una ruta rota). */
const BADGE_MAX_FAILURES = 3;

/** Maximo de refrescos de insignias en vuelo a la vez por pestana; el resto espera en cola (evita rafagas contra /api/ext). */
export const BADGE_MAX_CONCURRENT = 4;

/** Limitador de concurrencia: ejecuta como mucho `max` tareas a la vez y encola el resto (FIFO). Una clave ya en cola o en vuelo no se duplica. */
export function createLimiter(max: number) {
    let active = 0;
    const queue: Array<{ key: string; task: () => Promise<void> }> = [];
    const queued = new Set<string>();
    const pump = () => {
        while (active < max && queue.length > 0) {
            const next = queue.shift()!;
            active += 1;
            void next.task().catch(() => undefined).finally(() => { active -= 1; queued.delete(next.key); pump(); });
        }
    };
    return {
        run(key: string, task: () => Promise<void>) {
            if (queued.has(key)) return;
            queued.add(key);
            queue.push({ key, task });
            pump();
        },
        stats: () => ({ active, waiting: queue.length }),
    };
}

// Compartido por todos los usos del hook de la pestana.
const badgeLimiter = createLimiter(BADGE_MAX_CONCURRENT);

/**
 * Valores de las insignias de `items` (clave -> numero | null). Cada una consulta `GET /api/ext/<extensionId><route>` con la sesion del usuario, cada
 * `refreshSeconds` (30 s - 1 h) y solo con la pestana visible; una respuesta invalida o un error dejan la insignia sin numero, y tras 3 fallos seguidos
 * se deja de consultar. Nunca bloquea la navegacion.
 */
export function useNavBadges(items: readonly NavItemView[]): Record<string, number | null> {
    const [values, setValues] = useState<Record<string, number | null>>({});
    const failures = useRef<Record<string, number>>({});
    // Huella estable: solo cambia si cambian las rutas a consultar (no en cada render).
    const spec = useMemo(
        () => items.filter((i) => i.badge && !i.disabled).map((i) => `${i.key}|${i.extensionId}|${i.badge!.route}|${i.badge!.refreshSeconds}`).sort().join('\n'),
        [items],
    );

    useEffect(() => {
        const jobs = spec ? spec.split('\n').map((line) => { const [key, extensionId, route, refresh] = line.split('|'); return { key, extensionId, route, refreshMs: Number(refresh) * 1000 }; }) : [];
        let alive = true;
        const timers: ReturnType<typeof setInterval>[] = [];
        const controllers = new Set<AbortController>();
        const run = async (job: (typeof jobs)[number]) => {
            if (!alive || document.visibilityState === 'hidden' || (failures.current[job.key] ?? 0) >= BADGE_MAX_FAILURES) return;
            const controller = new AbortController();
            controllers.add(controller);
            const timer = setTimeout(() => controller.abort(), BADGE_TIMEOUT_MS);
            try {
                const res = await fetch(`/api/ext/${encodeURIComponent(job.extensionId)}${job.route}`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal, headers: { Accept: 'application/json' } });
                const body = res.ok ? await res.json().catch(() => null) : null;
                const value = parseBadgeValue(body);
                if (!alive) return;
                if (value === null) { failures.current[job.key] = (failures.current[job.key] ?? 0) + 1; setValues((cur) => (cur[job.key] === null ? cur : { ...cur, [job.key]: null })); }
                else { failures.current[job.key] = 0; setValues((cur) => (cur[job.key] === value ? cur : { ...cur, [job.key]: value })); }
            } catch {
                if (alive) failures.current[job.key] = (failures.current[job.key] ?? 0) + 1;
            } finally {
                clearTimeout(timer);
                controllers.delete(controller);
            }
        };
        for (const job of jobs) {
            const enqueue = () => badgeLimiter.run(`${job.extensionId}|${job.route}|${job.key}`, () => run(job));
            enqueue();
            timers.push(setInterval(enqueue, Math.max(30_000, Math.min(3_600_000, job.refreshMs))));
        }
        return () => { alive = false; timers.forEach(clearInterval); controllers.forEach((c) => c.abort()); };
    }, [spec]);

    return values;
}
