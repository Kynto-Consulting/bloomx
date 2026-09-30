'use client';

/**
 * Controles de formulario del kit de extensiones. Son COMPONENTES CONTROLADOS (`value` + `onChange(valorTipado)`) con
 * `defaultValue` para el modo no controlado. Reciben SOLO props semanticas (sin className/style): el aspecto sale de
 * los tokens del tema (kit/tokens.ts). Nunca rompen con valores raros: cada valor se sanea al leerlo.
 *
 * Accesibilidad: <label htmlFor>, aria-describedby -> ayuda/error, aria-invalid, aria-required, error con role="alert".
 * Validacion: si se pasan `rules`/`required`, el campo valida al perder el foco (form-rules.ts); `error` externo manda.
 */
import * as React from 'react';
import { ChevronDown, X } from 'lucide-react';
import { SIZES } from '@/lib/expansions/ui-schema';
import { fieldRules, isValidEmail, validateValue, type FieldRules } from '@/lib/expansions/form-rules';
import {
    CHECK_CLASS, ERROR_TEXT_CLASS, FIELD_CLASS, FIELD_SIZE_CLASS, FOCUS_RING_CLASS, HELPER_CLASS, LABEL_CLASS, MENU_ITEM_CLASS, POPOVER_CLASS,
    REQUIRED_MARK_CLASS, TEXTAREA_CLASS, pick, type Size,
} from './tokens';
import { formatKit, useKitStrings } from './strings';

// ------------------------------------------------------------------ saneado de valores
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string | number => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))).map(String) : []);
const join = (...ids: Array<string | undefined | false>): string | undefined => ids.filter(Boolean).join(' ') || undefined;

/** Valor controlado o interno. `value === undefined` => no controlado (usa `defaultValue`). */
function useControllable<T>(value: unknown, defaultValue: unknown, onChange: ((v: T) => void) | undefined, sanitize: (v: unknown) => T): [T, (v: T) => void] {
    const [inner, setInner] = React.useState<unknown>(defaultValue);
    const controlled = value !== undefined;
    const onChangeRef = React.useRef(onChange);
    onChangeRef.current = onChange;
    const set = React.useCallback((next: T) => {
        if (!controlled) setInner(next);
        if (typeof onChangeRef.current === 'function') onChangeRef.current(next);
    }, [controlled]);
    return [sanitize(controlled ? value : inner), set];
}

