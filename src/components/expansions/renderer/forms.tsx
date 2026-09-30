'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { coerceProps } from '@/lib/expansions/ui-schema';
import { fieldRules, validateFields, validateValue, type FieldRules } from '@/lib/expansions/form-rules';
import {
    CheckboxField, ColorPickerField, ContactPickerField, DatePickerField, DateTimeField, FileInputField, RadioGroupField, SelectField, SliderField,
    TagInputField, TextArea, TextInput, TimePickerField, ToggleField, type ContactSuggestion,
} from '../kit/Fields';
import { FormShell, type FormStatus } from '../kit/Data';
import { useKitStrings } from '../kit/strings';
import { ExtensionLoader } from '../ExtensionLoader';
import { EventLocationField } from './EventLocationField';
import { browserTimeZone, isEndAfterStart, nextEndAfterStartChange, timeZoneOptions, zonedLocalToDate } from '@/lib/expansions/client/datetime';
import { getPath } from './state';
import type { NodeEnv } from './nodes';

/** Tipos de entrada individuales (cada uno puede vivir suelto, enlazado con `bind`, o dentro de un FORM con `name`). */
export const FIELD_TYPES = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'CHECKBOX', 'RADIO_GROUP', 'TOGGLE', 'SLIDER', 'DATE_PICKER', 'TIME_PICKER', 'COLOR_PICKER', 'FILE_INPUT', 'TAG_INPUT', 'CONTACT_PICKER']);

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined);

// ------------------------------------------------------------------ contexto del formulario
interface FieldMeta { label?: string; rules: FieldRules; type?: string }

export interface FormContextType {
    values: Record<string, any>;
    errors: Record<string, string>;
    setValue: (name: string, value: any) => void;
    blur: (name: string) => void;
    register: (name: string, meta: FieldMeta) => () => void;
}
export const FormContext = createContext<FormContextType | null>(null);

function emptyFor(type: string, r: Record<string, any>): any {
    switch (type) {
        case 'CHECKBOX': case 'TOGGLE': return false;
        case 'SLIDER': return typeof r.min === 'number' ? r.min : 0;
        case 'FILE_INPUT': case 'TAG_INPUT': case 'CONTACT_PICKER': return [];
        case 'COLOR_PICKER': return undefined;
        default: return '';
    }
}

/** Busqueda de contactos de la libreta del usuario (mismo endpoint que el composer). */
async function loadContactSuggestions(query: string): Promise<ContactSuggestion[]> {
    try {
        const response = await fetch(`/api/contacts/suggestions?q=${encodeURIComponent(query.trim())}`);
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data.filter((item) => item && typeof item.email === 'string') : [];
    } catch {
        return [];
    }
}

