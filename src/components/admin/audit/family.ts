import type { Tone } from '@/components/admin/console';

export type AuditFamily = 'auth' | 'admin' | 'extension' | 'mail' | 'retention' | 'other';

/** Familia de un evento por su primer segmento (auth.login.failure -> auth). */
export function auditFamily(event: string): AuditFamily {
    const head = event.split('.')[0]?.toLowerCase() ?? '';
    if (head === 'auth') return 'auth';
    if (head === 'admin') return 'admin';
    if (head === 'extension' || head === 'extensions') return 'extension';
    if (head === 'mail' || head === 'email' || head === 'attachment') return 'mail';
    if (head === 'retention') return 'retention';
    return 'other';
}

export const FAMILY_TONE: Record<AuditFamily, Tone> = {
    auth: 'info',
    admin: 'warning',
    extension: 'neutral',
    mail: 'success',
    retention: 'neutral',
    other: 'neutral',
};

/** Prefijos de familia ofrecidos como filtro rapido. */
export const FAMILY_PREFIXES = ['auth.*', 'admin.*', 'extension.*', 'mail.*', 'retention.*'] as const;

export const EVENT_FILTER_RE = /^[a-z0-9_.*-]{1,80}$/;