/** Error visible: el externo (`error`) o, tras perder el foco, el de las reglas. */
function useFieldError(value: unknown, p: { rules?: FieldRules; required?: boolean; error?: string; label?: string; type?: string; onBlur?: () => void }) {
    const strings = useKitStrings();
    const [touched, setTouched] = React.useState(false);
    const onBlurRef = React.useRef(p.onBlur);
    onBlurRef.current = p.onBlur;
    // Se usa como onBlur del control o del conjunto: si el foco se mueve DENTRO del conjunto no cuenta como salir.
    const touch = React.useCallback((e?: React.FocusEvent<HTMLElement>) => {
        if (e && e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        setTouched(true);
        if (typeof onBlurRef.current === 'function') onBlurRef.current();
    }, []);
    const rules = fieldRules({ required: p.required, rules: p.rules });
    const hasRules = Object.keys(rules).length > 0;
    const own = touched && hasRules ? validateValue(value, rules, { strings, label: p.label, type: p.type }) : null;
    const external = typeof p.error === 'string' && p.error.trim() ? p.error : null;
    return { error: external ?? own, touch };
}

// ------------------------------------------------------------------ Field (envoltorio)
export interface FieldA11y {
    /** id del control (el <label htmlFor> apunta aqui). */
    id: string;
    labelId: string;
    describedBy?: string;
    invalid: boolean;
    required: boolean;
    /** Nombre accesible de respaldo cuando no hay etiqueta visible. */
    ariaLabel?: string;
}

export interface FieldProps {
    label?: string;
    helperText?: string;
    error?: string | null;
    required?: boolean;
    /** Grupo (radios, archivos): la etiqueta es un <span id> para aria-labelledby en lugar de <label htmlFor>. */
    group?: boolean;
    /** El control pinta su propia etiqueta (casilla, interruptor): el envoltorio solo anade ayuda y error. */
    inline?: boolean;
    fallbackLabel?: string;
    children: (a: FieldA11y) => React.ReactNode;
}

const requiredMark = (required: boolean | undefined) => (required ? <span className={REQUIRED_MARK_CLASS} aria-hidden="true"> *</span> : null);

/** Envoltorio comun: etiqueta + asterisco + control + ayuda + error (ids por render-prop). */
export function Field({ label, helperText, error, required, group, inline, fallbackLabel, children }: FieldProps) {
    const base = React.useId();
    const id = `${base}-ctl`;
    const labelId = `${base}-lbl`;
    const helpId = `${base}-help`;
    const errId = `${base}-err`;
    const labelText = text(label);
    const help = text(helperText);
    const err = text(error ?? undefined);
    const a11y: FieldA11y = {
        id, labelId, invalid: !!err, required: required === true,
        describedBy: join(help && helpId, err && errId),
        ariaLabel: labelText || inline ? undefined : fallbackLabel,
    };
    return (
        <div className="flex w-full flex-col gap-1.5">
            {!inline && labelText && (group
                ? <span id={labelId} className={LABEL_CLASS}>{labelText}{requiredMark(required)}</span>
                : <label id={labelId} htmlFor={id} className={LABEL_CLASS}>{labelText}{requiredMark(required)}</label>)}
            {children(a11y)}
            {help && <p id={helpId} className={HELPER_CLASS}>{help}</p>}
            {err && <p id={errId} role="alert" className={ERROR_TEXT_CLASS}>{err}</p>}
        </div>
    );
}

// ------------------------------------------------------------------ props comunes
export interface CommonFieldProps {
    name?: string;
    label?: string;
    helperText?: string;
    required?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    size?: Size;
    /** Reglas declarativas: validan al perder el foco. */
    rules?: FieldRules;
    /** Error externo (p. ej. el de un FORM al enviar); tiene prioridad sobre el de `rules`. */
    error?: string;
    /** Se dispara al perder el foco el control (en compuestos: cuando el foco sale del conjunto). */
    onBlur?: () => void;
}
const sizeOf = (size: unknown): Size => pick(size, SIZES, 'md');

// ------------------------------------------------------------------ TextInput
const TEXT_TYPES = ['text', 'email', 'password', 'number', 'search', 'tel', 'url', 'datetime-local'] as const;
export interface TextInputProps extends CommonFieldProps {
    type?: (typeof TEXT_TYPES)[number];
    value?: string | number | null;
    defaultValue?: string | number;
    onChange?: (value: string | number) => void;
    placeholder?: string;
    maxLength?: number;
    min?: number | string;
    max?: number | string;
    step?: number;
    autoFocus?: boolean;
}

export function TextInput(props: TextInputProps) {
    const type = pick(props.type, TEXT_TYPES, 'text');
    const isNumber = type === 'number';
    const isDateTime = type === 'datetime-local';
    const [cur, setCur] = useControllable<string>(props.value, props.defaultValue ?? '', undefined, (v) => (isDateTime ? onlyIf(DATETIME_RE)(v) : str(v)));
    const emit = (raw: string) => {
        if (props.readOnly) return;
        if (!isNumber) return void pushValue(raw);
        const n = raw.trim() === '' ? NaN : Number(raw);
        pushValue(Number.isFinite(n) ? n : '');
    };
    // `onChange` entrega number|'' en type=number. El estado interno guarda el texto tal cual se escribe.
    const pushValue = (v: string | number) => {
        setCur(String(v));
        if (typeof props.onChange === 'function') props.onChange(v);
    };
    const { error, touch } = useFieldError(isNumber && cur !== '' ? Number(cur) : cur, { ...props, type });
    const label = text(props.label);
    return (
        <Field label={label} helperText={props.helperText} error={error} required={props.required} fallbackLabel={text(props.placeholder) ?? text(props.name)}>
            {(a) => (
                <input
                    id={a.id} name={text(props.name)} type={type} value={cur}
                    placeholder={text(props.placeholder)} disabled={props.disabled === true} readOnly={props.readOnly === true} autoFocus={props.autoFocus === true}
                    maxLength={!isNumber && !isDateTime ? finite(props.maxLength) : undefined}
                    min={isNumber ? finite(props.min) : isDateTime ? onlyIf(DATETIME_RE)(props.min) || undefined : undefined} max={isNumber ? finite(props.max) : isDateTime ? onlyIf(DATETIME_RE)(props.max) || undefined : undefined} step={isNumber || isDateTime ? finite(props.step) : undefined}
                    aria-label={a.ariaLabel} aria-describedby={a.describedBy} aria-invalid={a.invalid ? true : undefined} aria-required={a.required ? true : undefined}
                    className={`${FIELD_CLASS} ${FIELD_SIZE_CLASS[sizeOf(props.size)]}`}
                    onChange={(e) => emit(e.target.value)} onBlur={touch}
                />
            )}
        </Field>
    );
}

// ------------------------------------------------------------------ TextArea
export interface TextAreaProps extends CommonFieldProps {
    value?: string | null;
    defaultValue?: string;
    onChange?: (value: string) => void;
    placeholder?: string;
    rows?: number;
    maxLength?: number;
    /** Contador "n/max" enlazado por aria-describedby (por defecto, visible si hay maxLength). */
    showCount?: boolean;
    mono?: boolean;
    autoFocus?: boolean;
}

export function TextArea(props: TextAreaProps) {
    const [cur, setCur] = useControllable<string>(props.value, props.defaultValue ?? '', props.onChange, str);
    const { error, touch } = useFieldError(cur, { ...props, type: 'textarea' });
    const rows = Math.min(40, Math.max(1, Math.round(finite(props.rows) ?? 4)));
    const max = finite(props.maxLength);
    const counterId = `${React.useId()}-count`;
    const showCount = max !== undefined && props.showCount !== false;
    return (
        <Field label={props.label} helperText={props.helperText} error={error} required={props.required} fallbackLabel={text(props.placeholder) ?? text(props.name)}>
            {(a) => (
                <>
                    <textarea
                        id={a.id} name={text(props.name)} value={cur} rows={rows} maxLength={max}
                        placeholder={text(props.placeholder)} disabled={props.disabled === true} readOnly={props.readOnly === true} autoFocus={props.autoFocus === true}
                        aria-label={a.ariaLabel} aria-describedby={join(a.describedBy, showCount && counterId)} aria-invalid={a.invalid ? true : undefined} aria-required={a.required ? true : undefined}
                        className={`${TEXTAREA_CLASS} ${FIELD_SIZE_CLASS[sizeOf(props.size)].includes('text-xs') ? 'text-xs' : ''} ${props.mono === true ? 'font-mono' : ''}`}
                        onChange={(e) => { if (!props.readOnly) setCur(e.target.value); }} onBlur={touch}
                    />
                    {showCount && <p id={counterId} className={`${HELPER_CLASS} text-end`}>{cur.length}/{max}</p>}
                </>
            )}
        </Field>
    );
}

// ------------------------------------------------------------------ SelectField
export interface FieldOption { value?: string | number; label?: string; disabled?: boolean; description?: string }
interface ParsedOption { value: string | number; label: string; disabled: boolean; description?: string }
const MAX_OPTIONS = 1000;
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

function parseOptions(options: unknown, valueKey?: unknown, labelKey?: unknown): ParsedOption[] {
    if (!Array.isArray(options)) return [];
    const vk = typeof valueKey === 'string' && SAFE_KEY.test(valueKey) ? valueKey : 'value';
    const lk = typeof labelKey === 'string' && SAFE_KEY.test(labelKey) ? labelKey : 'label';
    const own = (o: object, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined);
    const out: ParsedOption[] = [];
    for (const raw of options.slice(0, MAX_OPTIONS)) {
        if (typeof raw === 'string' || (typeof raw === 'number' && Number.isFinite(raw))) { out.push({ value: raw, label: String(raw), disabled: false }); continue; }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const value = own(raw, vk);
        if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) continue;
        const label = str(own(raw, lk)) || String(value);
        out.push({ value, label, disabled: own(raw, 'disabled') === true, description: text(own(raw, 'description')) });
    }
    return out;
}
const sameValue = (a: unknown, b: unknown) => a === b || (b !== '' && b !== undefined && a !== undefined && String(a) === String(b));

