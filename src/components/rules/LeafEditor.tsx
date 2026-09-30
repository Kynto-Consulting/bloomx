'use client';

import { useI18n } from '@/components/I18nProvider';
import { LANGUAGES, parseList, type Leaf } from '@/lib/rules/conditions';
import type { LabelRow } from '@/lib/labels/model';
import { AUTH_MECHS, CONDITION_FOLDERS, FIELD_DEFS, FIELD_GROUPS, HEADERS, NUM_OPS, OPS_BY_KIND, defOf, defaultLeaf, isListOp } from './conditionMeta';
import { ChipInput, RegexEditor, inputCls } from './ConditionInputs';

interface Props { leaf: Leaf; onChange: (l: Leaf) => void; labels: LabelRow[]; contacts?: string[]; idPrefix: string }

const toLocalInput = (iso: string) => { const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromLocalInput = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); };
const UNITS = [{ id: 'KB', f: 1024 }, { id: 'MB', f: 1024 * 1024 }] as const;

export function LeafEditor({ leaf, onChange, labels, contacts, idPrefix }: Props) {
    const { t } = useI18n();
    const l = leaf as any;
    const def = defOf(l.field === 'label' ? 'hasLabel' : l.field);
    const kind = def?.kind;
    const set = (patch: Record<string, unknown>) => onChange({ ...l, ...patch });
    const sel = `${inputCls} pr-7`;

    const fieldSelect = (
        <select aria-label={t('ruleBuilder.field')} value={l.field} onChange={(e) => onChange(defaultLeaf(e.target.value))} className={sel}>
            {FIELD_GROUPS.map((g) => (
                <optgroup key={g} label={t(`ruleBuilder.groups.${g}`)}>
                    {FIELD_DEFS.filter((f) => f.group === g).map((f) => <option key={f.id} value={f.id}>{t(`ruleBuilder.fields.${f.id}`)}</option>)}
                </optgroup>
            ))}
        </select>
    );

    const textOps = (ops: readonly string[]) => (
        <select aria-label={t('ruleBuilder.operator')} value={l.op} onChange={(e) => set({ op: e.target.value, ...(isListOp(e.target.value) ? { values: parseList(l.value, l.values), value: undefined } : { value: (l.values ?? [])[0] ?? l.value ?? '', values: undefined }) })} className={sel}>
            {ops.map((o) => <option key={o} value={o}>{t(`ruleBuilder.ops.${o}`)}</option>)}
        </select>
    );

    const valueEditor = () => {
        if (l.op === 'exists' || l.op === 'notExists') return null;
        const suggestions = l.field === 'from' || l.field === 'replyTo' || l.field === 'to' || l.field === 'cc' || l.field === 'bcc' ? contacts : undefined;
        if (l.op === 'regex' || l.op === 'notRegex') return <RegexEditor value={l.value ?? ''} onChange={(v) => set({ value: v })} label={t('ruleBuilder.value')} caseSensitive={l.caseSensitive} />;
        if (isListOp(l.op)) {
            const hint = l.op === 'wildcard' || l.op === 'notWildcard' ? t('ruleBuilder.wildcardPlaceholder') : kind === 'domain' ? t('ruleBuilder.domainsPlaceholder') : t('ruleBuilder.listPlaceholder');
            return <ChipInput values={parseList(l.value, l.values)} onChange={(v) => set({ values: v, value: undefined })} label={t('ruleBuilder.value')} placeholder={hint} suggestions={suggestions} />;
        }
        return (
            <>
                <input aria-label={t('ruleBuilder.value')} list={suggestions?.length ? `${idPrefix}-c` : undefined} value={l.value ?? ''} onChange={(e) => set({ value: e.target.value })} maxLength={500} className={`${inputCls} min-w-[10rem] flex-1`} />
                {suggestions?.length ? <datalist id={`${idPrefix}-c`}>{suggestions.slice(0, 50).map((s) => <option key={s} value={s} />)}</datalist> : null}
            </>
        );
    };

    const options = (text: boolean, domain: boolean) => (
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {text && !['regex', 'notRegex'].includes(l.op) && <label className="inline-flex items-center gap-1"><input type="checkbox" checked={!!l.wholeWord} onChange={(e) => set({ wholeWord: e.target.checked || undefined })} /> {t('ruleBuilder.wholeWord')}</label>}
            {text && <label className="inline-flex items-center gap-1"><input type="checkbox" checked={!!l.caseSensitive} onChange={(e) => set({ caseSensitive: e.target.checked || undefined })} /> {t('ruleBuilder.caseSensitive')}</label>}
            {domain && <label className="inline-flex items-center gap-1"><input type="checkbox" checked={!!l.subdomains} onChange={(e) => set({ subdomains: e.target.checked || undefined })} /> {t('ruleBuilder.subdomains')}</label>}
        </div>
    );

    let body: React.ReactNode = null;
    switch (kind) {
        case 'address': case 'text': case 'domain':
            body = <>{textOps(OPS_BY_KIND[kind])}{valueEditor()}{options(true, kind === 'domain')}</>; break;
        case 'language':
            body = <>{textOps(OPS_BY_KIND.language)}<select aria-label={t('ruleBuilder.value')} value={parseList(l.value, l.values)[0] ?? 'es'} onChange={(e) => set(isListOp(l.op) ? { values: [e.target.value], value: undefined } : { value: e.target.value })} className={sel}>{LANGUAGES.map((c) => <option key={c} value={c}>{t(`ruleBuilder.languages.${c}`)}</option>)}</select></>; break;
        case 'header':
            body = <>
                <select aria-label={t('ruleBuilder.headerName')} value={l.name} onChange={(e) => set({ name: e.target.value })} className={sel}>{HEADERS.map((h) => <option key={h} value={h}>{h}</option>)}</select>
                {textOps(OPS_BY_KIND.header)}{valueEditor()}
                <p className="w-full text-xs text-muted-foreground">{t('ruleBuilder.headerHint')}</p></>; break;
        case 'auth':
            body = <>
                <select aria-label={t('ruleBuilder.authMech')} value={l.mech} onChange={(e) => set({ mech: e.target.value })} className={sel}>{AUTH_MECHS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</select>
                <select aria-label={t('ruleBuilder.value')} value={l.value} onChange={(e) => set({ value: e.target.value })} className={sel}>{['pass', 'fail', 'none'].map((r) => <option key={r} value={r}>{t(`ruleBuilder.authResults.${r}`)}</option>)}</select></>; break;
        case 'count': case 'number': case 'hour':
            body = <>
                <select aria-label={t('ruleBuilder.operator')} value={l.op} onChange={(e) => set({ op: e.target.value })} className={sel}>{NUM_OPS.map((o) => <option key={o} value={o}>{t(`ruleBuilder.numOps.${o}`)}</option>)}</select>
                <input type="number" aria-label={t('ruleBuilder.value')} min={kind === 'hour' ? 0 : undefined} max={kind === 'hour' ? 23 : undefined} value={l.value ?? 0} onChange={(e) => set({ value: Number(e.target.value) })} className={`${inputCls} w-28`} /></>; break;
        case 'bytes': {
            const unit = (l.value ?? 0) >= UNITS[1].f && (l.value % UNITS[1].f === 0) ? UNITS[1] : UNITS[0];
            body = <>
                <select aria-label={t('ruleBuilder.operator')} value={l.op} onChange={(e) => set({ op: e.target.value })} className={sel}>{NUM_OPS.map((o) => <option key={o} value={o}>{t(`ruleBuilder.numOps.${o}`)}</option>)}</select>
                <input type="number" min={0} aria-label={t('ruleBuilder.value')} value={+((l.value ?? 0) / unit.f).toFixed(2)} onChange={(e) => set({ value: Math.round(Number(e.target.value) * unit.f) })} className={`${inputCls} w-28`} />
                <select aria-label={t('ruleBuilder.unit')} value={unit.id} onChange={(e) => { const nu = UNITS.find((u) => u.id === e.target.value)!; set({ value: Math.round(((l.value ?? 0) / unit.f) * nu.f) }); }} className={sel}>{UNITS.map((u) => <option key={u.id}>{u.id}</option>)}</select></>; break;
        }
        case 'dow':
            body = <>
                <select aria-label={t('ruleBuilder.operator')} value={l.op} onChange={(e) => set(e.target.value === 'in' || e.target.value === 'notIn' ? { op: e.target.value, values: l.values ?? [1], value: undefined } : { op: e.target.value, value: (l.values ?? [1])[0], values: undefined })} className={sel}>
                    {['in', 'notIn', ...NUM_OPS].map((o) => <option key={o} value={o}>{t(NUM_OPS.includes(o as any) ? `ruleBuilder.numOps.${o}` : `ruleBuilder.ops.${o}`)}</option>)}
                </select>
                <fieldset className="flex flex-wrap gap-2"><legend className="sr-only">{t('ruleBuilder.fields.dayOfWeek')}</legend>
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                        const cur: number[] = l.values ?? (l.value !== undefined ? [l.value] : []);
                        return <label key={d} className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={cur.includes(d)} onChange={(e) => { const next = e.target.checked ? [...cur, d] : cur.filter((x) => x !== d); if (next.length) set(l.op === 'in' || l.op === 'notIn' ? { values: next } : { value: next[0] }); }} />{t(`ruleBuilder.days.${d}`)}</label>;
                    })}
                </fieldset></>; break;
        case 'date':
            body = <>
                <select aria-label={t('ruleBuilder.operator')} value={l.op} onChange={(e) => set({ op: e.target.value, ...(e.target.value === 'between' ? { value2: l.value2 ?? new Date().toISOString() } : { value2: undefined }) })} className={sel}>{['before', 'after', 'between'].map((o) => <option key={o} value={o}>{t(`ruleBuilder.dateOps.${o}`)}</option>)}</select>
                <input type="datetime-local" aria-label={t('ruleBuilder.value')} value={toLocalInput(l.value)} onChange={(e) => set({ value: fromLocalInput(e.target.value) })} className={inputCls} />
                {l.op === 'between' && <input type="datetime-local" aria-label={t('ruleBuilder.value2')} value={toLocalInput(l.value2 ?? '')} onChange={(e) => set({ value2: fromLocalInput(e.target.value) })} className={inputCls} />}</>; break;
        case 'bool':
            body = <select aria-label={t('ruleBuilder.value')} value={l.value === false ? 'no' : 'yes'} onChange={(e) => set({ value: e.target.value === 'yes' })} className={sel}><option value="yes">{t('ruleBuilder.yes')}</option><option value="no">{t('ruleBuilder.no')}</option></select>; break;
        case 'label':
            body = <><input aria-label={t('ruleBuilder.value')} list={`${idPrefix}-l`} value={labels.find((x) => x.id === l.value)?.fullPath ?? l.value ?? ''} onChange={(e) => { const hit = labels.find((x) => x.fullPath.toLowerCase() === e.target.value.toLowerCase()); set({ value: hit ? hit.id : e.target.value }); }} className={`${inputCls} min-w-[10rem] flex-1`} />
                <datalist id={`${idPrefix}-l`}>{labels.map((x) => <option key={x.id} value={x.fullPath} />)}</datalist><p className="w-full text-xs text-muted-foreground">{t('ruleBuilder.labelHint')}</p></>; break;
        case 'folder':
            body = <select aria-label={t('ruleBuilder.value')} value={l.value} onChange={(e) => set({ value: e.target.value })} className={sel}>{CONDITION_FOLDERS.map((f) => <option key={f} value={f}>{t(`sidebar.folders.${f}`)}</option>)}</select>; break;
    }

    return (
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
            {fieldSelect}
            {body}
        </div>
    );
}
