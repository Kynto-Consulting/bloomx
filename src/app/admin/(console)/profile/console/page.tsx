'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useI18n } from '@/components/I18nProvider';
import { Card, LoadingState, PageHeader, useConsole } from '@/components/admin/console';

// Terminal ligera cargada solo en esta ruta (sin dependencias pesadas).
const AdminTerminal = dynamic(() => import('@/components/admin/cli/AdminTerminal'), { ssr: false, loading: () => <LoadingState /> });

/** /admin/profile/console: consola de comandos del administrador (mismo motor que la CLI `bloomx`). */
export default function AdminConsolePage() {
    const { t } = useI18n();
    const { domain } = useConsole();
    const host = domain?.name || 'mail.example.com';
    const code = 'rounded bg-code px-1.5 py-0.5 text-code-foreground text-xs';
    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <PageHeader title={t('admin.console.cli.title')} description={t('admin.console.cli.description')} />
            <AdminTerminal />
            <Card title={t('admin.console.cli.connect.title')} bodyClassName="space-y-3 text-sm text-foreground">
                <p>{t('admin.console.cli.connect.install')} <code className={code}>npm i -g @kyntocg/bloomx-cli</code></p>
                <p>{t('admin.console.cli.connect.login')} <code className={code}>bloomx login https://{host}</code></p>
                <p className="text-muted-foreground">{t('admin.console.cli.connect.token')}</p>
                <p className="text-muted-foreground">{t('admin.console.cli.connect.ssh')}</p>
                <Link href="/docs/admin-cli" className="font-medium text-primary underline underline-offset-2">{t('admin.console.cli.connect.docs')}</Link>
            </Card>
        </div>
    );
}