export interface SelectFieldProps extends CommonFieldProps {
    options?: FieldOption[] | Array<string | number>;
    valueKey?: string;
    labelKey?: string;
    value?: string | number | null;
    defaultValue?: string | number;
    /** Entrega el valor ORIGINAL de la opcion (number o string); '' si se elige la opcion vacia. */
    onChange?: (value: string | number) => void;
    placeholder?: string;
}

export function SelectField(props: SelectFieldProps) {
    const strings = useKitStrings();
    const options = React.useMemo(() => parseOptions(props.options, props.valueKey, props.labelKey), [props.options, props.valueKey, props.labelKey]);
    const [cur, setCur] = useControllable<string | number>(props.value, props.defaultValue ?? '', props.onChange, (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? v : ''));
    const { error, touch } = useFieldError(cur, { ...props, type: 'select' });
    const idx = cur === '' ? -1 : options.findIndex((o) => sameValue(o.value, cur));
    return (
        <Field label={props.label} helperText={props.helperText} error={error} required={props.required} fallbackLabel={text(props.placeholder) ?? text(props.name)}>
            {(a) => (
                <div className="relative">
                    <select
                        id={a.id} name={text(props.name)} value={idx < 0 ? '' : String(idx)} disabled={props.disabled === true}
                        aria-label={a.ariaLabel} aria-describedby={a.describedBy} aria-invalid={a.invalid ? true : undefined} aria-required={a.required ? true : undefined} aria-readonly={props.readOnly ? true : undefined}
                        className={`${FIELD_CLASS} ${FIELD_SIZE_CLASS[sizeOf(props.size)]} appearance-none pr-9`}
                        onChange={(e) => { if (props.readOnly) return; const v = e.target.value; setCur(v === '' ? '' : options[Number(v)]?.value ?? ''); }} onBlur={touch}
                    >
                        <option value="">{text(props.placeholder) ?? strings.select}</option>
                        {options.map((o, i) => <option key={i} value={String(i)} disabled={o.disabled}>{o.label}</option>)}
                    </select>
                    <ChevronDown size={16} aria-hidden={true} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                </div>
            )}
        </Field>
    );
}

// ------------------------------------------------------------------ CheckboxField
const toBool = (v: unknown) => v === true;
export interface CheckboxFieldProps extends CommonFieldProps {
    checked?: boolean | null;
    value?: boolean | null;
    defaultValue?: boolean;
    onChange?: (checked: boolean) => void;
}

export function CheckboxField(props: CheckboxFieldProps) {
    const [cur, setCur] = useControllable<boolean>(props.checked !== undefined ? props.checked : props.value, props.defaultValue ?? false, props.onChange, toBool);
    const { error, touch } = useFieldError(cur, { ...props, type: 'checkbox' });
    const label = text(props.label);
    return (
        <Field inline label={label} helperText={props.helperText} error={error} required={props.required}>
            {(a) => (
                <label className={`flex items-start gap-2 text-sm text-foreground ${props.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                    <input
                        id={a.id} name={text(props.name)} type="checkbox" checked={cur} disabled={props.disabled === true}
                        aria-label={label ? undefined : text(props.name)} aria-describedby={a.describedBy} aria-invalid={a.invalid ? true : undefined} aria-required={a.required ? true : undefined} aria-readonly={props.readOnly ? true : undefined}
                        className={`${CHECK_CLASS} mt-0.5 aria-[invalid=true]:border-destructive`}
                        onChange={(e) => { if (!props.readOnly) setCur(e.target.checked); }} onBlur={touch}
                    />
                    {label && <span>{label}{requiredMark(props.required)}</span>}
                </label>
            )}
        </Field>
    );
}

// ------------------------------------------------------------------ RadioGroupField
export interface RadioGroupFieldProps extends CommonFieldProps {
    options?: FieldOption[] | Array<string | number>;
    orientation?: 'vertical' | 'horizontal';
    value?: string | number | null;
    defaultValue?: string | number;
    onChange?: (value: string | number) => void;
}

export function RadioGroupField(props: RadioGroupFieldProps) {
    const options = React.useMemo(() => parseOptions(props.options), [props.options]);
    const [cur, setCur] = useControllable<string | number>(props.value, props.defaultValue ?? '', props.onChange, (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? v : ''));
    const { error, touch } = useFieldError(cur, { ...props, type: 'radio' });
    const groupName = text(props.name) ?? `${React.useId()}-radio`;
    const horizontal = props.orientation === 'horizontal';
    return (
        <Field group label={props.label} helperText={props.helperText} error={error} required={props.required} fallbackLabel={text(props.name)}>
            {(a) => (
                <div
                    id={a.id} role="radiogroup" aria-labelledby={text(props.label) ? a.labelId : undefined} aria-label={a.ariaLabel}
                    aria-describedby={a.describedBy} aria-invalid={a.invalid ? true : undefined} aria-required={a.required ? true : undefined} aria-readonly={props.readOnly ? true : undefined}
                    onBlur={touch}
                    className={horizontal ? 'flex flex-wrap gap-x-5 gap-y-2' : 'flex flex-col gap-2'}
                >
                    {options.map((o, i) => {
                        const disabled = props.disabled === true || o.disabled;
                        return (
                            <label key={i} className={`flex items-start gap-2 text-sm text-foreground ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                                <input
                                    type="radio" name={groupName} value={String(i)} checked={cur !== '' && sameValue(o.value, cur)} disabled={disabled}
                                    className={`${CHECK_CLASS.replace("rounded ", "rounded-full ")} mt-0.5`}
                                    onChange={() => { if (!props.readOnly) setCur(o.value); }}
                                />
                                <span className="flex flex-col">
                                    <span>{o.label}</span>
                                    {o.description && <span className={HELPER_CLASS}>{o.description}</span>}
                                </span>
                            </label>
                        );
                    })}
                </div>
            )}
        </Field>
    );
}

