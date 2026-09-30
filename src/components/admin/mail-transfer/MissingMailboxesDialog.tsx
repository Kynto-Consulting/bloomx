'use client';

import * as React from 'react';
import { Modal } from '@/components/ui/Modal';
import { useI18n } from '@/components/I18nProvider';
import { btnOutline, btnPrimary, inputClass, selectClass } from '@/components/admin/console';
import { checkPassword } from '@/lib/mail-transfer/password-policy';
import { PasswordMeter } from './PasswordMeter';

export type MissingAction = 'create' | 'map' | 'discard';
export interface MissingDecision { action: MissingAction; target: string }
export interface MissingItem { address: string; count: number; status: 'missing' | 'foreign_domain' | 'unknown' }
export interface PasswordConfig { mode: 'random' | 'generic'; generic: string; mustChange: boolean }
export interface MissingResult { decisions: Record<string, MissingDecision>; password: PasswordConfig }

const EMAIL_SHAPE = /^[^\s@,;<>"()]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export const defaultDecision = (item: MissingItem, domains: string[]): MissingDecision => {
    const domain = item.address.split('@')[1]?.toLowerCase();
    if (item.status === 'missing' && domain && domains.includes(domain)) return { action: 'create', target: item.address };
    return { action: item.address ? 'map' : 'discard', target: '' };
};

/** Validacion pura de una decision (testeable): devuelve la clave i18n del error o null. */
export function validateDecision(
    item: MissingItem, d: MissingDecision, ctx: { domains: string[]; existing: (addr: string) => boolean | undefined; createdElsewhere: Set<string> },
): string | null {
    if (d.action === 'discard') return null;
    const target = d.target.trim().toLowerCase();
    if (!EMAIL_SHAPE.test(target)) return 'admin.console.transfer.missing.invalidAddress';
    const domain = target.split('@')[1];
    if (d.action === 'create') {
        if (!ctx.domains.includes(domain)) return 'admin.console.transfer.missing.invalidDomain';
        if (ctx.existing(target) === true) return null; // ya existe: se usara tal cual
        if (ctx.createdElsewhere.has(target)) return 'admin.console.transfer.missing.duplicateAddress';
        return null;
    }
    // map: debe existir
    if (ctx.existing(target) === false) return 'admin.console.transfer.missing.notFound';
    return null;
}

/**
 * "¿Desea crear los correos faltantes?": lista editable de direcciones (crear / mapear a un buzon existente / descartar),
 * contrasena generica con medidor o aleatoria unica por usuario (recomendado) y "obligar a cambiar la contrasena".
 * Nada se crea aqui: el dialogo solo devuelve las decisiones; la creacion ocurre al confirmar el resumen.
 */
