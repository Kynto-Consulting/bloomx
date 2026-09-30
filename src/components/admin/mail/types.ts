// Tipos de las respuestas de /api/admin/mail/* (solo `import type`: no arrastra codigo de servidor al cliente).
import type { MailMetrics, MailRange, SuppressionRow, WebhookStatus } from '@/lib/admin/mail-store';
import type { DnsHealth, DnsStatus } from '@/lib/admin/dns-health';

export type { MailMetrics, MailRange, SuppressionRow, WebhookStatus, DnsHealth, DnsStatus };

export interface SuppressionPage {
    items: SuppressionRow[];
    page: number;
    pageSize: number;
    total: number;
    pages: number;
}

export const RANGE_OPTIONS: MailRange[] = ['24h', '7d', '30d'];
