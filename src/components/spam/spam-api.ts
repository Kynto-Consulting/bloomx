/** Llamadas del navegador a los endpoints de USUARIO de spam (mismo origen, JSON, sin cache). Devuelven { ok, data } sin lanzar. */
export interface ApiResult<T = any> { ok: boolean; status: number; data: T | null }

export async function spamFetch<T = any>(url: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
    try {
        const res = await fetch(url, {
            method: init?.method ?? 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            ...(init?.body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
        });
        let data: T | null = null;
        try { data = (await res.json()) as T; } catch { data = null; }
        return { ok: res.ok, status: res.status, data };
    } catch {
        return { ok: false, status: 0, data: null };
    }
}

export const trustExternal = (entry: { matchType: 'email' | 'domain'; value: string }) =>
    spamFetch('/api/spam/lists/external', { method: 'POST', body: { entries: [entry] } });

export const blockSender = (emailId: string, target: 'sender' | 'domain', moveToSpam?: boolean) =>
    spamFetch<{ ok: boolean; value?: string }>('/api/spam/block', { method: 'POST', body: { emailId, target, ...(moveToSpam === undefined ? {} : { moveToSpam }) } });

/** Abre Ajustes -> Spam (el evento lo escucha la barra lateral, que abre el modal en esa pestana). */
export const OPEN_SPAM_SETTINGS = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('bloomx:open-settings', { detail: { tab: 'spam' } }));
};
