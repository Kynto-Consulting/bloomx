'use client';

import { useId, useState } from 'react';
import { ChevronDown, ChevronRight, ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Badge, Switch, btnDangerOutline, btnOutline, inputClass, selectClass } from '@/components/admin/console';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useI18n } from '@/components/I18nProvider';
import {
    describeFieldError, itemDirty, itemTitle, listCount, newItemId, toItem, validateItems,
    type FormValue, type ObjectItem, type SimpleValue,
} from '@/lib/admin/extensions-config';
import { SETTINGS_LIMITS, isVisible, itemSecretName, localizedText, type SettingField, type SettingsAction } from '@/lib/expansions/settings-schema';

export interface ObjectsEditorProps {
    field: SettingField;
    items: ObjectItem[];
    /** Elementos tal como estan guardados (para saber que elemento tiene cambios sin guardar). */
    initialItems: FormValue | undefined;
    onChange: (items: ObjectItem[]) => void;
    secretsSet: ReadonlySet<string>;
    /** Puede editarse (instalada, con sesion de gestor y sin operacion en curso). */
    editable: boolean;
    /** Error del campo (servidor o del conjunto), ya traducido. */
    error?: string | null;
    /** Errores del servidor por secreto (`campo.id.sub`), ya traducidos. */
    secretErrors?: Record<string, string>;
    /** Acciones con scope "item" de este campo. */
    itemActions: SettingsAction[];
    actionBusy: string | null;
    onRunAction: (action: SettingsAction, itemId: string) => void;
    /** Resultado de una accion (si es de un elemento de este campo), renderizado dentro de su tarjeta. */
    renderResult?: (itemId: string) => React.ReactNode;
}

