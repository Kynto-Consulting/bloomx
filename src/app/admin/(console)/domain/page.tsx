'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';
import { ThemeEditor } from '@/components/admin/theme-editor';
import type { EditorTab } from '@/components/admin/theme-editor/ThemeEditor';
import { Card, DefinitionList, PageHeader, useConsole, useUnsavedChanges } from '@/components/admin/console';

const TABS: readonly string[] = ['colors', 'typography', 'logos', 'landing', 'advanced'];

/**
 * Dominio y marca: enlaza el ThemeEditor (colores, tipografia, logos, landing, avanzado) que ya existe, sin rehacerlo.
 * La pestana inicial sale de ?tab= (la busqueda global enlaza a colors y landing). Los cambios sin guardar avisan al navegar.
 */
export default function DomainPage() {
    const { t } = useI18n();
    const { domain } = useConsole();
    const sp = useSearchParams();
    const [dirty, setDirty] = useState(false);
    useUnsavedChanges(dirty);
    const raw = sp.get('tab') || '';
    const initialTab: EditorTab = TABS.includes(raw) ? (raw as EditorTab) : 'colors';

    return (
        <div className="mx-auto max-w-7xl">
            <PageHeader title={t('admin.console.overview.domain.title')} description={t('admin.console.overview.domain.subtitle', { domain: domain.displayName })} />
            <Card className="mb-6" bodyClassName="space-y-4">
                <DefinitionList items={[
                    { label: t('admin.console.overview.domain.activeDomain'), value: <code className="rounded bg-code px-1.5 py-0.5 text-code-foreground">{domain.name || '—'}</code> },
                    { label: t('admin.console.overview.domain.publicName'), value: domain.displayName },
                ]} />
                <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <KeyRound className="h-4 w-4" aria-hidden="true" />
                    {t('admin.console.overview.domain.signingHint')}
                    <Link href="/admin/profile#signing-key" className="font-medium text-primary underline underline-offset-2">{t('admin.console.overview.domain.signingLink')}</Link>
                </p>
            </Card>
            <ThemeEditor key={initialTab} onDirtyChange={setDirty} initialTab={initialTab} />
        </div>
    );
}
