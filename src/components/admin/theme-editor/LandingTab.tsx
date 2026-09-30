'use client';

import { useI18n } from '@/components/I18nProvider';
import { LandingEditor } from '@/components/admin/LandingEditor';
import { getLanding, setLanding, type EditorDoc } from './model';

/** Pestana Landing: el LandingEditor existente conectado al MISMO documento que la vista previa en vivo. */
export function LandingTab({ doc, onDoc }: { doc: EditorDoc; onDoc: (doc: EditorDoc, key?: string) => void }) {
    const { locale } = useI18n();
    return (
        <LandingEditor
            value={getLanding(doc)}
            onChange={(next) => onDoc(setLanding(doc, next), 'landing')}
            locale={locale}
            brandName={doc.displayName}
            brandLogo={doc.logo || null}
            themeConfig={doc.theme}
            showPreview={false}
        />
    );
}
