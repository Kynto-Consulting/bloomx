'use client';

import { useId, useState } from 'react';
import { KeyRound } from 'lucide-react';
import {
    Badge, Card, DefinitionList, DetailDrawer, ErrorState, LoadingState, btnOutline, btnPrimary, formatDateTime, useAdminQuery,
} from '@/components/admin/console';
import { useI18n } from '@/components/I18nProvider';
import { declaredCredentialKeys } from '@/lib/extension-credentials';
import {
    declaredFunctions, declaresSettingsPanel, declaresTestConnection, describeMounts, overallRisk, riskCounts, type SettingsField,
} from '@/lib/admin/extensions-manifest';
import type { ExtensionRow } from '@/lib/admin/extensions-view';
import { ExtensionActionButtons, StatusBadges, type RowActions } from './ExtensionCard';
import { PermissionsList, RISK_TONE } from './PermissionsList';
import { TabList, panelDomId, tabDomId, type TabDef } from './Tabs';
import type { TestResult } from './useExtensionActions';

type TabId = 'summary' | 'permissions' | 'credentials' | 'settings' | 'status';

export interface DetailProps {
    row: ExtensionRow | null;
    onClose: () => void;
    actions: RowActions;
    testSupport: { supported: boolean; reason: string | null };
    onTest: (row: ExtensionRow) => Promise<TestResult>;
    onOpenCredentials: (row: ExtensionRow) => void;
}

export function ExtensionDetail({ row, onClose, actions, testSupport, onTest, onOpenCredentials }: DetailProps) {
    const { t } = useI18n();
    const uid = useId();
    const [tab, setTab] = useState<TabId>('summary');
    const [seenId, setSeenId] = useState<string | null>(null);
    // Al abrir otra extension se vuelve a la primera pestana.
    if (row && row.id !== seenId) {
        setSeenId(row.id);
        setTab('summary');
    }
    if (!row && seenId !== null) setSeenId(null);

    const tabs: TabDef<TabId>[] = [
        { id: 'summary', label: t('admin.console.extensions.detail.tab.summary') },
        { id: 'permissions', label: t('admin.console.extensions.detail.tab.permissions') },
        ...(row?.hasCredentialKeys ? [{ id: 'credentials' as const, label: t('admin.console.extensions.detail.tab.credentials') }] : []),
        { id: 'settings', label: t('admin.console.extensions.detail.tab.settings') },
        { id: 'status', label: t('admin.console.extensions.detail.tab.status') },
    ];
    const active: TabId = tabs.some((x) => x.id === tab) ? tab : 'summary';

    return (
        <DetailDrawer
            open={!!row}
            onClose={onClose}
            title={row?.name ?? ''}
            subtitle={row ? <span className="break-all font-mono text-xs">{row.id}</span> : undefined}
            footer={row ? <div className="flex flex-wrap gap-2"><ExtensionActionButtons row={row} actions={actions} /></div> : undefined}
        >
            {row && (
                <div className="space-y-4">
                    <div className="flex flex-wrap gap-1.5"><StatusBadges row={row} /></div>
                    <TabList tabs={tabs} active={active} onChange={setTab} label={t('admin.console.extensions.detail.tabs')} idPrefix={uid} />
                    <div role="tabpanel" id={panelDomId(uid, active)} aria-labelledby={tabDomId(uid, active)} tabIndex={0} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {active === 'summary' && <SummaryTab row={row} actions={actions} />}
                        {active === 'permissions' && <PermissionsTab row={row} />}
                        {active === 'credentials' && <CredentialsTab row={row} readOnly={actions.readOnly} onOpen={() => onOpenCredentials(row)} />}
                        {active === 'settings' && <SettingsTab row={row} />}
                        {active === 'status' && <StatusTab row={row} testSupport={testSupport} onTest={onTest} />}
                    </div>
                </div>
            )}
        </DetailDrawer>
    );
}