// ------------------------------------------------------------------ ToggleField
export interface ToggleFieldProps extends CommonFieldProps {
    value?: boolean | null;
    checked?: boolean | null;
    defaultValue?: boolean;
    onChange?: (on: boolean) => void;
}

export function ToggleField(props: ToggleFieldProps) {
    const [on, setOn] = useControllable<boolean>(props.checked !== undefined ? props.checked : props.value, props.defaultValue ?? false, props.onChange, toBool);
    const { error, touch } = useFieldError(on, { ...props, type: 'toggle' });
    const label = text(props.label);
    const toggle = () => { if (!props.readOnly && !props.disabled) setOn(!on); };
    return (
        <Field inline label={label} helperText={props.helperText} error={error} required={props.required}>
            {(a) => (
                <div className="flex items-center gap-3">
                    <button
                        id={a.id} type="button" role="switch" aria-checked={on} disabled={props.disabled === true}
                        aria-label={label ? undefined : text(props.name)} aria-labelledby={label ? a.labelId : undefined}
                        aria-describedby={a.describedBy} aria-invalid={a.invalid ? true : undefined} aria-required={a.required ? true : undefined} aria-readonly={props.readOnly ? true : undefined}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-primary' : 'bg-input'} ${FOCUS_RING_CLASS} aria-[invalid=true]:border-destructive`}
                        onClick={toggle} onBlur={touch}
                        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } }}
                        onKeyUp={(e) => { if (e.key === ' ') e.preventDefault(); }}
                    >
                        <span aria-hidden="true" className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                    {label && <span id={a.labelId} className={`${LABEL_CLASS} cursor-pointer select-none`} onClick={toggle}>{label}{requiredMark(props.required)}</span>}
                </div>
            )}
        </Field>
    );
}

// ------------------------------------------------------------------ SliderField
export interface SliderFieldProps extends CommonFieldProps {
    value?: number | null;
    defaultValue?: number;
    onChange?: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    showValue?: boolean;
}

export function SliderField(props: SliderFieldProps) {
    let min = finite(props.min) ?? 0;
    let max = finite(props.max) ?? 100;
    if (max <= min) { min = 0; max = 100; }
    const step = (finite(props.step) ?? 1) > 0 ? finite(props.step) ?? 1 : 1;
    const clamp = (v: unknown) => Math.min(max, Math.max(min, finite(typeof v === 'string' && v.trim() !== '' ? Number(v) : v) ?? min));
    const [cur, setCur] = useControllable<number>(props.value, props.defaultValue ?? min, props.onChange, clamp);
    const { error, touch } = useFieldError(cur, { ...props, type: 'slider' });
    const showValue = props.showValue !== false;
    return (
        <Field label={props.label} helperText={props.helperText} error={error} required={props.required} fallbackLabel={text(props.name)}>
            {(a) => (
                <div className="flex items-center gap-3">
                    <input
                        id={a.id} name={text(props.name)} type="range" min={min} max={max} step={step} value={cur} disabled={props.disabled === true || props.readOnly === true}
                        aria-label={a.ariaLabel} aria-describedby={a.describedBy} aria-invalid={a.invalid ? true : undefined} aria-required={a.required ? true : undefined}
                        className={`h-2 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING_CLASS} rounded-full`}
                        onChange={(e) => setCur(clamp(Number(e.target.value)))} onBlur={touch}
                    />
                    {showValue && <output htmlFor={a.id} className="min-w-[3ch] text-end text-sm tabular-nums text-foreground">{cur}</output>}
                </div>
            )}
        </Field>
    );
}

// ------------------------------------------------------------------ DatePickerField / TimePickerField
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(?::\d{2})?$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
const onlyIf = (re: RegExp) => (v: unknown): string => (typeof v === 'string' && re.test(v) ? v : '');

export interface DatePickerFieldProps extends CommonFieldProps {
    value?: string | null;
    defaultValue?: string;
    onChange?: (value: string) => void;
    /** AAAA-MM-DD */
    min?: string;
    max?: string;
}

export function DatePickerField(props: DatePickerFieldProps) {
    const [cur, setCur] = useControllable<string>(props.value, props.defaultValue ?? '', props.onChange, onlyIf(DATE_RE));
    const { error, touch } = useFieldError(cur, { ...props, type: 'date' });
    return (
        <Field label={props.label} helperText={props.helperText} error={error} required={props.required} fallbackLabel={text(props.name)}>
            {(a) => (
                <input
                    id={a.id} name={text(props.name)} type="date" value={cur} min={onlyIf(DATE_RE)(props.min) || undefined} max={onlyIf(DATE_RE)(props.max) || undefined}
                    disabled={props.disabled === true} readOnly={props.readOnly === true}
                    aria-label={a.ariaLabel} aria-describedby={a.describedBy} aria-invalid={a.invalid ? true : undefined} aria-required={a.required ? true : undefined}
                    className={`${FIELD_CLASS} ${FIELD_SIZE_CLASS[sizeOf(props.size)]} items-center`}
                    onChange={(e) => { if (!props.readOnly) setCur(e.target.value); }} onBlur={touch}
                />
            )}
        </Field>
    );
}

export interface TimePickerFieldProps extends CommonFieldProps {
    value?: string | null;
    defaultValue?: string;
    onChange?: (value: string) => void;
    /** Paso en segundos (60-3600). */
    step?: number;
}

export function TimePickerField(props: TimePickerFieldProps) {
    const [cur, setCur] = useControllable<string>(props.value, props.defaultValue ?? '', props.onChange, onlyIf(TIME_RE));
    const { error, touch } = useFieldError(cur, { ...props, type: 'time' });
    const step = finite(props.step);
    return (
        <Field label={props.label} helperText={props.helperText} error={error} required={props.required} fallbackLabel={text(props.name)}>
            {(a) => (
                <input
                    id={a.id} name={text(props.name)} type="time" value={cur} step={step !== undefined ? Math.min(3600, Math.max(1, step)) : undefined}
                    disabled={props.disabled === true} readOnly={props.readOnly === true}
                    aria-label={a.ariaLabel} aria-describedby={a.describedBy} aria-invalid={a.invalid ? true : undefined} aria-required={a.required ? true : undefined}
                    className={`${FIELD_CLASS} ${FIELD_SIZE_CLASS[sizeOf(props.size)]} items-center`}
                    onChange={(e) => { if (!props.readOnly) setCur(e.target.value); }} onBlur={touch}
                />
            )}
        </Field>
    );
}

