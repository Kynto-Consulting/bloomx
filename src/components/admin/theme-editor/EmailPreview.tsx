'use client';

import { useId, useMemo, useState } from 'react';
import { Monitor, Moon, Smartphone, Sun } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { getTranslator, type Locale } from '@/lib/i18n';
import { analyzeEmailBrand, getEmailBrand, type EmailBrand, type EmailLocale } from '@/lib/calendar/email-brand';
import {
    appointmentConfirmationOptions,
    buildEmailHtml,
    calendarInviteOptions,
    eventCancellationOptions,
    hostNotificationOptions,
} from '@/lib/calendar/email-templates';
import { normalizeHex } from '@/lib/color';
import { getLanding, type EditorDoc } from './model';
import { Section, Segmented } from './ui';

export type EmailPreviewVariant = 'invitation' | 'confirmation' | 'host' | 'cancellation';
export const EMAIL_PREVIEW_VARIANTS: readonly EmailPreviewVariant[] = ['invitation', 'confirmation', 'host', 'cancellation'];

/**
 * HTML de un correo de muestra con la marca y el idioma indicados: pasa por EXACTAMENTE las mismas funciones de
 * plantilla que los envios reales (src/lib/calendar/email-templates.ts), solo con datos ficticios.
 */
export function buildEmailPreviewHtml(input: {
    variant: EmailPreviewVariant;
    brand: EmailBrand;
    locale: EmailLocale;
    scheme: 'light' | 'dark';
    now?: Date;
}): string {
    const { variant, brand, locale, scheme } = input;
    const tr = getTranslator(locale as Locale);
    const s = (key: string) => tr.t(`themeEditor.emailPreview.sample.${key}`);
    const day = new Date(input.now ?? Date.now());
    day.setUTCDate(day.getUTCDate() + 2);
    day.setUTCHours(15, 0, 0, 0);
    const startsAt = day;
    const endsAt = new Date(day.getTime() + 60 * 60 * 1000);
    const timezone = 'America/Lima';
    const organizer = { email: 'laura@example.com', name: s('organizer') };
    const guest = { email: 'ana@example.com', name: s('guest') };

    const options = (() => {
        switch (variant) {
            case 'invitation':
                return calendarInviteOptions({
                    title: s('event'), startsAt, endsAt, timezone, location: 'https://meet.google.com/abc-defg-hij',
                    description: s('notes'), organizer, attendees: [guest, { email: 'diego@example.com', name: s('guestTwo') }], brand, locale,
                });
            case 'confirmation':
                return appointmentConfirmationOptions({
                    guestName: guest.name, guestEmail: guest.email, hostName: organizer.name, hostEmail: organizer.email,
                    scheduleName: s('schedule'), startsAt, endsAt, meetUrl: 'https://zoom.us/j/123456789',
                    cancelUrl: 'https://example.com/cancel/preview', timezone, brand, locale,
                });
            case 'host':
                return hostNotificationOptions({
                    guestName: guest.name, guestEmail: guest.email, guestNotes: s('notes'), scheduleName: s('schedule'),
                    startsAt, endsAt, timezone, meetUrl: 'https://zoom.us/j/123456789', brand, locale,
                });
            default:
                return eventCancellationOptions({ title: s('event'), startsAt, endsAt, timezone, location: s('room'), organizer, brand, locale });
        }
    })();
    return buildEmailHtml({ ...options, colorScheme: scheme });
}

/**
 * Vista previa de los correos de reuniones, citas y avisos con la marca que define el admin (logo claro, color primario,
 * nombre, pie) en cada variante, idioma, esquema claro/oscuro simulado y ancho movil/escritorio. El HTML se renderiza en un
 * iframe `sandbox` (sin scripts ni acceso al origen de la app) mediante `srcdoc`.
 */
