'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Badge, Card, ErrorState, Field, LoadingState, apiErrorKey, btnPrimary, buildQuery, formatDateTime, inputClass, useAdminQuery, type Tone } from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import type { DnsHealth, DnsStatus } from './types';

const SELECTOR_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const STATUS_TONE: Record<DnsStatus, Tone> = { ok: 'success', warn: 'warning', missing: 'danger', error: 'neutral' };
/** Notas informativas o positivas (el resto son avisos). */
const INFO_NOTES = new Set([
    'spf_hardfail', 'spf_softfail', 'spf_sender_include', 'dkim_key_present', 'dmarc_policy_reject', 'dmarc_policy_quarantine',
    'dmarc_no_rua', 'mx_single', 'mx_redundant',
]);
const GOOD_NOTES = new Set(['spf_hardfail', 'spf_sender_include', 'dkim_key_present', 'dmarc_policy_reject', 'dmarc_policy_quarantine', 'mx_redundant']);

interface CheckLike {
    status: DnsStatus;
    record: string | null;
    notes: string[];
}

function RecordCard({ kind, check, extra }: { kind: 'spf' | 'dkim' | 'dmarc' | 'mx'; check: CheckLike; extra?: React.ReactNode }) {
    const { t } = useI18n();
    const label = t(`admin.console.mail.dns.records.${kind}`);
    const noteText = (code: string) => {
        const key = `admin.console.mail.dns.notes.${code}`;
        const text = t(key);
        return text === key ? code : text;
    };
    return (
        <Card
            title={label}
            headingLevel={3}
            id={`dns-${kind}`}
            description={t(`admin.console.mail.dns.recordHelp.${kind}`)}
            actions={<Badge tone={STATUS_TONE[check.status]}>{t(`admin.console.mail.dns.status.${check.status}`)}</Badge>}
        >
            <div className="space-y-3 text-sm">
                {check.record ? (
                    <div>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">{t('admin.console.mail.dns.recordFound')}</p>
                        <code className="block whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{check.record}</code>
                    </div>
                ) : (
                    <p className="text-muted-foreground">{t('admin.console.mail.dns.noRecord')}</p>
                )}
                {extra}
                {check.notes.length > 0 && (
                    <ul className="space-y-1">
                        {check.notes.map((code) => {
                            const info = INFO_NOTES.has(code);
                            const Icon = GOOD_NOTES.has(code) ? CheckCircle2 : info ? Info : AlertTriangle;
                            return (
                                <li key={code} className="flex items-start gap-2">
                                    <Icon className={info ? 'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' : 'mt-0.5 h-4 w-4 shrink-0 text-warning'} aria-hidden="true" />
                                    <span>{noteText(code)}</span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </Card>
    );
}

export function DnsTab() {
    const { t, intlLocale } = useI18n();
    const uid = React.useId();
    const [draft, setDraft] = React.useState('');
    const [selector, setSelector] = React.useState('');
    const [nonce, setNonce] = React.useState(0);
    const [invalid, setInvalid] = React.useState(false);

    const url = `/api/admin/mail/dns${buildQuery({ selector, fresh: nonce > 0 ? 1 : undefined })}`;
    const { data, error, isLoading, isValidating, mutate } = useAdminQuery<DnsHealth>(url);

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const value = draft.trim().toLowerCase();
        if (value && !SELECTOR_RE.test(value)) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        if (value === selector && nonce > 0) {
            // Misma clave de SWR (ya con fresh=1): se revalida a mano.
            void mutate();
            return;
        }
        setSelector(value);
        setNonce((n) => n + 1);
    };

    return (
        <Card
            id="dns"
            title={t('admin.console.mail.dns.title')}
            description={data?.domain ? t('admin.console.mail.dns.domain', { domain: data.domain }) : undefined}
        >
            <div className="space-y-4">
                <p role="note" className="rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">{t('admin.console.mail.dns.readOnlyNotice')}</p>

                <form onSubmit={submit} className="flex flex-wrap items-end gap-3" noValidate>
                    <Field
                        label={t('admin.console.mail.dns.selectorLabel')}
                        htmlFor={`${uid}-selector`}
                        hint={t('admin.console.mail.dns.selectorHint')}
                        error={invalid ? t('admin.console.mail.dns.selectorInvalid') : null}
                        className="w-full sm:w-72"
                    >
                        <input
                            id={`${uid}-selector`}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            className={inputClass}
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={63}
                            aria-invalid={invalid || undefined}
                            aria-describedby={invalid ? `${uid}-selector-err` : `${uid}-selector-hint`}
                        />
                    </Field>
                    <button type="submit" className={btnPrimary} disabled={isValidating}>
                        {isValidating ? t('admin.console.mail.dns.checking') : t('admin.console.mail.dns.recheck')}
                    </button>
                </form>

                {error && !data ? (
                    <ErrorState message={`${t('admin.console.mail.dns.loadFailed')} ${t(apiErrorKey(error))}`} onRetry={() => void mutate()} />
                ) : isLoading && !data ? (
                    <LoadingState />
                ) : data && !data.configured ? (
                    <p role="status" className="text-sm text-muted-foreground">{t('admin.console.mail.dns.notConfigured')}</p>
                ) : data && data.spf && data.dkim && data.dmarc && data.mx ? (
                    <>
                        <p role="status" className="text-xs text-muted-foreground">{t('admin.console.mail.dns.checkedAt', { date: formatDateTime(data.checkedAt, intlLocale) })}</p>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <RecordCard
                                kind="spf"
                                check={data.spf}
                                extra={data.spf.record ? <p className="text-xs text-muted-foreground">{t('admin.console.mail.dns.counts', { includes: data.spf.includes, lookups: data.spf.lookups })}</p> : null}
                            />
                            <RecordCard
                                kind="dkim"
                                check={data.dkim}
                                extra={
                                    <p className="text-xs text-muted-foreground">
                                        {data.dkim.selector
                                            ? t('admin.console.mail.dns.selectorUsed', { selector: data.dkim.selector })
                                            : t('admin.console.mail.dns.selectorsTried', { list: data.dkim.selectorsTried.join(', ') })}
                                    </p>
                                }
                            />
                            <RecordCard
                                kind="dmarc"
                                check={data.dmarc}
                                extra={data.dmarc.policy ? <p className="text-xs text-muted-foreground">{t('admin.console.mail.dns.policy', { policy: data.dmarc.policy })}</p> : null}
                            />
                            <RecordCard kind="mx" check={data.mx} />
                        </div>
                    </>
                ) : null}
            </div>
        </Card>
    );
}
