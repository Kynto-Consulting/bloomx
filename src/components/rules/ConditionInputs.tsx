'use client';

import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { validateUserRegex, compileSafeRegex } from '@/lib/rules/regex-safety';
import { MAX_LIST_ITEMS } from '@/lib/rules/conditions';

export const inputCls = 'h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

/** Lista de valores como fichas (dominios, direcciones, extensiones...). Enter / coma / pegar anade; Backspace quita la ultima. */
export function ChipInput({ values, onChange, label, placeholder, suggestions, max = MAX_LIST_ITEMS }: {
    values: string[]; onChange: (v: string[]) => void; label: string; placeholder?: string; suggestions?: string[]; max?: number;
}) {
    const { t } = useI18n();
    const [draft, setDraft] = useState('');
    const listId = useId();
    const add = (raw: string) => {
        const parts = raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
        if (parts.length === 0) return;
        const seen = new Set(values.map((v) => v.toLowerCase()));
        const next = [...values];
        for (const p of parts) if (!seen.has(p.toLowerCase()) && next.length < max) { seen.add(p.toLowerCase()); next.push(p.slice(0, 255)); }
        onChange(next);
        setDraft('');
    };
    return (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded-md border border-input bg-background p-1 focus-within:ring-2 focus-within:ring-ring">
            {values.map((v) => (
                <span key={v} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-foreground">
                    {v}
                    <button type="button" aria-label={t('ruleBuilder.removeValue', { value: v })} onClick={() => onChange(values.filter((x) => x !== v))} className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                        <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                </span>
            ))}
            <input
                aria-label={label}
                list={suggestions?.length ? listId : undefined}
                value={draft}
                placeholder={values.length === 0 ? placeholder : undefined}
                onChange={(e) => { if (/[,;\n]/.test(e.target.value)) add(e.target.value); else setDraft(e.target.value); }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && draft.trim()) { e.preventDefault(); add(draft); }
                    else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
                }}
                onBlur={() => add(draft)}
                onPaste={(e) => { const txt = e.clipboardData.getData('text'); if (/[,;\n]/.test(txt)) { e.preventDefault(); add(txt); } }}
                className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-foreground outline-none"
            />
            {suggestions?.length ? <datalist id={listId}>{suggestions.slice(0, 50).map((s) => <option key={s} value={s} />)}</datalist> : null}
        </div>
    );
}

const EXAMPLES = [
    { id: 'invoice', pattern: '^(factura|invoice)\\s*#?\\d+' },
    { id: 'domain', pattern: '@(empresa|company)\\.(com|es)$' },
    { id: 'digits', pattern: '\\b\\d{6}\\b' },
    { id: 'either', pattern: 'pedido|order|compra' },
] as const;

/** Editor de expresion regular con validacion en vivo (mismas reglas que el servidor), ejemplos y prueba con un texto. */
export function RegexEditor({ value, onChange, label, caseSensitive }: { value: string; onChange: (v: string) => void; label: string; caseSensitive?: boolean }) {
    const { t } = useI18n();
    const [sample, setSample] = useState('');
    const id = useId();
    const check = value ? validateUserRegex(value) : null;
    const re = check?.ok ? compileSafeRegex(value, caseSensitive ? '' : 'i') : null;
    const hit = re && sample ? re.test(sample.slice(0, 2000)) : null;
    return (
        <div className="min-w-0 flex-1 space-y-1">
            <input aria-label={label} aria-invalid={check ? !check.ok : undefined} aria-describedby={`${id}-msg`} value={value} onChange={(e) => onChange(e.target.value)}
                spellCheck={false} placeholder={t('ruleBuilder.regexPlaceholder')} className={`${inputCls} w-full font-mono`} />
            <div id={`${id}-msg`} role="status" className="text-xs">
                {check && !check.ok && <span className="text-destructive">{check.error}</span>}
                {check?.ok && <span className="text-muted-foreground">{t('ruleBuilder.regexValid')}</span>}
            </div>
            <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('ruleBuilder.regexHelp')}</summary>
                <div className="mt-1 flex flex-wrap gap-1">
                    {EXAMPLES.map((ex) => (
                        <button key={ex.id} type="button" onClick={() => onChange(ex.pattern)} className="rounded border border-border px-2 py-0.5 font-mono text-foreground hover:bg-muted">{ex.pattern}</button>
                    ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                    <input aria-label={t('ruleBuilder.regexSample')} value={sample} onChange={(e) => setSample(e.target.value)} placeholder={t('ruleBuilder.regexSample')} className={`${inputCls} flex-1`} />
                    {hit !== null && <span role="status" className={hit ? 'text-success' : 'text-muted-foreground'}>{hit ? t('ruleBuilder.regexMatches') : t('ruleBuilder.regexNoMatch')}</span>}
                </div>
            </details>
        </div>
    );
}
