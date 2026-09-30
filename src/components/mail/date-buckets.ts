import type { DateBucket } from '@/lib/mail-list-view';

/** Clave i18n del encabezado de cada cubeta de fecha (literales: las comprueba el test de paridad es/en). */
export const DATE_BUCKET_KEYS: Record<DateBucket, string> = {
    upcoming: 'emailList.dates.upcoming',
    today: 'emailList.dates.today',
    yesterday: 'emailList.dates.yesterday',
    thisWeek: 'emailList.dates.thisWeek',
    thisMonth: 'emailList.dates.thisMonth',
    older: 'emailList.dates.older',
};
