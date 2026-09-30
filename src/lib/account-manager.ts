export interface StoredAccount {
    id: string;
    email: string;
    name: string;
    avatar?: string;
    token: string;
}

function normalizeEmail(value: string) {
    return String(value || '').trim().toLowerCase();
}

const STORAGE_KEY = 'bloomx_accounts';
const ACTIVE_ACCOUNT_KEY = 'bloomx_active_account_id';
const LAST_REFRESH_KEY = 'bloomx_accounts_refreshed_at';
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

/**
 * SEGURIDAD (ASVS 3.x, NIST SC-28 / AC-12): esta boveda guarda los JWT de cada cuenta en localStorage porque la UI
 * multicuenta los envia como `Authorization: Bearer` (EmailList/ComposeModal), y localStorage es legible por cualquier XSS.
 * Mitigaciones aplicadas SIN cambiar la API publica:
 *   - los tokens ya no viven 30 dias: caducan por inactividad (SESSION_TTL_SECONDS) y con tope absoluto;
 *   - se renuevan de forma deslizante con /api/auth/refresh mientras la cuenta se usa (refreshAll);
 *   - se descartan los caducados, y al olvidar una cuenta el token se REVOCA en servidor (jti);
 *   - logout / cambio de contrasena / MFA los invalidan todos (User.tokenVersion).
 * Alternativa robusta (mas invasiva, NO aplicada): boveda HttpOnly en servidor + cabecera `X-Bloomx-Account: <id>` en lugar de
 * Bearer; requiere tocar EmailList, ComposeModal, Sidebar y OfflineContext. Ver informe (pendientes).
 */

/** Decodifica el payload de un JWT SIN verificarlo (solo para leer exp/iat en el cliente). */
export function decodeJwtPayload(token: string): { exp?: number; iat?: number; jti?: string } | null {
    try {
        const part = token.split('.')[1];
        if (!part) return null;
        const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
        const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8');
        return JSON.parse(json);
    } catch {
        return null;
    }
}

export function isTokenExpired(token: string, nowMs: number = Date.now()): boolean {
    const p = decodeJwtPayload(token);
    return !!p?.exp && p.exp * 1000 <= nowMs;
}

function readRaw(): StoredAccount[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

let refreshScheduled = false;
let storageListenerInstalled = false;

function installStorageListener() {
    if (storageListenerInstalled || typeof window === 'undefined') return;
    storageListenerInstalled = true;
    // Sincroniza pestanas: un cambio de boveda/activa en otra pestana notifica a los componentes de esta
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY || e.key === ACTIVE_ACCOUNT_KEY) window.dispatchEvent(new Event('account-change'));
    });
}

function scheduleRefresh() {
    if (refreshScheduled || typeof window === 'undefined') return;
    let last = 0;
    try { last = Number(localStorage.getItem(LAST_REFRESH_KEY) || 0); } catch { /* ignore */ }
    if (Date.now() - last < REFRESH_INTERVAL_MS) return;
    refreshScheduled = true;
    setTimeout(() => { void AccountManager.refreshAll().finally(() => { refreshScheduled = false; }); }, 0);
}

export const AccountManager = {
    getAccounts: (): StoredAccount[] => {
        if (typeof window === 'undefined') return [];
        installStorageListener();
        const all = readRaw();
        // Las cuentas con token caducado no sirven (ni para Bearer ni para set-cookie): se ocultan y se purgan
        const valid = all.filter((a) => a?.token && !isTokenExpired(a.token));
        if (valid.length !== all.length) {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(valid)); } catch { /* ignore */ }
        }
        scheduleRefresh();
        return valid;
    },

    addAccount: (account: StoredAccount) => {
        const accounts = AccountManager.getAccounts();
        // Remove existing if present (update)
        const filtered = accounts.filter(a => a.id !== account.id);
        filtered.push(account);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        AccountManager.setActive(account.id);
    },

    removeAccount: (accountId: string) => {
        const accounts = AccountManager.getAccounts();
        const removed = accounts.find(a => a.id === accountId);
        const filtered = accounts.filter(a => a.id !== accountId);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));

        // Revoca el JWT en servidor (best-effort): un token copiado por un XSS deja de servir
        if (removed?.token && typeof fetch === 'function') {
            void fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: removed.token }),
                keepalive: true,
            }).catch(() => undefined);
        }

        // If removed active account, switch to another or clear
        const activeId = AccountManager.getActiveId();
        if (activeId === accountId) {
            if (filtered.length > 0) {
                AccountManager.setActive(filtered[0].id);
            } else {
                localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
            }
        }
    },

    /** Reemplaza el token de una cuenta (renovacion / cambio de contrasena) sin cambiar la cuenta activa. */
    updateToken: (accountId: string, token: string) => {
        const accounts = readRaw().map(a => (a.id === accountId ? { ...a, token } : a));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
        window.dispatchEvent(new Event('account-change'));
    },

    /**
     * Renovacion deslizante de los tokens de la boveda (POST /api/auth/refresh). Descarta las cuentas cuyo token el
     * servidor ya no acepta (revocado/caducado). Se invoca sola, como mucho una vez cada 30 min por navegador.
     */
    refreshAll: async (): Promise<void> => {
        if (typeof window === 'undefined') return;
        try { localStorage.setItem(LAST_REFRESH_KEY, String(Date.now())); } catch { /* ignore */ }
        const accounts = readRaw();
        let changed = false;
        const next: StoredAccount[] = [];
        for (const acc of accounts) {
            if (!acc?.token || isTokenExpired(acc.token)) { changed = true; continue; }
            try {
                const res = await fetch('/api/auth/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: acc.token }),
                });
                if (res.status === 401) { changed = true; continue; } // revocado o no valido
                if (res.ok) {
                    const data = await res.json();
                    if (data?.renewed && typeof data.token === 'string') {
                        next.push({ ...acc, token: data.token });
                        changed = true;
                        continue;
                    }
                }
            } catch { /* sin red: se conserva */ }
            next.push(acc);
        }
        if (changed) {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            window.dispatchEvent(new Event('account-change'));
        }
    },

    setActive: (accountId: string) => {
        localStorage.setItem(ACTIVE_ACCOUNT_KEY, accountId);
        // Force reload to apply changes if we rely on global state or reload
        // Or dispatch event
        window.dispatchEvent(new Event('account-change'));
    },

    getActiveId: (): string | null => {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem(ACTIVE_ACCOUNT_KEY);
    },

    getActiveToken: (): string | null => {
        const activeId = AccountManager.getActiveId();
        if (!activeId) return null;
        const accounts = AccountManager.getAccounts();
        const account = accounts.find(a => a.id === activeId);
        return account ? account.token : null;
    },

    getActiveAccount: (): StoredAccount | null => {
        const activeId = AccountManager.getActiveId();
        if (!activeId) return null;
        const accounts = AccountManager.getAccounts();
        return accounts.find(a => a.id === activeId) || null;
    },

    getAccountByEmail: (email: string): StoredAccount | null => {
        const normalized = normalizeEmail(email);
        if (!normalized) return null;

        const accounts = AccountManager.getAccounts();
        return accounts.find((account) => normalizeEmail(account.email) === normalized) || null;
    },

    getTokenForEmail: (email: string): string | null => {
        const account = AccountManager.getAccountByEmail(email);
        return account?.token || null;
    }
};