function SummaryTab({ row, actions }: { row: ExtensionRow; actions: RowActions }) {
    const { t } = useI18n();
    const tpl = row.template;
    const risk = overallRisk(tpl);
    const authType = tpl?.auth?.type && tpl.auth.type.toUpperCase() !== 'NONE' ? tpl.auth.type : null;
    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{row.description || t('admin.console.extensions.card.noDescription')}</p>
            <DefinitionList
                items={[
                    { label: t('admin.console.extensions.summaryTab.category'), value: t(`admin.console.extensions.filters.categories.${row.category}`) },
                    {
                        label: t('admin.console.extensions.summaryTab.state'),
                        value: row.installed ? t(row.enabled ? 'admin.console.extensions.status.enabled' : 'admin.console.extensions.status.disabled') : t('admin.console.extensions.summaryTab.notInstalled'),
                    },
                    {
                        label: t('admin.console.extensions.summaryTab.installedVersion'),
                        value: row.installed ? (row.installedVersion ? `v${row.installedVersion}` : t('admin.console.extensions.card.versionUnknown')) : t('admin.console.extensions.summaryTab.notInstalled'),
                    },
                    {
                        label: t('admin.console.extensions.summaryTab.latest'),
                        value: row.version ? (
                            <span className="inline-flex flex-wrap items-center gap-2">
                                v{row.version}
                                {row.installed && (row.updateAvailable
                                    ? <Badge tone="info">{t('admin.console.extensions.card.updateAvailable', { from: row.installedVersion ?? '?', to: row.version })}</Badge>
                                    : <Badge tone="success">{t('admin.console.extensions.summaryTab.upToDate')}</Badge>)}
                            </span>
                        ) : t('admin.console.extensions.card.versionUnknown'),
                    },
                    {
                        label: t('admin.console.extensions.summaryTab.price'),
                        value: row.isPaid ? t('admin.console.extensions.card.price', { price: row.price, currency: row.currency }) : t('admin.console.extensions.card.free'),
                    },
                    {
                        label: t('admin.console.extensions.summaryTab.auth'),
                        value: authType ? `${authType}${tpl?.auth?.provider ? ` · ${tpl.auth.provider}` : ''}` : t('admin.console.extensions.summaryTab.authNone'),
                    },
                    {
                        label: t('admin.console.extensions.summaryTab.credentials'),
                        value: row.hasCredentials === null ? t('admin.console.extensions.summaryTab.credentialsUnknown') : row.hasCredentials ? t('admin.console.extensions.summaryTab.credentialsYes') : t('admin.console.extensions.summaryTab.credentialsNo'),
                    },
                    {
                        label: t('admin.console.extensions.summaryTab.risk'),
                        value: <Badge tone={RISK_TONE[risk]}>{t(`admin.console.extensions.permissions.risk.${risk}`)}</Badge>,
                    },
                    ...(tpl?.manifestVersion ? [{ label: t('admin.console.extensions.summaryTab.manifestVersion'), value: tpl.manifestVersion }] : []),
                ]}
            />
            {row.installed && <MandatoryControl row={row} actions={actions} />}
        </div>
    );
}

/**
 * Interruptor "Obligatoria para todos" (solo administradores; pide confirmacion con ConfirmDialog). Obligatoria = ningun usuario
 * puede desactivarla y sus hooks de servidor (DLP, seguridad) se ejecutan siempre. Si el manifest ya la declara obligatoria,
 * el interruptor queda bloqueado y lo explica.
 */