// ------------------------------------------------------------------ un campo
export function FieldNode({ type, raw, r, env }: { type: string; raw: Record<string, any>; r: Record<string, any>; env: NodeEnv }) {
    const form = useContext(FormContext);
    const bindKey: string | undefined = typeof r.bind === 'string' ? r.bind : typeof r.bindTo === 'string' ? r.bindTo : undefined;
    const name = text(r.name);
    const formName = !bindKey && form && name ? name : null;
    const rules = useMemo(() => fieldRules({ required: r.required, rules: r.rules }), [r.required, r.rules]);
    const rulesKey = JSON.stringify(rules);
    const registerRef = useRef(form?.register);
    registerRef.current = form?.register;

    // Un campo dentro de un FORM se da de alta para validarse al enviar.
    useEffect(() => {
        if (!formName || !registerRef.current) return;
        return registerRef.current(formName, { label: text(r.label), rules, type });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formName, rulesKey, type]);

    // `defaultValue` de un campo enlazado: se aplica una vez si el estado aun no tiene valor.
    const { setState } = env;
    const stateNow = bindKey ? getPath(env.state, bindKey) : undefined;
    useEffect(() => {
        if (bindKey && r.defaultValue !== undefined && stateNow === undefined) setState(bindKey, r.defaultValue);
        // solo al montar / cambiar de clave
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bindKey]);

    const managed = Boolean(formName || bindKey);
    const current = formName ? form!.values[formName] : bindKey ? stateNow : r.value;
    const value = managed ? (current === undefined || current === null ? emptyFor(type, r) : current) : current;

    const error = formName ? form!.errors[formName] : undefined;
    // `rules` se pasan tambien al control: valida al perder el foco aunque no este en un FORM.
    const common = {
        name,
        label: text(r.label),
        helperText: text(r.helperText),
        required: r.required,
        disabled: r.disabled,
        readOnly: r.readOnly,
        size: r.size,
        rules: r.rules as FieldRules | undefined,
        error,
        onBlur: () => { if (formName) form!.blur(formName); },
    };

    const change = (next: any) => {
        if (formName) form!.setValue(formName, next);
        else if (bindKey) env.setState(bindKey, next);
        if (raw.onChange) void env.run(raw.onChange, null, { value: next });
    };

    switch (type) {
        case 'INPUT':
            if (r.type === 'datetime-local') return <DateTimeField {...common} value={value} defaultValue={managed ? undefined : r.defaultValue} onChange={change} placeholder={text(r.placeholder)} />;
            return <TextInput {...common} type={r.type} value={value} defaultValue={managed ? undefined : r.defaultValue} onChange={change} placeholder={text(r.placeholder)} maxLength={r.maxLength} min={r.min} max={r.max} step={r.step} autoFocus={r.autoFocus} onEnter={!formName && raw.onSubmit ? () => { void env.run(raw.onSubmit, null, { value }); } : undefined} />;
        case 'TEXTAREA':
            return <TextArea {...common} value={value} defaultValue={managed ? undefined : r.defaultValue} onChange={change} placeholder={text(r.placeholder)} rows={r.rows} maxLength={r.maxLength} mono={r.mono} />;
        case 'SELECT':
            return <SelectField {...common} options={Array.isArray(r.options) ? r.options : []} valueKey={r.valueKey} labelKey={r.labelKey} value={value} defaultValue={managed ? undefined : r.defaultValue} onChange={change} placeholder={text(r.placeholder)} />;
        case 'CHECKBOX':
            return <CheckboxField {...common} checked={managed ? Boolean(value) : r.checked !== undefined ? Boolean(r.checked) : value !== undefined ? Boolean(value) : undefined} defaultValue={managed ? undefined : Boolean(r.defaultValue)} onChange={change} />;
        case 'TOGGLE':
            return <ToggleField {...common} value={managed || value !== undefined ? Boolean(value) : undefined} defaultValue={managed ? undefined : Boolean(r.defaultValue)} onChange={change} />;
        case 'RADIO_GROUP':
            return <RadioGroupField {...common} options={Array.isArray(r.options) ? r.options : []} orientation={r.orientation} value={value} defaultValue={managed ? undefined : r.defaultValue} onChange={change} />;
        case 'SLIDER':
            return <SliderField {...common} min={r.min} max={r.max} step={r.step} showValue={r.showValue} value={value} defaultValue={managed ? undefined : r.defaultValue} onChange={change} />;
        case 'DATE_PICKER':
            return <DatePickerField {...common} min={text(r.min)} max={text(r.max)} value={value} defaultValue={managed ? undefined : r.defaultValue} onChange={change} />;
        case 'TIME_PICKER':
            return <TimePickerField {...common} step={r.step} value={value} defaultValue={managed ? undefined : r.defaultValue} onChange={change} />;
        case 'COLOR_PICKER':
            return <ColorPickerField {...common} value={value} defaultValue={managed ? undefined : r.defaultValue} onChange={change} />;
        case 'TAG_INPUT':
            return <TagInputField {...common} value={value} defaultValue={managed ? undefined : r.defaultValue} onChange={change} placeholder={text(r.placeholder)} max={r.max} validate={r.validate} suggestions={Array.isArray(r.suggestions) ? r.suggestions.filter((s: unknown) => typeof s === 'string') : undefined} />;
        case 'CONTACT_PICKER':
            return (
                <ContactPickerField
                    {...common}
                    value={value}
                    defaultValue={managed ? undefined : r.defaultValue}
                    onChange={change}
                    placeholder={text(r.placeholder)}
                    multiple={r.multiple}
                    max={r.max}
                    contacts={Array.isArray(r.contacts) ? r.contacts : undefined}
                    loadSuggestions={Array.isArray(r.contacts) ? undefined : loadContactSuggestions}
                />
            );
        case 'FILE_INPUT':
            return (
                <FileInputField
                    {...common}
                    accept={text(r.accept)}
                    multiple={r.multiple}
                    maxSizeMb={r.maxSizeMb}
                    readAs={r.readAs}
                    value={value}
                    onChange={(files) => { change(files); if (raw.onSelect) void env.run(raw.onSelect, null, { value: files }); }}
                    onFiles={(files: File[]) => { void uploadFiles(files, raw, env); }}
                />
            );
        default:
            return null;
    }
}