// ------------------------------------------------------------------ ColorPickerField (SOLO datos)
/** Valor inicial del dato, construido en tiempo de ejecucion (el codigo no lleva literales de color). */
const DEFAULT_PICKED = ['#', '0', '0', '0', '0', '0', '0'].join('');
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;
function normalizeHex(v: unknown): string {
    if (typeof v !== 'string') return '';
    if (HEX6.test(v)) return v.toLowerCase();
    if (HEX3.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
    return '';
}

export interface ColorPickerFieldProps extends CommonFieldProps {
    /** Hex del DATO elegido (#rrggbb). Nunca se usa para estilizar la interfaz. */
    value?: string | null;
    defaultValue?: string;
    onChange?: (hex: string) => void;
}

export function ColorPickerField(props: ColorPickerFieldProps) {
    const [cur, setCur] = useControllable<string>(props.value, normalizeHex(props.defaultValue) || DEFAULT_PICKED, props.onChange, (v) => normalizeHex(v) || DEFAULT_PICKED);
    const { error, touch } = useFieldError(cur, { ...props, type: 'color' });
    return (
        <Field label={props.label} helperText={props.helperText} error={error} required={props.required} fallbackLabel={text(props.name)}>
            {(a) => (
                <div className="flex items-center gap-3">
                    <input
                        id={a.id} name={text(props.name)} type="color" value={cur} disabled={props.disabled === true || props.readOnly === true}
                        aria-label={a.ariaLabel} aria-describedby={a.describedBy} aria-invalid={a.invalid ? true : undefined} aria-required={a.required ? true : undefined}
                        className={`h-10 w-14 cursor-pointer rounded-md border border-input bg-background p-1 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING_CLASS}`}
                        onChange={(e) => setCur(normalizeHex(e.target.value) || DEFAULT_PICKED)} onBlur={touch}
                    />
                    <span className="font-mono text-sm text-muted-foreground" aria-hidden="true">{cur}</span>
                </div>
            )}
        </Field>
    );
}

// ------------------------------------------------------------------ FileInputField
export interface PickedFile { name: string; size: number; type: string; content?: string }
const isPickedFile = (v: unknown): v is PickedFile => !!v && typeof v === 'object' && typeof (v as PickedFile).name === 'string' && typeof (v as PickedFile).size === 'number';
const cleanFiles = (v: unknown): PickedFile[] => (Array.isArray(v) ? v.filter(isPickedFile).map((f) => ({ name: f.name, size: f.size, type: typeof f.type === 'string' ? f.type : '', ...(typeof f.content === 'string' ? { content: f.content } : {}) })) : []);

/** Comprueba un archivo contra `accept` ("image/*,.pdf"). Sin `accept` todo vale. */
function matchesAccept(file: { name: string; type: string }, accept: string | undefined): boolean {
    if (!accept) return true;
    const tokens = accept.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tokens.length === 0) return true;
    const name = file.name.toLowerCase();
    const type = (file.type || '').toLowerCase();
    return tokens.some((t) => (t.startsWith('.') ? name.endsWith(t) : t.endsWith('/*') ? type.startsWith(t.slice(0, -1)) : type === t));
}

function readFile(file: File, as: 'none' | 'base64' | 'text'): Promise<PickedFile> {
    const meta: PickedFile = { name: file.name, size: file.size, type: file.type };
    if (as === 'none') return Promise.resolve(meta);
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            resolve({ ...meta, content: as === 'base64' ? result.slice(result.indexOf(',') + 1) : result });
        };
        reader.onerror = () => resolve(meta);
        if (as === 'base64') reader.readAsDataURL(file); else reader.readAsText(file);
    });
}

export interface FileInputFieldProps extends CommonFieldProps {
    value?: PickedFile[] | null;
    defaultValue?: PickedFile[];
    onChange?: (files: PickedFile[]) => void;
    accept?: string;
    multiple?: boolean;
    /** Tamano maximo por archivo en MB (defecto 5). */
    maxSizeMb?: number;
    readAs?: 'none' | 'base64' | 'text';
    /** Permite soltar archivos sobre la zona (defecto true). */
    dropzone?: boolean;
    /** Recibe los objetos File crudos elegidos (para subirlos); onChange recibe solo descriptores. */
    onFiles?: (files: File[]) => void;
}