export function ObjectsEditor({
    field, items, initialItems, onChange, secretsSet, editable, error, secretErrors = {}, itemActions, actionBusy, onRunAction, renderResult,
}: ObjectsEditorProps) {
    const { t, locale } = useI18n();
    const uid = useId();
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [touched, setTouched] = useState<Set<string>>(new Set());
    const [pendingDelete, setPendingDelete] = useState<ObjectItem | null>(null);

    const label = localizedText(field.label, locale, field.key);
    const description = localizedText(field.description, locale);
    const subs = (field.itemFields ?? []).filter((s) => s.type !== 'objects');
    const maxItems = Math.min(field.maxItems ?? SETTINGS_LIMITS.maxObjectItems, SETTINGS_LIMITS.maxObjectItems);
    const errors = validateItems(field, items, secretsSet);
    const full = items.length >= maxItems;

    const replace = (id: string, next: ObjectItem) => onChange(items.map((i) => (i.id === id ? next : i)));
    const touch = (key: string) => setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));

    const add = (base: string, raw: Record<string, unknown> = {}) => {
        const id = newItemId(base, items.map((i) => i.id));
        onChange([...items, toItem(field, raw, id, true)]);
        setOpen((prev) => ({ ...prev, [id]: true }));
    };
    const move = (index: number, delta: -1 | 1) => {
        const target = index + delta;
        if (target < 0 || target >= items.length) return;
        const next = items.slice();
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    };

    const setSub = (item: ObjectItem, key: string, value: SimpleValue) => {
        touch(`${item.id}.${key}`);
        replace(item.id, { ...item, values: { ...item.values, [key]: value } });
    };
    const setSecret = (item: ObjectItem, key: string, value: string | null | undefined) => {
        touch(`${item.id}.${key}`);
        const secrets = { ...item.secrets };
        if (value === undefined) delete secrets[key];
        else secrets[key] = value;
        replace(item.id, { ...item, secrets });
    };

    const renderSub = (item: ObjectItem, sub: SettingField) => {
        const at = `${item.id}.${sub.key}`;
        const id = `${uid}-${at}`;
        const subLabel = localizedText(sub.label, locale, sub.key);
        const subDescription = localizedText(sub.description, locale);
        const e = errors[at];
        const shown = e && (e.code !== 'required' || touched.has(at) || !item.isNew) ? describeFieldError(t, e) : null;
        const serverMsg = sub.secret ? secretErrors[itemSecretName(field.key, item.id, sub.key)] : undefined;
        const message = shown ?? serverMsg ?? null;
        const hintId = subDescription ? `${id}-hint` : undefined;
        const describedBy = message ? `${id}-err` : hintId;
        const disabled = !editable;
        const required = sub.required;
        const value = item.values[sub.key];
        const common = { id, disabled, 'aria-invalid': message ? true : undefined, 'aria-describedby': describedBy, 'aria-required': required || undefined } as const;

        const labelEl = (
            <label htmlFor={id} className="block text-sm font-medium text-foreground">
                {subLabel}{required && <span aria-hidden="true" className="text-destructive"> *</span>}
            </label>
        );
        const foot = (
            <>
                {subDescription && !message && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{subDescription}</p>}
                {message && <p id={`${id}-err`} role="alert" className="text-xs text-destructive">{message}</p>}
            </>
        );

        if (sub.secret) {
            const configured = !item.isNew && secretsSet.has(itemSecretName(field.key, item.id, sub.key));
            const typed = item.secrets[sub.key];
            const removing = typed === null;
            return (
                <div key={sub.key} className="space-y-1" data-testid={`secret-${at}`}>
                    {labelEl}
                    <p className="flex flex-wrap items-center gap-2 text-xs text-foreground">
                        <Badge tone={configured && !removing ? 'success' : 'neutral'}>
                            {configured && !removing ? t('admin.console.extensions.config.objects.secretSet') : t('admin.console.extensions.config.objects.secretUnset')}
                        </Badge>
                        {removing && <span className="text-muted-foreground">{t('admin.console.extensions.config.objects.secretWillRemove')}</span>}
                        {typeof typed === 'string' && typed !== '' && <span className="text-muted-foreground">{t('admin.console.extensions.config.objects.secretPending')}</span>}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <input
                            {...common}
                            type="password"
                            autoComplete="new-password"
                            spellCheck={false}
                            value={typeof typed === 'string' ? typed : ''}
                            placeholder={configured ? t('admin.console.extensions.config.objects.secretReplace') : t('admin.console.extensions.config.objects.secretNew')}
                            onChange={(ev) => setSecret(item, sub.key, ev.target.value === '' ? undefined : ev.target.value)}
                            className={`${inputClass} min-w-0 flex-1`}
                        />
                        {configured && !removing && (
                            <button type="button" className={btnDangerOutline} disabled={disabled} onClick={() => setSecret(item, sub.key, null)}>
                                {t('admin.console.extensions.config.objects.secretRemove')}
                            </button>
                        )}
                        {removing && (
                            <button type="button" className={btnOutline} disabled={disabled} onClick={() => setSecret(item, sub.key, undefined)}>
                                {t('admin.console.extensions.config.cancel')}
                            </button>
                        )}
                    </div>
                    {foot}
                </div>
            );
        }

        switch (sub.type) {
            case 'boolean':
                return (
                    <div key={sub.key} className="space-y-1">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-foreground">{subLabel}</span>
                            <Switch id={id} checked={value === true} label={subLabel} disabled={disabled} onChange={(v) => setSub(item, sub.key, v)} />
                        </div>
                        {foot}
                    </div>
                );
            case 'enum':
                return (
                    <div key={sub.key} className="space-y-1">
                        {labelEl}
                        <select {...common} className={selectClass} value={typeof value === 'string' ? value : ''} onChange={(ev) => setSub(item, sub.key, ev.target.value)}>
                            <option value="">{t('admin.console.extensions.config.selectPlaceholder')}</option>
                            {(sub.options ?? []).map((o) => <option key={o.value} value={o.value}>{localizedText(o.label, locale, o.value)}</option>)}
                        </select>
                        {foot}
                    </div>
                );
            case 'multienum': {
                const selected = Array.isArray(value) ? (value as string[]) : [];
                return (
                    <fieldset key={sub.key} className="space-y-1" disabled={disabled} aria-invalid={message ? true : undefined} aria-describedby={describedBy}>
                        <legend className="text-sm font-medium text-foreground">{subLabel}{required && <span aria-hidden="true" className="text-destructive"> *</span>}</legend>
                        <ul className="space-y-1">
                            {(sub.options ?? []).map((o, i) => {
                                const checked = selected.includes(o.value);
                                const optId = `${id}-o${i}`;
                                return (
                                    <li key={o.value} className="flex items-center gap-2">
                                        <input id={optId} type="checkbox" checked={checked} onChange={() => setSub(item, sub.key, checked ? selected.filter((v) => v !== o.value) : [...selected, o.value])} className="h-4 w-4 shrink-0 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                                        <label htmlFor={optId} className="text-sm text-foreground">{localizedText(o.label, locale, o.value)}</label>
                                    </li>
                                );
                            })}
                        </ul>
                        {foot}
                    </fieldset>
                );
            }
            case 'multiline':
            case 'list':
            case 'json':
                return (
                    <div key={sub.key} className="space-y-1">
                        {labelEl}
                        <textarea {...common} rows={sub.type === 'multiline' ? 3 : 4} value={typeof value === 'string' ? value : ''} placeholder={sub.placeholder} spellCheck={false} autoComplete="off" onChange={(ev) => setSub(item, sub.key, ev.target.value)} className={`${inputClass} h-auto py-2 ${sub.type === 'multiline' ? '' : 'font-mono'}`} />
                        {sub.type === 'list' && <p className="text-xs text-muted-foreground">{t('admin.console.extensions.config.listHint', { count: listCount(typeof value === 'string' ? value : ''), max: Math.min(sub.maxItems ?? SETTINGS_LIMITS.maxListItems, SETTINGS_LIMITS.maxListItems) })}</p>}
                        {foot}
                    </div>
                );
            case 'number':
                return (
                    <div key={sub.key} className="space-y-1">
                        {labelEl}
                        <input {...common} type="number" inputMode={sub.integer ? 'numeric' : 'decimal'} min={sub.min} max={sub.max} step={sub.integer ? 1 : 'any'} value={typeof value === 'string' ? value : ''} placeholder={sub.placeholder} autoComplete="off" onChange={(ev) => setSub(item, sub.key, ev.target.value)} className={inputClass} />
                        {foot}
                    </div>
                );
            default:
                return (
                    <div key={sub.key} className="space-y-1">
                        {labelEl}
                        <input {...common} type="text" value={typeof value === 'string' ? value : ''} placeholder={sub.placeholder} maxLength={sub.maxLength ?? SETTINGS_LIMITS.maxStringLength} autoComplete="off" onChange={(ev) => setSub(item, sub.key, ev.target.value)} className={inputClass} />
                        {foot}
                    </div>
                );
        }
    };

    return (
        <fieldset className="space-y-3" data-testid={`objects-${field.key}`} aria-invalid={error ? true : undefined} aria-describedby={error ? `${uid}-err` : undefined}>
            <legend className="text-sm font-medium text-foreground">
                {label}{field.required && <span aria-hidden="true" className="text-destructive"> *</span>}
            </legend>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}

            {items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">{t('admin.console.extensions.config.objects.empty')}</p>
            ) : (
                <ul className="space-y-2">
                    {items.map((item, index) => {
                        const isOpen = open[item.id] ?? false;
                        const dirty = itemDirty(initialItems, item);
                        const bodyId = `${uid}-${item.id}-body`;
                        const hasError = Object.keys(errors).some((k) => k.startsWith(`${item.id}.`));
                        return (
                            <li key={item.id} className="rounded-lg border border-border bg-card text-card-foreground" data-testid={`item-${item.id}`}>
                                <div className="flex flex-wrap items-center gap-2 p-2">
                                    <button
                                        type="button"
                                        aria-expanded={isOpen}
                                        aria-controls={bodyId}
                                        onClick={() => setOpen((prev) => ({ ...prev, [item.id]: !isOpen }))}
                                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
                                        <span className="min-w-0 truncate text-sm font-medium text-foreground">{itemTitle(field, item)}</span>
                                        <code className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{item.id}</code>
                                        {item.isNew && <Badge tone="info">{t('admin.console.extensions.config.objects.new')}</Badge>}
                                        {!item.isNew && dirty && <Badge tone="warning">{t('admin.console.extensions.config.objects.modified')}</Badge>}
                                        {hasError && <Badge tone="danger">{t('admin.console.extensions.config.objects.hasErrors')}</Badge>}
                                    </button>
                                    {editable && (
                                        <div className="flex items-center gap-1">
                                            <button type="button" className={btnOutline} aria-label={t('admin.console.extensions.config.objects.moveUp', { name: itemTitle(field, item) })} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                                            <button type="button" className={btnOutline} aria-label={t('admin.console.extensions.config.objects.moveDown', { name: itemTitle(field, item) })} disabled={index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                                            <button type="button" className={btnDangerOutline} aria-label={t('admin.console.extensions.config.objects.remove', { name: itemTitle(field, item) })} onClick={() => setPendingDelete(item)}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                                        </div>
                                    )}
                                </div>
                                <div id={bodyId} hidden={!isOpen} className="space-y-3 border-t border-border/60 p-3">
                                    <p className="text-xs text-muted-foreground">{t('admin.console.extensions.config.objects.idLabel')} <code>{item.id}</code> · {t('admin.console.extensions.config.objects.idFixed')}</p>
                                    {subs.filter((sub) => isVisible(sub, item.values as Record<string, unknown>)).map((sub) => renderSub(item, sub))}
                                    {itemActions.length > 0 && (
                                        <div className="space-y-2 border-t border-border/60 pt-3">
                                            <div className="flex flex-wrap gap-2">
                                                {itemActions.map((action) => (
                                                    <button
                                                        key={action.id}
                                                        type="button"
                                                        className={btnOutline}
                                                        disabled={!editable || dirty || actionBusy !== null}
                                                        onClick={() => onRunAction(action, item.id)}
                                                    >
                                                        {actionBusy === `${action.id}:${item.id}` ? t('admin.console.extensions.config.actions.running') : localizedText(action.label, locale, action.id)}
                                                    </button>
                                                ))}
                                            </div>
                                            {dirty && <p className="text-xs text-muted-foreground">{t('admin.console.extensions.config.actions.saveFirst')}</p>}
                                            {renderResult?.(item.id)}
                                        </div>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {editable && (
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={btnOutline} disabled={full} onClick={() => add(field.key)}>
                        <Plus className="h-4 w-4" aria-hidden="true" />{t('admin.console.extensions.config.objects.add')}
                    </button>
                    {(field.templates ?? []).map((tpl) => (
                        <button key={tpl.id} type="button" className={btnOutline} disabled={full} title={localizedText(tpl.description, locale) || undefined} onClick={() => add(tpl.id, tpl.value)}>
                            <Plus className="h-4 w-4" aria-hidden="true" />{t('admin.console.extensions.config.objects.addTemplate', { name: localizedText(tpl.label, locale, tpl.id) })}
                        </button>
                    ))}
                    <span className="text-xs text-muted-foreground">{t('admin.console.extensions.config.objects.count', { count: items.length, max: maxItems })}</span>
                </div>
            )}
            {editable && (field.templates ?? []).length > 0 && <p className="text-xs text-muted-foreground">{t('admin.console.extensions.config.objects.templateHint')}</p>}
            {error && <p id={`${uid}-err`} role="alert" className="text-xs text-destructive">{error}</p>}

            <ConfirmDialog
                open={!!pendingDelete}
                title={t('admin.console.extensions.config.objects.removeTitle')}
                description={t('admin.console.extensions.config.objects.removeBody', { name: pendingDelete ? itemTitle(field, pendingDelete) : '' })}
                confirmLabel={t('admin.console.extensions.config.objects.removeConfirm')}
                cancelLabel={t('admin.console.extensions.config.cancel')}
                destructive
                onConfirm={() => {
                    if (pendingDelete) onChange(items.filter((i) => i.id !== pendingDelete.id));
                    setPendingDelete(null);
                }}
                onCancel={() => setPendingDelete(null)}
            />
        </fieldset>
    );
}


