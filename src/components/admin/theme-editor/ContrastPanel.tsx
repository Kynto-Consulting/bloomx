'use client';

import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { PaletteWarning } from '@/lib/brand-theme';
import { useI18n } from '@/components/I18nProvider';
import { analyze, hasColors, proposedFix, type EditorDoc } from './model';
import { btnClass, Switch } from './ui';

interface Props {
    doc: EditorDoc;
    onFix: (w: PaletteWarning) => void;
    onFixAll: () => void;
    onAutoFix: (v: boolean) => void;
}

function Swatch({ color }: { color: string }) {
    return <span className="inline-block h-4 w-4 shrink-0 rounded border border-border" style={{ backgroundColor: color }} aria-hidden="true" />;
}

/**
 * Avisos de contraste EN VIVO (region aria-live). Por cada aviso: token, modo, valor elegido/aplicado con su ratio,
 * el valor corregido que propone el motor y el boton "aplicar correccion" (lo fija como valor explicito).
 * Incluye el interruptor autoFixContrast.
 */
export function ContrastPanel({ doc, onFix, onFixAll, onAutoFix }: Props) {
    const { t } = useI18n();
    const autoFix = doc.theme.autoFixContrast !== false;
    const warnings = useMemo(() => analyze(doc.theme), [doc.theme]);
    // Una entrada por modo/token. Solo los que requieren atencion: no cumplen, o el motor los va a cambiar.
    const items = useMemo(() => {
        const seen = new Set<string>();
        return warnings
            .filter((w) => w.reason === 'scheme' || !w.ok || w.corrected)
            .filter((w) => { const k = `${w.mode}:${w.token}:${w.reason}`; if (seen.has(k)) return false; seen.add(k); return true; })
            .map((w) => ({ w, fix: proposedFix(doc.theme, w) }));
    }, [warnings, doc.theme]);

    return (
        <div className="space-y-3">
            <Switch checked={autoFix} onChange={onAutoFix} label={t('themeEditor.contrast.autoFix')} help={t('themeEditor.contrast.autoFixHelp')} />
            <div role="status" aria-live="polite" aria-atomic="false" data-testid="contrast-status">
                {!hasColors(doc.theme) ? (
                    <p className="text-sm text-muted-foreground">{t('themeEditor.contrast.noColors')}</p>
                ) : items.length === 0 ? (
                    <p className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
                        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />{t('themeEditor.contrast.ok')}
                    </p>
                ) : (
                    <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                        <p className="flex items-start gap-2 font-medium text-foreground">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                            <span>{t('themeEditor.contrast.title', { count: String(items.length) })}</span>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{autoFix ? t('themeEditor.contrast.willAutoFix') : t('themeEditor.contrast.wontAutoFix')}</p>
                        <ul className="mt-3 space-y-2">
                            {items.map(({ w, fix }) => (
                                <li key={`${w.mode}:${w.token}:${w.reason}`} className="rounded-md border border-border bg-card p-3" data-token={w.token} data-mode={w.mode}>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-medium text-foreground">
                                            {t(`themeEditor.tokens.${w.token}`)}
                                            <span className="ml-2 text-xs font-normal text-muted-foreground">{t(`themeEditor.mode.${w.mode}`)} · {t(`themeEditor.contrast.reason.${w.reason}`)}</span>
                                        </span>
                                        <button type="button" className={btnClass} onClick={() => onFix(w)}>
                                            {t('themeEditor.contrast.apply')}
                                        </button>
                                    </div>
                                    {w.reason === 'contrast' && (
                                        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                            <span className="inline-flex items-center gap-1.5"><Swatch color={w.chosen} />{t('themeEditor.contrast.chosen')} <code className="font-mono text-foreground">{w.chosen}</code> ({w.chosenRatio}:1, {t('themeEditor.contrast.min', { min: String(w.min) })})</span>
                                            {fix && <><span aria-hidden="true">→</span><span className="inline-flex items-center gap-1.5"><Swatch color={fix} />{t('themeEditor.contrast.proposed')} <code className="font-mono text-foreground">{fix}</code></span></>}
                                        </p>
                                    )}
                                    {w.reason === 'scheme' && <p className="mt-2 text-xs text-muted-foreground">{t('themeEditor.contrast.schemeHelp')}</p>}
                                    {w.reason === 'invisible' && <p className="mt-2 text-xs text-muted-foreground">{t('themeEditor.contrast.invisibleHelp')}</p>}
                                </li>
                            ))}
                        </ul>
                        {items.length > 1 && (
                            <div className="mt-3 flex justify-end">
                                <button type="button" className={btnClass} onClick={onFixAll}>{t('themeEditor.contrast.applyAll', { count: String(items.length) })}</button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
