'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Copy, Download, Upload } from 'lucide-react';
import { THEMES, getAvailableThemeIds, getThemePolicy } from '@/lib/themes';
import type { ThemeConfigIssue, ThemeDefaultMode } from '@/lib/theme-config';
import { useI18n } from '@/components/I18nProvider';
import { applyImported, exportTheme, hasColors, importTheme, patchTheme, type EditorDoc, type ImportResult } from './model';
import { btnClass, btnPrimaryClass, fieldClass, Section, Segmented, Switch } from './ui';

const MODES: readonly ThemeDefaultMode[] = ['light', 'dark', 'system'];

export function AdvancedTab({ doc, onDoc }: { doc: EditorDoc; onDoc: (doc: EditorDoc, key?: string) => void }) {
    const { t } = useI18n();
    const uid = useId();
    const brand = hasColors(doc.theme);
    const policy = useMemo(() => getThemePolicy(doc.theme), [doc.theme]);
    const lock = policy.lock;
    // Ids genericos elegibles hoy (sin el efecto de lockBrand, para poder editarlos aunque este activo).
    const eligible = useMemo(() => new Set(getAvailableThemeIds({ ...policy, lock: false })), [policy]);
    const defaultSet = useMemo(() => new Set(getAvailableThemeIds({ ...policy, allowed: null, lock: false })), [policy]);

    const toggleTheme = (id: string, on: boolean) => {
        const next = new Set(eligible);
        if (on) next.add(id); else next.delete(id);
        const generics = THEMES.map((th) => th.id).filter((x) => next.has(x));
        if (generics.length === 0) return;
        const same = generics.length === [...defaultSet].filter((x) => THEMES.some((th) => th.id === x)).length && generics.every((x) => defaultSet.has(x));
        onDoc(patchTheme(doc, { allowedThemes: same ? undefined : generics }));
    };
    const lastOne = THEMES.filter((th) => eligible.has(th.id)).length === 1;

    // ---- importar / exportar ----
    const [text, setText] = useState('');
    const [result, setResult] = useState<ImportResult | null>(null);
    const [copied, setCopied] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const doExport = async () => {
        const json = exportTheme(doc);
        setText(json);
        setResult(null);
        try { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* sin permiso de portapapeles: queda en el cuadro */ }
    };
    const doDownload = () => {
        const url = URL.createObjectURL(new Blob([exportTheme(doc)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = 'theme.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const doValidate = () => setResult(importTheme(text));
    const doApply = () => {
        if (!result || !result.ok) return;
        onDoc(applyImported(doc, result.theme));
        setResult(null);
        setText('');
    };
    const onFile = async (file: File | undefined) => {
        if (!file) return;
        if (file.size > 200_000) { setResult({ ok: false, reason: 'too_large', issues: [] }); return; }
        const content = await file.text();
        setText(content);
        setResult(importTheme(content));
    };
    const issueLine = (i: ThemeConfigIssue) => `${i.path || '(raiz)'}: ${t(`themeEditor.advanced.issue.${i.code}`)}`;

    return (
        <div className="space-y-5">
            <Section title={t('themeEditor.advanced.defaultModeTitle')} help={t('themeEditor.advanced.defaultModeHelp')}>
                <Segmented<ThemeDefaultMode>
                    label={t('themeEditor.advanced.defaultModeTitle')}
                    value={doc.theme.defaultMode ?? 'system'}
                    options={MODES.map((m) => ({ id: m, label: t(`themeEditor.advanced.defaultMode.${m}`) }))}
                    onChange={(m) => onDoc(patchTheme(doc, { defaultMode: m === 'system' ? undefined : m }))}
                />
            </Section>

            <Section title={t('themeEditor.advanced.themesTitle')} help={t('themeEditor.advanced.themesHelp')}>
                <Switch
                    checked={lock}
                    onChange={(v) => onDoc(patchTheme(doc, { lockBrand: v ? true : undefined }))}
                    label={t('themeEditor.advanced.lockBrand')}
                    help={brand ? t('themeEditor.advanced.lockBrandHelp') : t('themeEditor.advanced.lockBrandNoColors')}
                />
                <fieldset disabled={lock} className="disabled:opacity-50">
                    <legend className="mb-2 text-sm font-medium text-foreground">{t('themeEditor.advanced.allowed')}</legend>
                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {THEMES.map((th) => {
                            const checked = eligible.has(th.id);
                            const id = `${uid}-th-${th.id}`;
                            return (
                                <li key={th.id} className="flex items-center gap-2">
                                    <input
                                        id={id}
                                        type="checkbox"
                                        checked={checked}
                                        disabled={checked && lastOne}
                                        onChange={(e) => toggleTheme(th.id, e.target.checked)}
                                        className="h-4 w-4 rounded border-input accent-primary"
                                    />
                                    <label htmlFor={id} className="text-sm text-foreground">
                                        {th.label} <span className="text-xs text-muted-foreground">({t(`themeEditor.mode.${th.scheme}`)})</span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">{brand ? t('themeEditor.advanced.allowedBrandNote') : t('themeEditor.advanced.allowedNoBrandNote')}</p>
                </fieldset>
            </Section>

            <Section title={t('themeEditor.advanced.ioTitle')} help={t('themeEditor.advanced.ioHelp')}>
                <div className="flex flex-wrap gap-2">
                    <button type="button" className={btnClass} onClick={doExport}><Copy className="h-4 w-4" aria-hidden="true" />{copied ? t('themeEditor.advanced.copied') : t('themeEditor.advanced.export')}</button>
                    <button type="button" className={btnClass} onClick={doDownload}><Download className="h-4 w-4" aria-hidden="true" />{t('themeEditor.advanced.download')}</button>
                    <button type="button" className={btnClass} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />{t('themeEditor.advanced.loadFile')}</button>
                    <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label={t('themeEditor.advanced.loadFile')} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
                </div>
                <div>
                    <label htmlFor={`${uid}-json`} className="mb-1 block text-sm font-medium text-foreground">{t('themeEditor.advanced.json')}</label>
                    <textarea
                        id={`${uid}-json`}
                        value={text}
                        onChange={(e) => { setText(e.target.value); setResult(null); }}
                        rows={8}
                        spellCheck={false}
                        placeholder='{ "palette": { "light": { "primary": "#1d4ed8" } } }'
                        className={`${fieldClass} font-mono text-xs`}
                    />
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" className={btnClass} onClick={doValidate} disabled={!text.trim()}>{t('themeEditor.advanced.validate')}</button>
                    <button type="button" className={btnPrimaryClass} onClick={doApply} disabled={!result || !result.ok}>{t('themeEditor.advanced.apply')}</button>
                </div>
                <div role="status" aria-live="polite" data-testid="import-status">
                    {result && !result.ok && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{t(`themeEditor.advanced.importError.${result.reason}`)}</p>}
                    {result && result.ok && (
                        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-foreground">
                            <p className="font-medium text-success">{t('themeEditor.advanced.importOk')}</p>
                            {result.issues.length > 0 && (
                                <>
                                    <p className="mt-2 text-xs text-muted-foreground">{t('themeEditor.advanced.importIssues', { count: String(result.issues.length) })}</p>
                                    <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-foreground">
                                        {result.issues.slice(0, 50).map((i, k) => <li key={k}>{issueLine(i)}</li>)}
                                    </ul>
                                </>
                            )}
                        </div>
                    )}
                    {result && !result.ok && result.issues.length > 0 && (
                        <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">{result.issues.slice(0, 20).map((i, k) => <li key={k}>{issueLine(i)}</li>)}</ul>
                    )}
                </div>
            </Section>
        </div>
    );
}
