'use client';

import { FONT_FAMILIES, RADIUS_PRESETS_REM, resolveFontStack, type ThemeRadius } from '@/lib/theme-config';
import { useI18n } from '@/components/I18nProvider';
import { patchTheme, type EditorDoc } from './model';
import { fieldClass, Section } from './ui';
import { useId } from 'react';
import { cn } from '@/lib/utils';

const RADII = Object.keys(RADIUS_PRESETS_REM) as ThemeRadius[];
const LEGACY = '__legacy';

export function TypographyTab({ doc, onDoc }: { doc: EditorDoc; onDoc: (doc: EditorDoc, key?: string) => void }) {
    const { t } = useI18n();
    const uid = useId();
    const legacyFont = !doc.theme.fontFamily && (doc.theme.titleFont || doc.theme.bodyFont);
    const fontValue = doc.theme.fontFamily ?? (legacyFont ? LEGACY : '');
    const radiusRaw = doc.theme.radius;
    const radius: ThemeRadius | null = typeof radiusRaw === 'string' && (RADII as string[]).includes(radiusRaw) ? (radiusRaw as ThemeRadius) : null;
    const stack = resolveFontStack(doc.theme.fontFamily) ?? undefined;

    return (
        <div className="space-y-5">
            <Section title={t('themeEditor.typography.fontTitle')} help={t('themeEditor.typography.fontHelp')}>
                <div>
                    <label htmlFor={`${uid}-font`} className="mb-1 block text-sm font-medium text-foreground">{t('themeEditor.typography.font')}</label>
                    <select
                        id={`${uid}-font`}
                        value={fontValue}
                        onChange={(e) => {
                            const v = e.target.value;
                            if (v === LEGACY) return;
                            const next = patchTheme(doc, { fontFamily: v || undefined });
                            delete next.theme.titleFont;
                            delete next.theme.bodyFont;
                            onDoc(next);
                        }}
                        className={fieldClass}
                    >
                        <option value="">{t('themeEditor.typography.fontDefault')}</option>
                        {Object.entries(FONT_FAMILIES).map(([id, f]) => <option key={id} value={id}>{f.label}</option>)}
                        {legacyFont && <option value={LEGACY}>{t('themeEditor.typography.fontLegacy', { name: doc.theme.titleFont || doc.theme.bodyFont || '' })}</option>}
                    </select>
                    <p className="mt-1 text-xs text-muted-foreground">{t('themeEditor.typography.fontNote')}</p>
                </div>
                <div className="rounded-lg border border-border bg-background p-4" style={stack ? { fontFamily: stack } : undefined} aria-label={t('themeEditor.typography.sample')}>
                    <p className="text-xl font-semibold text-foreground">{t('themeEditor.typography.sampleTitle')}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{t('themeEditor.typography.sampleBody')}</p>
                </div>
            </Section>

            <Section title={t('themeEditor.typography.radiusTitle')} help={t('themeEditor.typography.radiusHelp')}>
                <div role="radiogroup" aria-label={t('themeEditor.typography.radiusTitle')} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {RADII.map((r) => (
                        <button
                            key={r}
                            type="button"
                            role="radio"
                            aria-checked={radius === r || (radius === null && r === 'md' && doc.theme.radius === undefined)}
                            onClick={() => onDoc(patchTheme(doc, { radius: r }))}
                            data-radius={r}
                            className={cn(
                                'flex flex-col items-center gap-2 rounded-lg border p-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                (radius === r || (radius === null && r === 'md' && doc.theme.radius === undefined)) ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                            )}
                        >
                            <span className="h-10 w-16 border-2 border-primary bg-primary/10" style={{ borderRadius: `${RADIUS_PRESETS_REM[r] + 0.25}rem` }} aria-hidden="true" />
                            {t(`themeEditor.typography.radius.${r}`)}
                        </button>
                    ))}
                </div>
                {doc.theme.radius !== undefined && (
                    <button type="button" className="text-xs font-medium text-primary underline underline-offset-2" onClick={() => onDoc(patchTheme(doc, { radius: undefined }))}>
                        {t('themeEditor.typography.radiusDefault')}
                    </button>
                )}
            </Section>
        </div>
    );
}