/** Forma heredada: `onUpload` + context.uploadAttachment(file) -> onSuccess({result}) / onError({error}). */
async function uploadFiles(files: File[], raw: Record<string, any>, env: NodeEnv) {
    if (!raw.onUpload || files.length === 0) return;
    const upload = env.context.uploadAttachment;
    if (typeof upload !== 'function') { toast.error('No hay una subida de archivos disponible aqui'); return; }
    for (const file of files) {
        try {
            const result = await upload(file);
            if (raw.onSuccess) await env.run(raw.onSuccess, null, { result });
        } catch (error: any) {
            if (raw.onError) await env.run(raw.onError, null, { error: error?.message || 'No se pudo subir el archivo' });
            else toast.error(error?.message || 'No se pudo subir el archivo');
        }
    }
}

// ------------------------------------------------------------------ formulario
function buildDefaults(fields: any[]): Record<string, any> {
    const defaults: Record<string, any> = {};
    for (const field of fields) {
        if (!field || typeof field !== 'object' || !field.name) continue;
        const kind = String(field.type || 'text');
        defaults[field.name] = field.defaultValue ?? (kind === 'timezone' ? browserTimeZone() : undefined) ?? (kind === 'checkbox' || kind === 'toggle' || kind === 'switch' ? false : kind === 'tags' || kind === 'contacts' ? [] : '');
    }
    return defaults;
}

const INPUT_TYPES = new Set(['text', 'email', 'password', 'number', 'search', 'tel', 'url', 'datetime-local']);

/** Un campo declarativo de `fields` -> nodo equivalente (los mismos controles que fuera del formulario). */
export function fieldToNode(field: Record<string, any>): { type: string; props: Record<string, any> } {
    const kind = String(field.type || 'text');
    const { type: _omit, ...rest } = field;
    const map: Record<string, string> = {
        textarea: 'TEXTAREA', richtext: 'TEXTAREA', select: 'SELECT', checkbox: 'CHECKBOX', toggle: 'TOGGLE', switch: 'TOGGLE', radio: 'RADIO_GROUP',
        timezone: 'SELECT', slider: 'SLIDER', range: 'SLIDER', date: 'DATE_PICKER', time: 'TIME_PICKER', color: 'COLOR_PICKER', tags: 'TAG_INPUT', contacts: 'CONTACT_PICKER', file: 'FILE_INPUT',
    };
    if (kind === 'timezone') return { type: 'SELECT', props: { ...rest, options: timeZoneOptions(typeof field.defaultValue === 'string' ? field.defaultValue : undefined) } };
    if (map[kind]) return { type: map[kind], props: rest };
    return { type: 'INPUT', props: { ...rest, type: INPUT_TYPES.has(kind) ? kind : 'text' } };
}

