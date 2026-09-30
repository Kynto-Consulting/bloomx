// Presentacion de la cuota de buzon (pura y segura para el cliente: sin acceso a BD). El calculo esta en lib/mail-quota.ts.

export type QuotaLevelView = 'unlimited' | 'ok' | 'warning' | 'critical' | 'exceeded';

/** Respuesta de GET /api/quota. */
export interface QuotaView {
    usedBytes: number;
    limitBytes: number | null;
    percent: number | null;
    level: QuotaLevelView;
    /** El uso supera el 90 %. */
    notice: boolean;
    /** El dominio bloquea el envio al llegar al 100 %. */
    enforce: boolean;
    approximate?: boolean;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 1536 -> "1,5 KB" segun el idioma. */
export function formatStorage(bytes: number, locale = 'es'): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i++; }
    const digits = i === 0 || v >= 100 ? 0 : v >= 10 ? 1 : 2;
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v)} ${UNITS[i]}`;
}

/** Clase de token del relleno de la barra: exito -> aviso (80 %) -> destructivo (95 %). */
export function quotaFillClass(level: QuotaLevelView): string {
    if (level === 'critical' || level === 'exceeded') return 'bg-destructive';
    if (level === 'warning') return 'bg-warning';
    return 'bg-success';
}

/** Clase de token del texto de aviso. */
export function quotaTextClass(level: QuotaLevelView): string {
    if (level === 'critical' || level === 'exceeded') return 'text-destructive';
    if (level === 'warning') return 'text-warning';
    return 'text-muted-foreground';
}

/** Clave i18n del aviso que corresponde (null = sin aviso): >90 % avisa; al 100 % con bloqueo activo, lo dice claro. */
export function quotaNoticeKey(q: QuotaView): string | null {
    if (q.limitBytes === null) return null;
    if (q.level === 'exceeded') return q.enforce ? 'sidebar.quota.blocked' : 'sidebar.quota.exceeded';
    return q.notice ? 'sidebar.quota.notice' : null;
}

/** Valida la respuesta de la API (cualquier otra cosa -> null y la barra no se muestra). */
export function parseQuotaView(raw: unknown): QuotaView | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.usedBytes !== 'number' || !Number.isFinite(o.usedBytes)) return null;
    const limit = typeof o.limitBytes === 'number' && o.limitBytes > 0 ? o.limitBytes : null;
    const levels: QuotaLevelView[] = ['unlimited', 'ok', 'warning', 'critical', 'exceeded'];
    const level = levels.includes(o.level as QuotaLevelView) ? (o.level as QuotaLevelView) : 'unlimited';
    return {
        usedBytes: Math.max(0, o.usedBytes),
        limitBytes: limit,
        percent: limit && typeof o.percent === 'number' ? o.percent : null,
        level: limit ? level : 'unlimited',
        notice: limit !== null && o.notice === true,
        enforce: o.enforce === true,
        approximate: o.approximate !== false,
    };
}
