'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LabelRow } from '@/lib/labels/model';
import type { ForwardInfo } from './ActionsEditor';

/** Datos auxiliares de los editores: etiquetas (con jerarquia), contactos para autocompletar y si se permite reenviar. */
export function useRuleData() {
    const [labels, setLabels] = useState<LabelRow[]>([]);
    const [contacts, setContacts] = useState<string[]>([]);
    const [forward, setForward] = useState<ForwardInfo>({ enabled: false, targets: [] });
    const [loading, setLoading] = useState(true);

    const reloadLabels = useCallback(async () => {
        try {
            const res = await fetch('/api/labels', { cache: 'no-store' });
            if (res.ok) {
                const list = await res.json();
                if (Array.isArray(list)) setLabels(list as LabelRow[]);
            }
        } catch { /* sin red */ }
    }, []);

    useEffect(() => {
        let alive = true;
        (async () => {
            await reloadLabels();
            try {
                const [c, f] = await Promise.all([fetch('/api/contacts?limit=200'), fetch('/api/rules/forward-targets')]);
                if (alive && c.ok) {
                    const list = await c.json();
                    if (Array.isArray(list)) setContacts(list.map((x: any) => x?.email).filter((e: unknown): e is string => typeof e === 'string'));
                }
                if (alive && f.ok) setForward(await f.json());
            } catch { /* opcional */ }
            if (alive) setLoading(false);
        })();
        return () => { alive = false; };
    }, [reloadLabels]);

    return { labels, contacts, forward, loading, reloadLabels };
}
