'use client';

import { useId, useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { ThemeMode } from '@/lib/theme-config';
import { LANDING_LIMITS, type LandingConfig } from '@/lib/landing-config';
import { useI18n } from '@/components/I18nProvider';
import { getLanding, resolveTokens, setLanding, validateHttpsUrl, type EditorDoc, type FieldErrors } from './model';
import { EmailPreview } from './EmailPreview';
import { fieldClass, FieldError, Section, Switch } from './ui';

interface Props {
    doc: EditorDoc;
    errors: FieldErrors;
    onDoc: (doc: EditorDoc, key?: string) => void;
}

/** Vista previa de un logo sobre la superficie real del modo (claro/oscuro) y aviso si no carga. */
function LogoPreview({ url, mode, doc, height, label }: { url: string; mode: ThemeMode; doc: EditorDoc; height: number; label: string }) {
    const { t } = useI18n();
    const [failed, setFailed] = useState<string | null>(null);
    const tokens = resolveTokens(doc.theme, mode, doc.displayName);
    const ok = url && validateHttpsUrl(url) === 'ok';
    return (
        <div
            className="flex min-h-16 items-center justify-center rounded-lg border border-border p-3"
            style={{ backgroundColor: tokens.background, color: tokens.foreground }}
            data-logo-preview={mode}
        >
            {ok && failed !== url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={label} height={height} style={{ height, width: 'auto', maxWidth: 240 }} className="object-contain" referrerPolicy="no-referrer" onError={() => setFailed(url)} />
            ) : (
                <span className="flex items-center gap-2 text-xs">
                    <ImageOff className="h-4 w-4" aria-hidden="true" />
                    {ok ? t('themeEditor.logos.loadFailed') : t('themeEditor.logos.noImage')}
                </span>
            )}
        </div>
    );
}

export function LogosTab({ doc, errors, onDoc }: Props) {
    const { t } = useI18n();
    const uid = useId();
    const landing = getLanding(doc);
    const logo = landing.logo ?? {};
    const height = logo.height ?? 32;

    const setLogo = (patch: Partial<NonNullable<LandingConfig['logo']>>, key?: string) => {
        const next = { ...logo, ...patch } as Record<string, unknown>;
        for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
        const landingNext = { ...landing } as Record<string, unknown>;
        if (Object.keys(next).length) landingNext.logo = next; else delete landingNext.logo;
        onDoc(setLanding(doc, landingNext), key);
    };

    const urlField = (name: 'light' | 'dark') => {
        const value = logo[name] ?? '';
        const state = validateHttpsUrl(value);
        const id = `${uid}-${name}`;
        return (
            <div key={name} className="space-y-2">
                <label htmlFor={id} className="block text-sm font-medium text-foreground">{t(`themeEditor.logos.${name}`)}</label>
                <input
                    id={id}
                    type="url"
                    inputMode="url"
                    value={value}
                    placeholder="https://"
                    onChange={(e) => setLogo({ [name]: e.target.value.trim() } as never, `logo:${name}`)}
                    aria-invalid={state !== 'ok' || undefined}
                    aria-describedby={state !== 'ok' ? `${id}-err` : undefined}
                    className={fieldClass}
                />
                {state !== 'ok' && <FieldError id={`${id}-err`}>{t(`themeEditor.errors.${state}`)}</FieldError>}
                <LogoPreview url={value} mode={name} doc={doc} height={height} label={t('themeEditor.logos.previewAlt', { name: doc.displayName || t('themeEditor.logos.company') })} />
            </div>
        );
    };

    const domainLogoState = validateHttpsUrl(doc.logo);
    const domainErr = errors.logo ? t(`themeEditor.errors.${errors.logo}`) : domainLogoState !== 'ok' ? t(`themeEditor.errors.${domainLogoState}`) : null;
    const nameErr = errors.displayName ? t(`themeEditor.errors.${errors.displayName}`) : null;

    return (
        <div className="space-y-5">
            <Section title={t('themeEditor.logos.nameTitle')} help={t('themeEditor.logos.nameHelp')}>
                <div>
                    <label htmlFor={`${uid}-name`} className="mb-1 block text-sm font-medium text-foreground">{t('themeEditor.logos.publicName')}</label>
                    <input
                        id={`${uid}-name`}
                        type="text"
                        value={doc.displayName}
                        maxLength={140}
                        onChange={(e) => onDoc({ ...doc, displayName: e.target.value }, 'displayName')}
                        aria-invalid={!!nameErr || undefined}
                        aria-describedby={nameErr ? `${uid}-name-err` : undefined}
                        className={fieldClass}
                    />
                    {nameErr && <FieldError id={`${uid}-name-err`}>{nameErr}</FieldError>}
                </div>
                <Switch
                    checked={logo.showName !== false}
                    onChange={(v) => setLogo({ showName: v ? undefined : false })}
                    label={t('themeEditor.logos.showName')}
                    help={t('themeEditor.logos.showNameHelp')}
                />
            </Section>

            <Section title={t('themeEditor.logos.title')} help={t('themeEditor.logos.help')}>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">{urlField('light')}{urlField('dark')}</div>
                <div>
                    <label htmlFor={`${uid}-h`} className="mb-1 block text-sm font-medium text-foreground">
                        {t('themeEditor.logos.height')}: <span className="font-mono">{height}px</span>
                    </label>
                    <input
                        id={`${uid}-h`}
                        type="range"
                        min={LANDING_LIMITS.logoHeightMin}
                        max={LANDING_LIMITS.logoHeightMax}
                        value={height}
                        onChange={(e) => setLogo({ height: Number(e.target.value) }, 'logo:height')}
                        className="w-full accent-primary"
                    />
                </div>
                <p className="rounded-lg border border-info/30 bg-info/10 p-3 text-xs text-foreground">{t('themeEditor.logos.noUploadNote')}</p>
            </Section>

            <Section title={t('themeEditor.logos.faviconTitle')} help={t('themeEditor.logos.faviconHelp')}>
                <div>
                    <label htmlFor={`${uid}-fav`} className="mb-1 block text-sm font-medium text-foreground">
                        {t('themeEditor.logos.favicon')} <span className="text-xs font-normal text-muted-foreground">{t('common.optional')}</span>
                    </label>
                    <input
                        id={`${uid}-fav`}
                        type="url"
                        inputMode="url"
                        value={doc.logo}
                        placeholder="https://"
                        onChange={(e) => onDoc({ ...doc, logo: e.target.value.trim() }, 'domainLogo')}
                        aria-invalid={!!domainErr || undefined}
                        aria-describedby={domainErr ? `${uid}-fav-err` : undefined}
                        className={fieldClass}
                    />
                    {domainErr && <FieldError id={`${uid}-fav-err`}>{domainErr}</FieldError>}
                </div>
                <LogoPreview url={doc.logo} mode="light" doc={doc} height={32} label={t('themeEditor.logos.favicon')} />
            </Section>

            <EmailPreview doc={doc} />
        </div>
    );
}