function MandatoryControl({ row, actions }: { row: ExtensionRow; actions: RowActions }) {
    const { t } = useI18n();
    const id = useId();
    const locked = actions.readOnly || row.mandatoryByManifest || !row.enabled || actions.busyId !== null;
    const checked = row.mandatory;
    const help = row.mandatoryByManifest ? t('admin.console.extensions.mandatory.byManifest')
        : actions.readOnly ? t('admin.console.extensions.mandatory.readOnly')
        : !row.enabled ? t('admin.console.extensions.mandatory.needsEnabled')
        : t('admin.console.extensions.mandatory.help');
    return (
        <section aria-labelledby={`${id}-label`} className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 id={`${id}-label`} className="text-sm font-semibold text-foreground">{t('admin.console.extensions.mandatory.label')}</h3>
                    <p id={`${id}-help`} className="mt-1 text-xs text-muted-foreground">{help}</p>
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    aria-labelledby={`${id}-label`}
                    aria-describedby={`${id}-help`}
                    disabled={locked}
                    onClick={() => actions.onRequest(checked ? 'mandatoryOff' : 'mandatoryOn', row)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-primary' : 'bg-muted'}`}
                >
                    <span aria-hidden="true" className={`inline-block h-4 w-4 rounded-full bg-background shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
            </div>
        </section>
    );
}

function PermissionsTab({ row }: { row: ExtensionRow }) {
    const { t } = useI18n();
    const tpl = row.template;
    const counts = riskCounts(tpl);
    const mounts = describeMounts(tpl);
    const functions = declaredFunctions(tpl);
    const auth = tpl?.auth;
    const hasAuth = !!auth?.type && auth.type.toUpperCase() !== 'NONE';
    return (
        <div className="space-y-5">
            <section aria-labelledby={`${row.id}-perm`}>
                <h3 id={`${row.id}-perm`} className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.extensions.permissions.summary')}</h3>
                <div className="mb-2 flex flex-wrap gap-1.5">
                    {(['high', 'medium', 'low'] as const).filter((r) => counts[r] > 0).map((r) => (
                        <Badge key={r} tone={RISK_TONE[r]}>{t('admin.console.extensions.permissions.riskCount', { count: counts[r], level: t(`admin.console.extensions.permissions.risk.${r}`).toLowerCase() })}</Badge>
                    ))}
                </div>
                <PermissionsList template={tpl} />
                <p className="mt-2 text-xs text-muted-foreground">{t('admin.console.extensions.permissions.language')}</p>
            </section>

            <section aria-labelledby={`${row.id}-auth`}>
                <h3 id={`${row.id}-auth`} className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.extensions.permissions.authTitle')}</h3>
                {hasAuth ? (
                    <DefinitionList
                        items={[
                            { label: t('admin.console.extensions.permissions.authType'), value: auth!.type },
                            ...(auth?.provider ? [{ label: t('admin.console.extensions.permissions.authProvider'), value: auth.provider }] : []),
                            ...(auth?.scopes?.length ? [{ label: t('admin.console.extensions.permissions.authScopes'), value: <ul className="space-y-0.5 font-mono text-xs">{auth.scopes.map((s) => <li key={s} className="break-all">{s}</li>)}</ul> }] : []),
                        ]}
                    />
                ) : (
                    <p className="text-sm text-muted-foreground">{t('admin.console.extensions.permissions.authNone')}</p>
                )}
            </section>

            <section aria-labelledby={`${row.id}-mounts`}>
                <h3 id={`${row.id}-mounts`} className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.extensions.permissions.mountsTitle')}</h3>
                {mounts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('admin.console.extensions.permissions.mountsNone')}</p>
                ) : (
                    <ul className="space-y-1 text-sm">
                        {mounts.map((m) => (
                            <li key={m.point} className="flex flex-wrap items-baseline gap-2">
                                <span className="text-foreground">{m.known ? t(`admin.console.extensions.mounts.${m.point}`) : m.point}</span>
                                <code className="text-[11px] text-muted-foreground">{m.point}</code>
                            </li>
                        ))}
                    </ul>
                )}
                {(tpl?.intercepts?.length ?? 0) > 0 && (
                    <div className="mt-3">
                        <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('admin.console.extensions.permissions.interceptsTitle')}</h4>
                        <ul className="space-y-0.5 font-mono text-xs">{tpl!.intercepts!.map((i) => <li key={i.point}>{i.point}</li>)}</ul>
                    </div>
                )}
            </section>

            <section aria-labelledby={`${row.id}-fn`}>
                <h3 id={`${row.id}-fn`} className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.extensions.permissions.functionsTitle')}</h3>
                {functions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('admin.console.extensions.permissions.functionsNone')}</p>
                ) : (
                    <ul className="flex flex-wrap gap-1.5">{functions.map((f) => <li key={f}><Badge><code>{f}</code></Badge></li>)}</ul>
                )}
            </section>
        </div>
    );
}

function CredentialsTab({ row, readOnly, onOpen }: { row: ExtensionRow; readOnly: boolean; onOpen: () => void }) {
    const { t } = useI18n();
    const keys = declaredCredentialKeys(row.template);
    return (
        <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('admin.console.extensions.credentialsTab.intro')}</p>
            <ul className="space-y-1 font-mono text-xs text-foreground">{keys.map((k) => <li key={k}>{k}</li>)}</ul>
            {row.installed && row.hasCredentials !== null && (
                <p role="status" className="text-sm text-foreground">
                    {row.hasCredentials ? t('admin.console.extensions.credentialsTab.configured') : t('admin.console.extensions.credentialsTab.notConfigured')}
                </p>
            )}
            {!row.installed ? (
                <p className="text-sm text-muted-foreground">{t('admin.console.extensions.credentialsTab.needInstall')}</p>
            ) : readOnly ? (
                <p className="text-sm text-muted-foreground">{t('admin.console.extensions.credentialsTab.readOnly')}</p>
            ) : (
                <button type="button" className={btnPrimary} onClick={onOpen}>
                    <KeyRound className="h-4 w-4" aria-hidden="true" />
                    {t('admin.console.extensions.actions.configureCredentials')}
                </button>
            )}
        </div>
    );
}

function SettingsTab({ row }: { row: ExtensionRow }) {
    const { t } = useI18n();
    const declared = declaresSettingsPanel(row.template);
    const fields: readonly SettingsField[] = row.template?.settingsFields ?? [];
    return (
        <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t('admin.console.extensions.settingsTab.title')}</h3>
            {!declared && !(row.template?.settingsFields) ? (
                <p className="text-sm text-muted-foreground">{t('admin.console.extensions.settingsTab.noPanel')}</p>
            ) : (
                <>
                    <p className="text-sm text-muted-foreground">{t('admin.console.extensions.settingsTab.intro')}</p>
                    {fields.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t('admin.console.extensions.settingsTab.noFields')}</p>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border border-border">
                            <table className="w-full min-w-[420px] text-left text-sm">
                                <caption className="sr-only">{t('admin.console.extensions.settingsTab.table')}</caption>
                                <thead className="bg-muted/50 text-xs text-muted-foreground">
                                    <tr>
                                        <th scope="col" className="px-3 py-2">{t('admin.console.extensions.settingsTab.columns.name')}</th>
                                        <th scope="col" className="px-3 py-2">{t('admin.console.extensions.settingsTab.columns.type')}</th>
                                        <th scope="col" className="px-3 py-2">{t('admin.console.extensions.settingsTab.columns.label')}</th>
                                        <th scope="col" className="px-3 py-2">{t('admin.console.extensions.settingsTab.columns.default')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                    {fields.map((f) => (
                                        <tr key={f.name}>
                                            <td className="px-3 py-2 font-mono text-xs">{f.name}</td>
                                            <td className="px-3 py-2">{f.type}</td>
                                            <td className="px-3 py-2">{f.label}</td>
                                            <td className="px-3 py-2">{f.defaultValue ?? <span className="text-muted-foreground">{t('admin.console.extensions.settingsTab.noDefault')}</span>}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground">{t('admin.console.extensions.settingsTab.readOnlyNote')}</p>
                </>
            )}
        </div>
    );
}

interface StatusResponse {
    lastEvent: LogEntry | null;
    lastError: LogEntry | null;
    errors24h: number;
    entries: LogEntry[];
}
interface LogEntry {
    id: string;
    event: string;
    ts: string | null;
    outcome: string | null;
    status: number | null;
}

const EVENT_KEYS: Record<string, string> = {
    'admin.extension.install': 'install',
    'admin.extension.uninstall': 'uninstall',
    'admin.extension.credentials': 'credentials',
    'admin.extension.credentials.migrate': 'credentials',
    'admin.extension.toggled': 'toggled',
    'admin.extension.mandatory_changed': 'mandatory',
    'admin.extension.reordered': 'reordered',
    'admin.extension.test': 'test',
};

function eventLabel(t: (k: string) => string, event: string): string {
    return `${t(`admin.console.extensions.statusTab.events.${EVENT_KEYS[event] ?? 'other'}`)} (${event})`;
}

function StatusTab({ row, testSupport, onTest }: { row: ExtensionRow; testSupport: DetailProps['testSupport']; onTest: DetailProps['onTest'] }) {
    const { t, intlLocale } = useI18n();
    const q = useAdminQuery<StatusResponse>(`/api/admin/extensions/${encodeURIComponent(row.id)}/status`);
    const [testing, setTesting] = useState(false);
    const [result, setResult] = useState<TestResult | null>(null);
    const canDeclare = declaresTestConnection(row.template);
    const ready = row.installed && row.enabled;

    const runTest = async () => {
        setTesting(true);
        setResult(null);
        try {
            setResult(await onTest(row));
        } finally {
            setTesting(false);
        }
    };

    const outcomeText = (o: string | null) => (o === 'ok' ? t('admin.console.extensions.statusTab.outcome.ok') : o === 'failed' ? t('admin.console.extensions.statusTab.outcome.failed') : t('admin.console.extensions.statusTab.outcome.unknown'));
    const summaryEntry = (e: LogEntry | null, emptyKey: string) =>
        e ? (
            <span>
                {eventLabel(t, e.event)} · {outcomeText(e.outcome)}{e.status ? ` · ${e.status}` : ''} · {e.ts ? formatDateTime(e.ts, intlLocale) : ''}
            </span>
        ) : (
            t(emptyKey)
        );

    return (
        <div className="space-y-5">
            <p className="text-xs text-muted-foreground">{t('admin.console.extensions.statusTab.note')}</p>
            {q.isLoading && !q.data ? (
                <LoadingState />
            ) : q.error ? (
                <ErrorState message={t('admin.console.extensions.statusTab.loadError')} onRetry={() => void q.mutate()} />
            ) : q.data ? (
                <>
                    <DefinitionList
                        items={[
                            { label: t('admin.console.extensions.statusTab.lastEvent'), value: summaryEntry(q.data.lastEvent, 'admin.console.extensions.statusTab.none') },
                            { label: t('admin.console.extensions.statusTab.lastError'), value: summaryEntry(q.data.lastError, 'admin.console.extensions.statusTab.noneError') },
                            { label: t('admin.console.extensions.statusTab.errors24h'), value: String(q.data.errors24h) },
                        ]}
                        className="sm:grid-cols-1"
                    />
                    <div>
                        <h3 className="mb-2 text-sm font-semibold text-foreground">{t('admin.console.extensions.statusTab.log')}</h3>
                        {q.data.entries.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t('admin.console.extensions.statusTab.none')}</p>
                        ) : (
                            <div className="overflow-x-auto rounded-lg border border-border">
                                <table className="w-full min-w-[480px] text-left text-sm">
                                    <caption className="sr-only">{t('admin.console.extensions.statusTab.log')}</caption>
                                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                                        <tr>
                                            <th scope="col" className="px-3 py-2">{t('admin.console.extensions.statusTab.columns.when')}</th>
                                            <th scope="col" className="px-3 py-2">{t('admin.console.extensions.statusTab.columns.event')}</th>
                                            <th scope="col" className="px-3 py-2">{t('admin.console.extensions.statusTab.columns.result')}</th>
                                            <th scope="col" className="px-3 py-2">{t('admin.console.extensions.statusTab.columns.status')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                        {q.data.entries.map((e) => (
                                            <tr key={e.id}>
                                                <td className="whitespace-nowrap px-3 py-2">{e.ts ? formatDateTime(e.ts, intlLocale) : '—'}</td>
                                                <td className="px-3 py-2">{eventLabel(t, e.event)}</td>
                                                <td className="px-3 py-2"><Badge tone={e.outcome === 'ok' ? 'success' : e.outcome === 'failed' ? 'danger' : 'neutral'}>{outcomeText(e.outcome)}</Badge></td>
                                                <td className="px-3 py-2">{e.status ?? '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            ) : null}

            {canDeclare && (
                <Card title={t('admin.console.extensions.statusTab.testTitle')} headingLevel={3}>
                    <p className="mb-3 text-sm text-muted-foreground">{t('admin.console.extensions.statusTab.testHelp')}</p>
                    {!testSupport.supported ? (
                        <p role="note" className="text-sm text-muted-foreground">
                            {t(`admin.console.extensions.statusTab.testUnsupported.${testSupport.reason === 'user_context_required' || testSupport.reason === 'signing_key_required' ? testSupport.reason : 'generic'}`)}
                        </p>
                    ) : !ready ? (
                        <p className="text-sm text-muted-foreground">{t('admin.console.extensions.statusTab.testNeedsInstall')}</p>
                    ) : (
                        <button type="button" className={btnOutline} disabled={testing} onClick={() => void runTest()}>
                            {testing ? t('admin.console.extensions.actions.testing') : t('admin.console.extensions.actions.test')}
                        </button>
                    )}
                    <div role="status" aria-live="polite" className="mt-3 text-sm">
                        {result && 'ok' in result && result.ok && <span className="text-success">{t('admin.console.extensions.statusTab.testOk')}</span>}
                        {result && 'ok' in result && !result.ok && (
                            <span className="text-destructive">{t(`admin.console.extensions.statusTab.testFailed.${['auth_required', 'timeout', 'not_installed', 'rate_limited'].includes(result.message) ? result.message : 'failed'}`)}</span>
                        )}
                        {result && 'notSupported' in result && <span className="text-muted-foreground">{t('admin.console.extensions.statusTab.testUnsupported.generic')}</span>}
                    </div>
                </Card>
            )}
        </div>
    );
}