export function EmailPreview({ doc }: { doc: EditorDoc }) {
    const { t, locale: uiLocale } = useI18n();
    const uid = useId();
    const landing = getLanding(doc);
    const [variant, setVariant] = useState<EmailPreviewVariant>('invitation');
    const [emailLocale, setEmailLocale] = useState<EmailLocale | null>(null);
    const [scheme, setScheme] = useState<'light' | 'dark'>('light');
    const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

    const locale: EmailLocale = emailLocale ?? landing.locale ?? (uiLocale === 'en' ? 'en' : 'es');
    const brand = useMemo(
        () => getEmailBrand({ displayName: doc.displayName, logo: doc.logo, theme: doc.theme }),
        [doc.displayName, doc.logo, doc.theme],
    );
    const html = useMemo(() => buildEmailPreviewHtml({ variant, brand, locale, scheme }), [variant, brand, locale, scheme]);

    const wanted = normalizeHex(doc.theme.palette?.light?.primary) ?? normalizeHex(doc.theme.primaryColor);
    const analysis = analyzeEmailBrand(brand, wanted);
    const variantLabel = t(`themeEditor.emailPreview.variant.${variant}`);

    return (
        <Section title={t('themeEditor.emailPreview.title')} help={t('themeEditor.emailPreview.help')} className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
                <Segmented<EmailPreviewVariant>
                    label={t('themeEditor.emailPreview.variantLabel')}
                    value={variant}
                    onChange={setVariant}
                    options={EMAIL_PREVIEW_VARIANTS.map((id) => ({ id, label: t(`themeEditor.emailPreview.variant.${id}`) }))}
                />
                <Segmented<EmailLocale>
                    label={t('themeEditor.emailPreview.languageLabel')}
                    value={locale}
                    onChange={setEmailLocale}
                    options={[
                        { id: 'es', label: t('themeEditor.emailPreview.language.es') },
                        { id: 'en', label: t('themeEditor.emailPreview.language.en') },
                    ]}
                />
                <Segmented<'light' | 'dark'>
                    label={t('themeEditor.emailPreview.scheme.label')}
                    value={scheme}
                    onChange={setScheme}
                    options={[
                        { id: 'light', label: t('themeEditor.emailPreview.scheme.light'), icon: <Sun className="h-4 w-4" aria-hidden="true" /> },
                        { id: 'dark', label: t('themeEditor.emailPreview.scheme.dark'), icon: <Moon className="h-4 w-4" aria-hidden="true" /> },
                    ]}
                />
                <Segmented<'desktop' | 'mobile'>
                    label={t('themeEditor.emailPreview.device.label')}
                    value={device}
                    onChange={setDevice}
                    options={[
                        { id: 'desktop', label: t('themeEditor.emailPreview.device.desktop'), icon: <Monitor className="h-4 w-4" aria-hidden="true" /> },
                        { id: 'mobile', label: t('themeEditor.emailPreview.device.mobile'), icon: <Smartphone className="h-4 w-4" aria-hidden="true" /> },
                    ]}
                />
            </div>

            <div className="overflow-x-auto rounded-lg border border-border bg-muted p-3" data-testid="email-preview-stage">
                <iframe
                    key={`${variant}-${scheme}-${device}`}
                    id={`${uid}-frame`}
                    title={t('themeEditor.emailPreview.frameTitle', { variant: variantLabel })}
                    sandbox=""
                    srcDoc={html}
                    referrerPolicy="no-referrer"
                    data-testid="email-preview-frame"
                    className="mx-auto block h-[640px] max-w-full rounded-md border border-border bg-card"
                    style={{ width: device === 'mobile' ? 375 : 680 }}
                />
            </div>

            <ul className="space-y-1 text-xs text-muted-foreground">
                <li className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{t('themeEditor.emailPreview.brandColor')}:</span>
                    <span aria-hidden="true" className="inline-block h-3 w-6 rounded border border-border" style={{ backgroundColor: brand.color }} />
                    <span className="font-mono" data-testid="email-brand-color">{brand.color}</span>
                    <span data-testid="email-brand-note">{analysis.textCorrected ? t('themeEditor.emailPreview.colorAdjusted', { color: analysis.linkColor }) : t('themeEditor.emailPreview.colorExact')}</span>
                </li>
                <li>{brand.logoUrl ? t('themeEditor.emailPreview.logoUsed') : t('themeEditor.emailPreview.logoMissing')}</li>
                <li>{t('themeEditor.emailPreview.note')}</li>
            </ul>
        </Section>
    );
}
