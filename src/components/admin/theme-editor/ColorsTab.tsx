'use client';

import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { ThemeMode } from '@/lib/theme-config';
import { normalizeThemeHex } from '@/lib/theme-config';
import { useI18n } from '@/components/I18nProvider';
import { ColorField } from './ColorField';
import { ContrastPanel } from './ContrastPanel';
import {
    PRESETS, TOKEN_GROUPS, analyze, applyAllFixes, applyFix, applyPreset, applyThreeColors, currentThree, explicitCount, explicitValue,
    isAlphaToken, patchTheme, resolveTokens, setModePalette, setTokenValue, type EditorDoc,
} from './model';
import { btnClass, btnPrimaryClass, Section } from './ui';

interface Props {
    doc: EditorDoc;
    mode: ThemeMode;
    onDoc: (doc: EditorDoc, key?: string) => void;
}

export function ColorsTab({ doc, mode, onDoc }: Props) {
    const { t } = useI18n();
    const tokens = useMemo(() => resolveTokens(doc.theme, mode, doc.displayName), [doc.theme, mode, doc.displayName]);
    const warnings = useMemo(() => analyze(doc.theme), [doc.theme]);
    const seed = useMemo(() => currentThree(doc.theme, mode), [doc.theme, mode]);
    const [gen, setGen] = useState<{ primary: string; background: string; text: string } | null>(null);
    const g = gen ?? { primary: seed.primary, background: seed.background, text: seed.text ?? '' };
    const genValid = !!normalizeThemeHex(g.primary) && !!normalizeThemeHex(g.background) && !!normalizeThemeHex(g.text);
    const count = explicitCount(doc.theme, mode);

    const generate = () => {
        const next = applyThreeColors(doc, g);
        if (next) { onDoc(next); setGen(null); }
    };

    return (
        <div className="space-y-5">
            <Section title={t('themeEditor.colors.generatorTitle')} help={t('themeEditor.colors.generatorHelp')}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {(['primary', 'background', 'text'] as const).map((k) => (
                        <ColorField
                            key={k}
                            id={`gen-${k}`}
                            label={t(`themeEditor.colors.gen.${k}`)}
                            value={normalizeThemeHex(g[k]) ?? g[k]}
                            plain
                            onChange={(hex) => setGen({ ...g, [k]: hex })}
                            onReset={() => undefined}
                        />
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button type="button" className={btnPrimaryClass} onClick={generate} disabled={!genValid}>
                        <Sparkles className="h-4 w-4" aria-hidden="true" />{t('themeEditor.colors.generate')}
                    </button>
                    <p className="text-xs text-muted-foreground">{t('themeEditor.colors.generateNote')}</p>
                </div>
            </Section>

            <Section title={t('themeEditor.colors.presetsTitle')} help={t('themeEditor.colors.presetsHelp')}>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {PRESETS.map((p) => (
                        <li key={p.id}>
                            <button
                                type="button"
                                onClick={() => onDoc(applyPreset(doc, p))}
                                data-preset={p.id}
                                className="flex w-full flex-col gap-2 rounded-lg border border-border bg-background p-2 text-left hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <span className="flex h-6 overflow-hidden rounded border border-border" aria-hidden="true">
                                    <span className="flex-1" style={{ backgroundColor: p.colors.background }} />
                                    <span className="flex-1" style={{ backgroundColor: p.colors.text }} />
                                    <span className="flex-1" style={{ backgroundColor: p.colors.primary }} />
                                </span>
                                <span className="text-xs font-medium text-foreground">{t(`themeEditor.colors.presets.${p.id}`)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </Section>

            <Section title={t('themeEditor.contrast.sectionTitle')} help={t('themeEditor.contrast.sectionHelp')}>
                <ContrastPanel
                    doc={doc}
                    onAutoFix={(v) => onDoc(patchTheme(doc, { autoFixContrast: v ? undefined : false }))}
                    onFix={(w) => onDoc(applyFix(doc, w))}
                    onFixAll={() => onDoc(applyAllFixes(doc))}
                />
            </Section>

            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                    {t('themeEditor.colors.explicitCount', { mode: t(`themeEditor.mode.${mode}`), count: String(count) })}
                </p>
                <button type="button" className={btnClass} disabled={count === 0} onClick={() => onDoc(setModePalette(doc, mode, null))}>
                    {t('themeEditor.colors.resetMode', { mode: t(`themeEditor.mode.${mode}`) })}
                </button>
            </div>

            {TOKEN_GROUPS.map((group) => (
                <Section key={group.id} title={t(`themeEditor.colors.groups.${group.id}`)} help={t(`themeEditor.colors.groupHelp.${group.id}`)}>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {group.tokens.map((token) => {
                            const explicit = explicitValue(doc.theme, mode, token);
                            const effective = tokens[token];
                            const corrected = !!explicit && explicit.toLowerCase() !== effective.toLowerCase()
                                && warnings.some((w) => w.mode === mode && w.token === token && w.corrected);
                            return (
                                <ColorField
                                    key={`${mode}-${token}`}
                                    id={`tok-${mode}-${token}`}
                                    label={t(`themeEditor.tokens.${token}`)}
                                    value={effective}
                                    explicit={explicit}
                                    corrected={corrected}
                                    allowAlpha={isAlphaToken(token)}
                                    onChange={(hex) => onDoc(setTokenValue(doc, mode, token, hex), `tok:${mode}:${token}`)}
                                    onReset={() => onDoc(setTokenValue(doc, mode, token, null))}
                                />
                            );
                        })}
                    </div>
                </Section>
            ))}
        </div>
    );
}