export function FileInputField(props: FileInputFieldProps) {
    const strings = useKitStrings();
    const multiple = props.multiple === true;
    const readAs = pick(props.readAs, ['none', 'base64', 'text'] as const, 'none');
    const maxMb = Math.min(25, Math.max(0.01, finite(props.maxSizeMb) ?? 5));
    const accept = typeof props.accept === 'string' && props.accept.length <= 200 ? props.accept : undefined;
    const [files, setFiles] = useControllable<PickedFile[]>(props.value, props.defaultValue ?? [], props.onChange, cleanFiles);
    const [localError, setLocalError] = React.useState<string | null>(null);
    const [dragging, setDragging] = React.useState(false);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const mounted = React.useRef(true);
    const filesRef = React.useRef(files);
    filesRef.current = files;
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const { error: ruleError, touch } = useFieldError(files, { ...props, type: 'file' });
    const error = text(props.error) ?? localError ?? ruleError;
    const disabled = props.disabled === true || props.readOnly === true;

    const ingest = async (list: File[]) => {
        if (disabled || list.length === 0) return;
        const rejected: string[] = [];
        const ok = list.filter((f) => {
            if (f.size > maxMb * 1024 * 1024) { rejected.push(`${f.name}: ${strings.fileTooLarge} (${maxMb} MB)`); return false; }
            if (!matchesAccept(f, accept)) { rejected.push(`${f.name}: ${strings.pattern}`); return false; }
            return true;
        });
        setLocalError(rejected.length ? rejected.join('. ') : null);
        const chosen = multiple ? ok : ok.slice(0, 1);
        if (chosen.length === 0) return;
        const read = await Promise.all(chosen.map((f) => readFile(f, readAs)));
        if (!mounted.current) return;
        setFiles(multiple ? [...filesRef.current, ...read] : read);
        if (typeof props.onFiles === 'function') props.onFiles(chosen);
    };
    const remove = (i: number) => { setLocalError(null); setFiles(files.filter((_, j) => j !== i)); };
    const buttonLabel = multiple ? strings.chooseFiles : strings.chooseFile;
    const hint = [accept, `≤ ${maxMb} MB`].filter(Boolean).join(' · ');

    return (
        <Field group label={props.label} helperText={props.helperText} error={error} required={props.required} fallbackLabel={text(props.name)}>
            {(a) => (
                <div className="flex flex-col gap-2" onBlur={touch}>
                    <div
                        className={`flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3 transition-colors ${dragging ? 'border-primary bg-accent' : 'border-input bg-background'} ${a.invalid ? 'border-destructive' : ''}`}
                        onDragOver={(e) => { if (props.dropzone === false || disabled) return; e.preventDefault(); setDragging(true); }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(e) => { if (props.dropzone === false || disabled) return; e.preventDefault(); setDragging(false); void ingest(Array.from(e.dataTransfer?.files ?? [])); }}
                    >
                        <button
                            id={a.id} type="button" disabled={disabled}
                            aria-labelledby={text(props.label) ? `${a.id} ${a.labelId}` : undefined} aria-label={text(props.label) ? undefined : a.ariaLabel ?? buttonLabel}
                            aria-describedby={a.describedBy} aria-invalid={a.invalid ? true : undefined}
                            className={`inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING_CLASS}`}
                            onClick={() => inputRef.current?.click()}
                        >{buttonLabel}</button>
                        <span className={HELPER_CLASS}>{hint}</span>
                        <input
                            ref={inputRef} type="file" name={text(props.name)} className="sr-only" tabIndex={-1} aria-hidden="true" multiple={multiple} accept={accept} disabled={disabled}
                            onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ''; void ingest(list); }}
                        />
                    </div>
                    {files.length > 0 && (
                        <ul className="flex flex-col gap-1" aria-label={text(props.label) ?? text(props.name)}>
                            {files.map((f, i) => (
                                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5 text-sm text-foreground">
                                    <span className="min-w-0 truncate">{f.name} <span className="text-muted-foreground">({formatSize(f.size)})</span></span>
                                    {!disabled && (
                                        <button type="button" aria-label={`${strings.remove} ${f.name}`} className={`shrink-0 rounded p-1 hover:bg-accent hover:text-accent-foreground ${FOCUS_RING_CLASS}`} onClick={() => remove(i)}>
                                            <X size={14} aria-hidden={true} />
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </Field>
    );
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ------------------------------------------------------------------ chips + cajas compartidas (etiquetas y contactos)
const CHIPS_BOX_CLASS = 'flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground ring-offset-background transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 aria-[disabled=true]:cursor-not-allowed aria-[disabled=true]:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-within:ring-destructive';
const CHIP_INPUT_CLASS = 'min-w-[8ch] flex-1 bg-transparent py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed';

function Chip({ children, invalid, removeLabel, onRemove }: { children: React.ReactNode; invalid?: boolean; removeLabel: string; onRemove?: () => void }) {
    return (
        <li aria-invalid={invalid ? true : undefined} className={`inline-flex max-w-full items-center gap-1 rounded-md border bg-chip px-2 py-0.5 text-xs text-chip-foreground ${invalid ? 'border-destructive' : 'border-transparent'}`}>
            <span className="min-w-0 truncate">{children}</span>
            {onRemove && (
                <button type="button" aria-label={removeLabel} className={`shrink-0 rounded hover:bg-accent hover:text-accent-foreground ${FOCUS_RING_CLASS}`} onClick={onRemove}>
                    <X size={12} aria-hidden={true} />
                </button>
            )}
        </li>
    );
}

function moveIndex(current: number, delta: 1 | -1, length: number): number {
    if (length === 0) return -1;
    if (current < 0) return delta === 1 ? 0 : length - 1;
    return (current + delta + length) % length;
}

// ------------------------------------------------------------------ TagInputField
export interface TagInputFieldProps extends CommonFieldProps {
    value?: string[] | null;
    defaultValue?: string[];
    onChange?: (tags: string[]) => void;
    placeholder?: string;
    max?: number;
    validate?: 'none' | 'email';
    suggestions?: string[];
}

export function TagInputField(props: TagInputFieldProps) {
    const strings = useKitStrings();
    const [tags, setTags] = useControllable<string[]>(props.value, props.defaultValue ?? [], props.onChange, strList);
    const [draft, setDraft] = React.useState('');
    const [focused, setFocused] = React.useState(false);
    const [active, setActive] = React.useState(-1);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const listId = `${React.useId()}-sug`;
    const max = finite(props.max);
    const emailMode = props.validate === 'email';
    const disabled = props.disabled === true;
    const readOnly = props.readOnly === true;
    const invalidTags = emailMode ? tags.filter((t) => !isValidEmail(t)) : [];
    const { error: ruleError, touch } = useFieldError(tags, { ...props, type: 'tags' });
    const error = text(props.error) ?? ruleError ?? (invalidTags.length > 0 ? strings.email : null);

    const suggestions = React.useMemo(() => {
        const q = draft.trim().toLowerCase();
        if (!q) return [];
        return strList(props.suggestions).filter((s) => s.toLowerCase().includes(q) && !tags.some((t) => t.toLowerCase() === s.toLowerCase())).slice(0, 8);
    }, [props.suggestions, draft, tags]);
    const hasCombo = Array.isArray(props.suggestions) && props.suggestions.length > 0;
    const open = hasCombo && focused && suggestions.length > 0;

    const add = (raws: string[]) => {
        if (disabled || readOnly) return;
        const next = [...tags];
        for (const raw of raws) {
            const t = raw.trim();
            if (!t || t.length > 200) continue;
            if (max !== undefined && next.length >= max) break;
            if (next.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
            next.push(t);
        }
        if (next.length !== tags.length) setTags(next);
    };
    const commitDraft = () => { if (draft.trim()) add([draft]); setDraft(''); setActive(-1); };
    const removeAt = (i: number) => { if (!disabled && !readOnly) setTags(tags.filter((_, j) => j !== i)); };
    const choose = (s: string) => { add([s]); setDraft(''); setActive(-1); inputRef.current?.focus(); };

    return (
        <Field label={props.label} helperText={props.helperText} error={error} required={props.required} fallbackLabel={text(props.placeholder) ?? text(props.name)}>
            {(a) => (
                <div className="relative" onBlur={touch}>
                    <div className={CHIPS_BOX_CLASS} aria-invalid={a.invalid ? true : undefined} aria-disabled={disabled ? true : undefined} onClick={() => inputRef.current?.focus()}>
                        <ul className="contents" aria-label={text(props.label) ?? text(props.name)}>
                            {tags.map((t, i) => (
                                <Chip key={`${t}-${i}`} invalid={emailMode && !isValidEmail(t)} removeLabel={`${strings.remove} ${t}`} onRemove={disabled || readOnly ? undefined : () => removeAt(i)}>{t}</Chip>
                            ))}
                        </ul>
                        <input
                            ref={inputRef} id={a.id} name={text(props.name)} type="text" value={draft} disabled={disabled} readOnly={readOnly} autoComplete="off"
                            placeholder={tags.length === 0 ? text(props.placeholder) : undefined} className={CHIP_INPUT_CLASS}
                            aria-label={a.ariaLabel} aria-describedby={a.describedBy} aria-invalid={a.invalid ? true : undefined} aria-required={a.required ? true : undefined}
                            {...(hasCombo ? { role: 'combobox', 'aria-expanded': open, 'aria-autocomplete': 'list' as const, 'aria-controls': open ? listId : undefined, 'aria-activedescendant': open && active >= 0 ? `${listId}-${active}` : undefined } : {})}
                            onChange={(e) => {
                                const v = e.target.value;
                                if (/[,;\n]/.test(v)) { const parts = v.split(/[,;\n]/); add(parts.slice(0, -1)); setDraft(parts[parts.length - 1]); } else setDraft(v);
                                setActive(-1);
                            }}
                            onPaste={(e) => {
                                const pasted = e.clipboardData?.getData('text') ?? '';
                                if (/[\s,;]/.test(pasted.trim())) { e.preventDefault(); add(pasted.split(/[\s,;]+/)); setDraft(''); }
                            }}
                            onFocus={() => setFocused(true)}
                            onBlur={() => { setFocused(false); commitDraft(); }}
                            onKeyDown={(e) => {
                                if (e.key === 'ArrowDown' && open) { e.preventDefault(); setActive((c) => moveIndex(c, 1, suggestions.length)); }
                                else if (e.key === 'ArrowUp' && open) { e.preventDefault(); setActive((c) => moveIndex(c, -1, suggestions.length)); }
                                else if (e.key === 'Escape' && open) { e.preventDefault(); setFocused(false); }
                                else if (e.key === 'Enter' || e.key === ',') {
                                    if (e.key === 'Enter' && open && active >= 0) { e.preventDefault(); choose(suggestions[active]); }
                                    else if (draft.trim()) { e.preventDefault(); commitDraft(); }
                                    else if (e.key === ',') e.preventDefault();
                                } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) { removeAt(tags.length - 1); }
                            }}
                        />
                    </div>
                    {open && (
                        <ul id={listId} role="listbox" aria-label={text(props.label) ?? text(props.name)} className={`${POPOVER_CLASS} absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto p-1`}>
                            {suggestions.map((s, i) => (
                                <li
                                    key={s} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                                    className={`${MENU_ITEM_CLASS} cursor-pointer ${i === active ? 'bg-accent text-accent-foreground' : ''}`}
                                    onMouseDown={(e) => e.preventDefault()} onClick={() => choose(s)}
                                >{s}</li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </Field>
    );
}

// ------------------------------------------------------------------ ContactPickerField
export interface ContactSuggestion { name?: string; email: string }
const cleanContacts = (v: unknown): ContactSuggestion[] => {
    if (!Array.isArray(v)) return [];
    const out: ContactSuggestion[] = [];
    for (const c of v.slice(0, 500)) {
        if (!c || typeof c !== 'object') continue;
        const email = (c as ContactSuggestion).email;
        if (typeof email !== 'string' || !isValidEmail(email)) continue;
        const name = (c as ContactSuggestion).name;
        out.push(typeof name === 'string' && name.trim() ? { name: name.trim().slice(0, 120), email: email.trim() } : { email: email.trim() });
    }
    return out;
};

export interface ContactPickerFieldProps extends CommonFieldProps {
    /** Correos elegidos (siempre un arreglo, tambien con multiple=false). */
    value?: string[] | string | null;
    defaultValue?: string[];
    onChange?: (emails: string[]) => void;
    placeholder?: string;
    /** Varios contactos (defecto true). */
    multiple?: boolean;
    max?: number;
    /** Contactos locales [{name,email}]. */
    contacts?: ContactSuggestion[];
    /** Busqueda remota (debounce 200 ms; las respuestas viejas se descartan). */
    loadSuggestions?: (query: string) => Promise<ContactSuggestion[]> | ContactSuggestion[];
}

const toEmails = (v: unknown): string[] => (typeof v === 'string' ? (v.trim() ? [v.trim()] : []) : strList(v));
export const CONTACT_DEBOUNCE_MS = 200;

export function ContactPickerField(props: ContactPickerFieldProps) {
    const strings = useKitStrings();
    const multiple = props.multiple !== false;
    const max = multiple ? finite(props.max) : 1;
    const [emails, setEmails] = useControllable<string[]>(props.value, props.defaultValue ?? [], props.onChange, toEmails);
    const [draft, setDraft] = React.useState('');
    const [open, setOpen] = React.useState(false);
    const [active, setActive] = React.useState(-1);
    const [remote, setRemote] = React.useState<ContactSuggestion[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [known, setKnown] = React.useState<Record<string, string>>({});
    const inputRef = React.useRef<HTMLInputElement>(null);
    const reqId = React.useRef(0);
    const listId = `${React.useId()}-contacts`;
    const disabled = props.disabled === true;
    const readOnly = props.readOnly === true;
    const { error, touch } = useFieldError(emails, { ...props, type: 'contacts' });

    const local = React.useMemo(() => cleanContacts(props.contacts), [props.contacts]);
    const remoteFn = typeof props.loadSuggestions === 'function' ? props.loadSuggestions : null;
    const remoteRef = React.useRef(remoteFn);
    remoteRef.current = remoteFn;
    const hasRemote = remoteFn !== null;

    // Busqueda remota con debounce; la respuesta de una peticion vieja se ignora.
    React.useEffect(() => {
        if (!hasRemote || !open) return;
        const id = ++reqId.current;
        setLoading(true);
        const timer = setTimeout(() => {
            let promise: Promise<unknown>;
            try { promise = Promise.resolve(remoteRef.current?.(draft.trim())); } catch { promise = Promise.resolve([]); }
            promise.then((res) => { if (reqId.current === id) { setRemote(cleanContacts(res)); setLoading(false); } })
                .catch(() => { if (reqId.current === id) { setRemote([]); setLoading(false); } });
        }, CONTACT_DEBOUNCE_MS);
        return () => { clearTimeout(timer); };
    }, [draft, open, hasRemote]);
    React.useEffect(() => () => { reqId.current += 1; }, []);

    const options = React.useMemo(() => {
        const q = draft.trim().toLowerCase();
        const source = hasRemote ? remote : local.filter((c) => !q || c.email.toLowerCase().includes(q) || (c.name ?? '').toLowerCase().includes(q));
        return source.filter((c) => !emails.some((e) => e.toLowerCase() === c.email.toLowerCase())).slice(0, 20);
    }, [draft, hasRemote, remote, local, emails]);
    const expanded = open && options.length > 0;

    const nameOf = (email: string) => known[email.toLowerCase()] ?? local.find((c) => c.email.toLowerCase() === email.toLowerCase())?.name;
    const addEmail = (email: string, name?: string) => {
        if (disabled || readOnly) return;
        const clean = email.trim();
        if (!isValidEmail(clean)) return;
        if (name) setKnown((k) => ({ ...k, [clean.toLowerCase()]: name }));
        if (emails.some((e) => e.toLowerCase() === clean.toLowerCase())) return;
        if (!multiple) setEmails([clean]);
        else if (max === undefined || emails.length < max) setEmails([...emails, clean]);
        setDraft(''); setActive(-1); setOpen(false);
        if (!multiple) inputRef.current?.focus();
    };
    const removeAt = (i: number) => { if (!disabled && !readOnly) setEmails(emails.filter((_, j) => j !== i)); };

    return (
        <Field label={props.label} helperText={props.helperText} error={error} required={props.required} fallbackLabel={text(props.placeholder) ?? text(props.name)}>
            {(a) => (
                <div className="relative" onBlur={touch}>
                    <div className={CHIPS_BOX_CLASS} aria-invalid={a.invalid ? true : undefined} aria-disabled={disabled ? true : undefined} onClick={() => inputRef.current?.focus()}>
                        <ul className="contents" aria-label={text(props.label) ?? text(props.name)}>
                            {emails.map((email, i) => {
                                const name = nameOf(email);
                                return (
                                    <Chip key={`${email}-${i}`} removeLabel={`${strings.remove} ${email}`} onRemove={disabled || readOnly ? undefined : () => removeAt(i)}>
                                        {name ? <>{name} <span className="text-muted-foreground">&lt;{email}&gt;</span></> : email}
                                    </Chip>
                                );
                            })}
                        </ul>
                        <input
                            ref={inputRef} id={a.id} name={text(props.name)} type="text" role="combobox" value={draft} disabled={disabled} readOnly={readOnly} autoComplete="off"
                            placeholder={emails.length === 0 ? text(props.placeholder) : undefined} className={CHIP_INPUT_CLASS}
                            aria-expanded={expanded} aria-autocomplete="list" aria-haspopup="listbox" aria-controls={expanded ? listId : undefined}
                            aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
                            aria-label={a.ariaLabel} aria-describedby={a.describedBy} aria-invalid={a.invalid ? true : undefined} aria-required={a.required ? true : undefined}
                            onChange={(e) => { setDraft(e.target.value); setActive(-1); setOpen(true); }}
                            onFocus={() => setOpen(true)}
                            onBlur={() => { setOpen(false); if (isValidEmail(draft.trim())) addEmail(draft); }}
                            onKeyDown={(e) => {
                                if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); setActive((c) => moveIndex(c, 1, options.length)); }
                                else if (e.key === 'ArrowUp') { e.preventDefault(); if (!open) setOpen(true); setActive((c) => moveIndex(c, -1, options.length)); }
                                else if (e.key === 'Escape') { if (expanded || open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setActive(-1); } }
                                else if (e.key === 'Enter') {
                                    if (expanded && active >= 0) { e.preventDefault(); const o = options[active]; if (o) addEmail(o.email, o.name); }
                                    else if (draft.trim()) { e.preventDefault(); addEmail(draft); }
                                } else if (e.key === 'Backspace' && draft === '' && emails.length > 0) removeAt(emails.length - 1);
                            }}
                        />
                    </div>
                    {expanded && (
                        <ul id={listId} role="listbox" aria-label={text(props.label) ?? text(props.name)} className={`${POPOVER_CLASS} absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto p-1`}>
                            {options.map((c, i) => (
                                <li
                                    key={c.email} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                                    className={`${MENU_ITEM_CLASS} cursor-pointer ${i === active ? 'bg-accent text-accent-foreground' : ''}`}
                                    onMouseDown={(e) => e.preventDefault()} onClick={() => addEmail(c.email, c.name)}
                                >
                                    <span className="flex min-w-0 flex-col"><span className="truncate">{c.name ?? c.email}</span>{c.name && <span className="truncate text-xs opacity-80">{c.email}</span>}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {open && !expanded && draft.trim() !== '' && (
                        <div role="status" className={`${POPOVER_CLASS} absolute left-0 right-0 top-full z-50 mt-1 px-3 py-2 text-sm text-muted-foreground`}>
                            {loading ? strings.loading : formatKit(strings.noResults)}
                        </div>
                    )}
                </div>
            )}
        </Field>
    );
}