export function MissingMailboxesDialog({
    open, items, domains, initial, initialPassword, checkExists, onSave, onClose,
}: {
    open: boolean;
    items: MissingItem[];
    domains: string[];
    initial: Record<string, MissingDecision>;
    initialPassword: PasswordConfig;
    /** true/false si existe el buzon; undefined si no se pudo comprobar. */
    checkExists: (address: string) => Promise<boolean | undefined>;
    onSave: (r: MissingResult) => void;
    onClose: () => void;
}) {
    const { t } = useI18n();
    const uid = React.useId();
    const [decisions, setDecisions] = React.useState<Record<string, MissingDecision>>({});
    const [pw, setPw] = React.useState<PasswordConfig>(initialPassword);
    const [show, setShow] = React.useState(false);
    const [exists, setExists] = React.useState<Record<string, boolean | undefined>>({});
    const checking = React.useRef(new Set<string>());

    React.useEffect(() => {
        if (!open) return;
        const next: Record<string, MissingDecision> = {};
        for (const it of items) next[it.address] = initial[it.address] ?? defaultDecision(it, domains);
        setDecisions(next);
        setPw(initialPassword);
        setShow(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Comprueba la existencia de los destinos escritos (con un pequeno retardo)
    React.useEffect(() => {
        if (!open) return;
        const timers: ReturnType<typeof setTimeout>[] = [];
        for (const d of Object.values(decisions)) {
            const target = d.target.trim().toLowerCase();
            if (d.action === 'discard' || !EMAIL_SHAPE.test(target) || target in exists || checking.current.has(target)) continue;
            checking.current.add(target);
            timers.push(setTimeout(async () => {
                const r = await checkExists(target).catch(() => undefined);
                checking.current.delete(target);
                setExists((prev) => ({ ...prev, [target]: r }));
            }, 250));
        }
        return () => timers.forEach(clearTimeout);
    }, [open, decisions, exists, checkExists]);

    const createTargets = new Map<string, number>();
    for (const d of Object.values(decisions)) {
        if (d.action === 'create') {
            const k = d.target.trim().toLowerCase();
            createTargets.set(k, (createTargets.get(k) ?? 0) + 1);
        }
    }
    const errors: Record<string, string | null> = {};
    for (const it of items) {
        const d = decisions[it.address];
        if (!d) { errors[it.address] = null; continue; }
        const key = d.target.trim().toLowerCase();
        // repetida solo cuenta si otra fila "crear" usa la misma direccion (varias filas pueden apuntar a un mismo buzon a proposito)
        errors[it.address] = validateDecision(it, d, { domains, existing: (a) => exists[a], createdElsewhere: new Set() });
        void key;
    }
    const needsCreate = Object.values(decisions).some((d) => d.action === 'create');
    const pwCheck = checkPassword(pw.generic);
    const pwOk = !needsCreate || pw.mode === 'random' || pwCheck.ok;
    const allValid = items.every((it) => !errors[it.address]) && pwOk;
    const toCreate = new Set(Object.values(decisions).filter((d) => d.action === 'create').map((d) => d.target.trim().toLowerCase()));

    const setDecision = (address: string, patch: Partial<MissingDecision>) =>
        setDecisions((prev) => ({ ...prev, [address]: { ...prev[address], ...patch } }));

    const setAction = (it: MissingItem, action: MissingAction) => {
        const base = defaultDecision(it, domains);
        setDecision(it.address, { action, target: action === 'discard' ? '' : action === 'create' ? (base.action === 'create' ? base.target : suggest(it.address, domains)) : '' });
    };

    return (
        <Modal open={open} onClose={onClose} panelClassName="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl">
            {({ titleId, descriptionId }) => (
                <form
                    className="flex min-h-0 flex-1 flex-col"
                    aria-describedby={descriptionId}
                    onSubmit={(e) => { e.preventDefault(); if (allValid) onSave({ decisions, password: pw }); }}
                >
                    <h2 id={titleId} className="text-base font-semibold text-foreground">{t('admin.console.transfer.missing.title')}</h2>
                    <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">{t('admin.console.transfer.missing.body')}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t('admin.console.transfer.missing.domainHint', { domains: domains.map((d) => `@${d}`).join(', ') })}</p>

                    <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                        {items.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t('admin.console.transfer.missing.nothing')}</p>
                        ) : (
                            <table className="w-full text-sm">
                                <caption className="sr-only">{t('admin.console.transfer.missing.title')}</caption>
                                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    <tr>
                                        <th scope="col" className="py-2 pr-2">{t('admin.console.transfer.missing.colAddress')}</th>
                                        <th scope="col" className="px-2 py-2 text-right">{t('admin.console.transfer.missing.colMessages')}</th>
                                        <th scope="col" className="px-2 py-2">{t('admin.console.transfer.missing.colAction')}</th>
                                        <th scope="col" className="py-2 pl-2">{t('admin.console.transfer.missing.colTarget')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border align-top">
                                    {items.map((it, i) => {
                                        const d = decisions[it.address] ?? defaultDecision(it, domains);
                                        const err = errors[it.address];
                                        const label = it.address || t('admin.console.transfer.import.notDetected');
                                        return (
                                            <tr key={it.address || `unknown-${i}`}>
                                                <th scope="row" className="max-w-[14rem] break-all py-2 pr-2 text-left font-normal text-foreground">{label}</th>
                                                <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{it.count}</td>
                                                <td className="px-2 py-2">
                                                    <select
                                                        aria-label={`${label}: ${t('admin.console.transfer.missing.colAction')}`}
                                                        value={d.action}
                                                        onChange={(e) => setAction(it, e.target.value as MissingAction)}
                                                        className={selectClass}
                                                    >
                                                        {it.address && <option value="create">{t('admin.console.transfer.missing.actionCreate')}</option>}
                                                        <option value="map">{t('admin.console.transfer.missing.actionMap')}</option>
                                                        <option value="discard">{t('admin.console.transfer.missing.actionDiscard')}</option>
                                                    </select>
                                                </td>
                                                <td className="py-2 pl-2">
                                                    {d.action !== 'discard' ? (
                                                        <>
                                                            <input
                                                                type="email"
                                                                autoComplete="off"
                                                                aria-label={`${label}: ${d.action === 'create' ? t('admin.console.transfer.missing.addressLabel') : t('admin.console.transfer.missing.mapLabel')}`}
                                                                aria-invalid={err ? true : undefined}
                                                                aria-describedby={err ? `${uid}-e${i}` : undefined}
                                                                value={d.target}
                                                                onChange={(e) => setDecision(it.address, { target: e.target.value })}
                                                                className={inputClass}
                                                            />
                                                            {err && <p id={`${uid}-e${i}`} role="alert" className="mt-1 text-xs text-destructive">{t(err)}</p>}
                                                        </>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}

                        {needsCreate && (
                            <fieldset className="mt-5 space-y-3 rounded-lg border border-border p-3">
                                <legend className="px-1 text-sm font-medium text-foreground">{t('admin.console.transfer.missing.passwordLegend')}</legend>
                                <label className="flex items-start gap-2 text-sm text-foreground">
                                    <input type="radio" name={`${uid}-mode`} checked={pw.mode === 'random'} onChange={() => setPw({ ...pw, mode: 'random' })} className="mt-0.5 h-4 w-4 accent-primary" />
                                    {t('admin.console.transfer.missing.modeRandom')}
                                </label>
                                <label className="flex items-start gap-2 text-sm text-foreground">
                                    <input type="radio" name={`${uid}-mode`} checked={pw.mode === 'generic'} onChange={() => setPw({ ...pw, mode: 'generic' })} className="mt-0.5 h-4 w-4 accent-primary" />
                                    {t('admin.console.transfer.missing.modeGeneric')}
                                </label>
                                {pw.mode === 'generic' && (
                                    <div className="pl-6">
                                        <label htmlFor={`${uid}-gp`} className="block text-sm font-medium text-foreground">{t('admin.console.transfer.missing.genericLabel')}</label>
                                        <div className="mt-1 flex gap-2">
                                            <input
                                                id={`${uid}-gp`}
                                                type={show ? 'text' : 'password'}
                                                autoComplete="new-password"
                                                maxLength={200}
                                                value={pw.generic}
                                                onChange={(e) => setPw({ ...pw, generic: e.target.value })}
                                                aria-describedby={`${uid}-gp-hint ${uid}-gp-meter`}
                                                aria-invalid={pw.generic && !pwCheck.ok ? true : undefined}
                                                className={`${inputClass} font-mono`}
                                            />
                                            <button type="button" className={btnOutline} aria-pressed={show} onClick={() => setShow((s) => !s)}>
                                                {show ? t('admin.console.transfer.missing.hide') : t('admin.console.transfer.missing.show')}
                                            </button>
                                        </div>
                                        <p id={`${uid}-gp-hint`} className="mt-1 text-xs text-muted-foreground">{t('admin.console.transfer.missing.genericHint')}</p>
                                        <PasswordMeter id={`${uid}-gp-meter`} password={pw.generic} />
                                        {pw.generic && !pwCheck.ok && <p role="alert" className="mt-1 text-xs text-destructive">{t('admin.console.transfer.missing.genericMismatch')}</p>}
                                    </div>
                                )}
                                <label className="flex items-center gap-2 text-sm text-foreground">
                                    <input type="checkbox" checked={pw.mustChange} onChange={(e) => setPw({ ...pw, mustChange: e.target.checked })} className="h-4 w-4 rounded border-input accent-primary" />
                                    {t('admin.console.transfer.missing.mustChange')}
                                </label>
                            </fieldset>
                        )}
                    </div>

                    <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                        <p aria-live="polite" className="text-xs text-muted-foreground">{t('admin.console.transfer.missing.summaryCreate', { count: toCreate.size })}</p>
                        <div className="flex flex-col-reverse gap-2 sm:flex-row">
                            <button type="button" className={btnOutline} onClick={onClose}>{t('admin.console.transfer.common.cancel')}</button>
                            <button type="submit" className={btnPrimary} disabled={!allValid}>{t('admin.console.transfer.missing.createBtn')}</button>
                        </div>
                    </div>
                </form>
            )}
        </Modal>
    );
}

function suggest(address: string, domains: string[]): string {
    const local = (address.split('@')[0] || 'usuario').replace(/[^a-z0-9._+-]/gi, '').toLowerCase();
    return `${local}@${domains[0] ?? ''}`;
}
