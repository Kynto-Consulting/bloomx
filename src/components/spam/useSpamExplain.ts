'use client';

import { useEffect, useState } from 'react';

export interface SpamSignalView { id: string; weight: number; params?: Record<string, string | number> | null; es: string; en: string }

export interface SpamExplain {
    scored: boolean;
    folder?: string;
    score?: number;
    decision?: 'spam' | 'warned' | 'delivered';
    band?: string;
    threshold?: number;
    allowed?: boolean;
    external?: boolean;
    colleagueSpoof?: boolean;
    firstTime?: boolean;
    signals?: SpamSignalView[];
}

export type ExplainState = { status: 'idle' | 'loading' | 'error' } | { status: 'ready'; data: SpamExplain };

const cache = new Map<string, SpamExplain>();
const inflight = new Map<string, Promise<SpamExplain | null>>();
const MAX_CACHE = 200;

export function parseExplain(raw: unknown): SpamExplain | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, any>;
    if (o.scored !== true) return { scored: false, folder: typeof o.folder === 'string' ? o.folder : undefined, external: o.external === true };
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const signals: SpamSignalView[] = (Array.isArray(o.signals) ? o.signals : [])
        .filter((s: any) => s && typeof s.id === 'string' && typeof s.weight === 'number')
        .map((s: any) => ({ id: s.id, weight: s.weight, params: s.params ?? null, es: String(s.es ?? ''), en: String(s.en ?? '') }));
    return {
        scored: true,
        folder: typeof o.folder === 'string' ? o.folder : undefined,
        score: num(o.score),
        decision: o.decision === 'spam' || o.decision === 'warned' || o.decision === 'delivered' ? o.decision : 'delivered',
        band: typeof o.band === 'string' ? o.band : undefined,
        threshold: num(o.threshold),
        allowed: o.allowed === true,
        external: o.external === true,
        colleagueSpoof: o.colleagueSpoof === true,
        firstTime: o.firstTime === true,
        signals,
    };
}

export function loadSpamExplain(emailId: string): Promise<SpamExplain | null> {
    const hit = cache.get(emailId);
    if (hit) return Promise.resolve(hit);
    const running = inflight.get(emailId);
    if (running) return running;
    const p = (async () => {
        try {
            const res = await fetch(`/api/emails/${encodeURIComponent(emailId)}/spam`, { cache: 'no-store', credentials: 'same-origin' });
            if (!res.ok) return null;
            const data = parseExplain(await res.json());
            if (data) {
                if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
                cache.set(emailId, data);
            }
            return data;
        } catch {
            return null;
        } finally {
            inflight.delete(emailId);
        }
    })();
    inflight.set(emailId, p);
    return p;
}

/** Carga perezosa del veredicto de un correo: solo pide cuando `enabled` es true (abierto / visible). Cache compartida por id. */
export function useSpamExplain(emailId: string, enabled: boolean): ExplainState {
    const [state, setState] = useState<ExplainState>(() => {
        const hit = cache.get(emailId);
        return hit ? { status: 'ready', data: hit } : { status: 'idle' };
    });
    useEffect(() => {
        if (!enabled) return undefined;
        const hit = cache.get(emailId);
        if (hit) { setState({ status: 'ready', data: hit }); return undefined; }
        let cancelled = false;
        setState({ status: 'loading' });
        void loadSpamExplain(emailId).then((data) => {
            if (!cancelled) setState(data ? { status: 'ready', data } : { status: 'error' });
        });
        return () => { cancelled = true; };
    }, [emailId, enabled]);
    return state;
}

export function __resetSpamExplainForTests(): void { cache.clear(); inflight.clear(); }
