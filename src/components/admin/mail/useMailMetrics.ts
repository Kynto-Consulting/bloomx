'use client';

import { useAdminQuery } from '@/components/admin/console';
import type { MailMetrics, MailRange } from './types';

/** Metricas agregadas del rango (SWR: el Resumen y las Cuotas comparten la misma peticion). */
export function useMailMetrics(range: MailRange) {
    return useAdminQuery<MailMetrics>(`/api/admin/mail/metrics?range=${range}`);
}
