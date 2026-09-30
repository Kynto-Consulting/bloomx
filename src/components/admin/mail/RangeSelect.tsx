'use client';

import { FilterSelect } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import { RANGE_OPTIONS, type MailRange } from './types';

const KEY: Record<MailRange, string> = { '24h': 'h24', '7d': 'd7', '30d': 'd30' };

export function RangeSelect({ value, onChange }: { value: MailRange; onChange: (r: MailRange) => void }) {
    const { t } = useI18n();
    return (
        <FilterSelect
            label={t('admin.console.mail.range.label')}
            value={value}
            onChange={(v) => onChange(v as MailRange)}
            options={RANGE_OPTIONS.map((r) => ({ value: r, label: t(`admin.console.mail.range.${KEY[r]}`) }))}
        />
    );
}
