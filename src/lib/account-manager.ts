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

export const AccountManager = {
    getAccounts: (): StoredAccount[] => {
        if (typeof window === 'undefined') return [];
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
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
        const filtered = accounts.filter(a => a.id !== accountId);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));

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