export function FormNode({ raw, r, env, children }: { raw: Record<string, any>; r: Record<string, any>; env: NodeEnv; children?: any[] }) {
    const strings = useKitStrings();
    const fields: any[] = useMemo(() => (Array.isArray(r.fields) ? r.fields.filter((f: any) => f && typeof f === 'object') : []), [r.fields]);
    const [values, setValues] = useState<Record<string, any>>(() => buildDefaults(fields));
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [status, setStatus] = useState<FormStatus>('idle');
    const [errorMessage, setErrorMessage] = useState<string | undefined>();
    const touchedRef = useRef<Set<string>>(new Set());
    const metaRef = useRef<Map<string, FieldMeta>>(new Map());
    const valuesRef = useRef(values);
    valuesRef.current = values;
    const rootRef = useRef<HTMLDivElement>(null);
    const validateOn = r.validateOn === 'submit' || r.validateOn === 'change' ? r.validateOn : 'blur';

    // Los valores por defecto pueden cambiar (p. ej. una lectura asincrona rellena el estado). Solo se reaplican a
    // los campos que el usuario aun no toco: lo tecleado nunca se pierde por un SET_STATE ajeno.
    const defaultsKey = JSON.stringify(Object.entries(buildDefaults(fields)));
    useEffect(() => {
        const defaults = buildDefaults(fields);
        setValues((prev) => {
            const next: Record<string, any> = {};
            for (const fieldName of Object.keys(defaults)) next[fieldName] = touchedRef.current.has(fieldName) && fieldName in prev ? prev[fieldName] : defaults[fieldName];
            return { ...prev, ...next };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultsKey]);

    const validateOne = useCallback((fieldName: string, all: Record<string, any>): string | null => {
        const meta = metaRef.current.get(fieldName);
        if (!meta) return null;
        return validateValue(all[fieldName], meta.rules, { strings, label: meta.label, type: meta.type });
    }, [strings]);

    const setValue = useCallback((fieldName: string, value: any) => {
        touchedRef.current.add(fieldName);
        const next = { ...valuesRef.current, [fieldName]: value };
        // Inicio -> fin: si el fin falta o ya no es posterior, se mueve a inicio + 1 h (igual que el calendario).
        if (fieldName === 'startsAt' && 'endsAt' in next) {
            const advanced = nextEndAfterStartChange(value, next.endsAt);
            if (advanced) { next.endsAt = advanced; touchedRef.current.add('endsAt'); }
        }
        valuesRef.current = next;
        setValues(next);
        setErrors((prev) => {
            const problem = validateOn === 'change' ? validateOne(fieldName, next) : null;
            if (problem) return { ...prev, [fieldName]: problem };
            if (!(fieldName in prev)) return prev;
            const { [fieldName]: _gone, ...rest } = prev;
            return rest;
        });
        if (status === 'error' || status === 'success') setStatus('idle');
    }, [status, validateOn, validateOne]);

    const blur = useCallback((fieldName: string) => {
        if (validateOn === 'submit') return;
        const problem = validateOne(fieldName, valuesRef.current);
        setErrors((prev) => {
            if (problem) return prev[fieldName] === problem ? prev : { ...prev, [fieldName]: problem };
            if (!(fieldName in prev)) return prev;
            const { [fieldName]: _gone, ...rest } = prev;
            return rest;
        });
    }, [validateOn, validateOne]);

    const register = useCallback((fieldName: string, meta: FieldMeta) => {
        metaRef.current.set(fieldName, meta);
        return () => { metaRef.current.delete(fieldName); };
    }, []);

    // Zona de las horas del formulario: la del campo `timeZone` si existe; si no, la del navegador.
    const timeZone = (typeof values.timeZone === 'string' && values.timeZone) || browserTimeZone();

    const buildSubmission = (): Record<string, any> => {
        const submission: Record<string, any> = { ...valuesRef.current, timeZone, timezone: timeZone, submittedAt: new Date().toISOString() };
        for (const field of fields) {
            if (field?.type !== 'datetime-local' || !field?.name) continue;
            const raw = String(valuesRef.current[field.name] ?? '').trim();
            const parsed = raw ? zonedLocalToDate(raw, timeZone) : null;
            if (!raw || !parsed || Number.isNaN(parsed.getTime())) continue;
            submission[field.name] = parsed.toISOString();
            submission[`${field.name}Local`] = raw;
            submission[`${field.name}TimeZone`] = timeZone;
        }
        return submission;
    };

    const submit = async () => {
        const all = valuesRef.current;
        const list = Array.from(metaRef.current.entries()).map(([fieldName, meta]) => ({ name: fieldName, label: meta.label, rules: meta.rules, type: meta.type }));
        const found = validateFields(list, all, strings);
        // Fin posterior al inicio (campos startsAt / endsAt): el mismo aviso en el campo del fin.
        if (!found.endsAt && metaRef.current.has('endsAt') && !isEndAfterStart(all.startsAt, all.endsAt)) found.endsAt = strings.endBeforeStart;
        if (Object.keys(found).length > 0) {
            setErrors(found);
            setStatus('idle');
            setErrorMessage(undefined);
            if (typeof window !== 'undefined') window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
            return;
        }
        setErrors({});
        setErrorMessage(undefined);
        setStatus('loading');
        const outcome = await env.run(raw.onSubmit, null, { formData: buildSubmission() });
        if (outcome.ok) {
            setStatus(r.successMessage ? 'success' : 'idle');
            if (r.resetOnSuccess) { touchedRef.current.clear(); setValues(buildDefaults(fields)); }
        } else if (outcome.handled) {
            setStatus('idle');
        } else {
            setStatus('error');
            setErrorMessage(outcome.error || strings.error);
        }
    };

    const buildMountContext = (field: any) => {
        const fieldName = String(field?.name || 'value');
        const setterName = field.contextSetter || `set${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1)}`;
        const all = valuesRef.current;
        const iso = (value: any) => { const d = new Date(String(value ?? '')); return String(value ?? '').trim() && !Number.isNaN(d.getTime()) ? d.toISOString() : String(value ?? ''); };
        const startsAt = all.startsAt || env.context?.startsAt;
        const endsAt = all.endsAt || env.context?.endsAt;
        return {
            ...env.context,
            formData: all,
            eventTitle: all.title || env.context?.eventTitle,
            startsAt, endsAt, startsAtIso: iso(startsAt), endsAtIso: iso(endsAt), timeZone,
            currentLocation: all.location || env.context?.currentLocation || '',
            [setterName]: (value: any) => setValue(fieldName, value),
        };
    };

    const ctx = useMemo<FormContextType>(() => ({ values, errors, setValue, blur, register }), [values, errors, setValue, blur, register]);

    return (
        <FormContext.Provider value={ctx}>
            <div ref={rootRef}>
                <FormShell
                    status={status}
                    errorMessage={errorMessage}
                    successMessage={status === 'success' ? text(r.successMessage) : undefined}
                    submitLabel={text(r.submitLabel)}
                    cancelLabel={raw.onCancel ? text(r.cancelLabel) ?? strings.cancel : undefined}
                    onSubmit={() => { void submit(); }}
                    onCancel={raw.onCancel ? () => { void env.run(raw.onCancel, null); } : undefined}
                    gap={r.gap}
                >
                    {fields.map((field, index) => {
                        const node = fieldToNode(field);
                        const props = coerceProps(node.type, node.props);
                        const control = <FieldNode key={`f-${index}`} type={node.type} raw={node.props} r={props} env={env} />;
                        if (!field.mountPoint) return control;
                        if (field.mountPoint === 'EVENT_LOCATION_BUILDER') {
                            const recipients = [env.context?.to, env.context?.cc].flatMap((list) => (Array.isArray(list) ? list : [])).filter((e): e is string => typeof e === 'string');
                            return <EventLocationField key={`f-${index}`} control={control} fieldName={String(field.name || 'location')} values={values} setValue={setValue} recipients={recipients} />;
                        }
                        const mount = <ExtensionLoader mountPoint={field.mountPoint} context={buildMountContext(field)} />;
                        return field.mountInline
                            ? <div key={`f-${index}`} className="flex items-end gap-2"><div className="min-w-0 flex-1">{control}</div><div className="shrink-0">{mount}</div></div>
                            : <div key={`f-${index}`} className="space-y-1">{control}<div>{mount}</div></div>;
                    })}
                    {env.renderChildren(children)}
                </FormShell>
            </div>
        </FormContext.Provider>
    );
}
