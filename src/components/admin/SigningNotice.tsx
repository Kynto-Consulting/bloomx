'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { useI18n } from '@/components/I18nProvider';

/**
 * Aviso cuando ESTA instancia no firma sus peticiones (sin BLOOMX_DOMAIN_PRIVATE_KEY valida): sigue recibiendo las versiones de extensiones de siempre, pero
 * las nuevas que usan GoogleLib, la IA por puente o las rutas propias requieren la clave de dominio. Consulta GET /api/admin/signing (sin material privado).
 * La clave PRIVADA nunca pasa por el navegador: se genera con `node scripts/gen-domain-keypair.mjs`, la privada va al entorno y la publica se registra con
 * `bloomx-admin security keys register` (o en /admin/register).
 */
export function SigningNotice({ className = '' }: { className?: string }) {
    const { t } = useI18n();
    const [state, setState] = useState<{ signed: boolean; pendingExtensions: number } | null>(null);
    useEffect(() => {
        let alive = true;
        fetch('/api/admin/signing', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (alive && d && typeof d.signed === 'boolean') setState({ signed: d.signed, pendingExtensions: Number(d.pendingExtensions) || 0 }); })
            .catch(() => undefined);
        return () => { alive = false; };
    }, []);
    if (!state || state.signed) return null;
    return (
        <div role="status" className={`flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm ${className}`}>
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="space-y-1">
                <p className="font-medium">{t('admin.console.extensions.signing.title', { count: state.pendingExtensions })}</p>
                <p className="text-muted-foreground">{t('admin.console.extensions.signing.body')}</p>
                <p className="flex flex-wrap gap-x-4">
                    <Link className="underline" href="/docs/oauth-providers#domain-key">{t('admin.console.extensions.signing.docs')}</Link>
                    <Link className="underline" href="/admin/register">{t('admin.console.extensions.signing.register')}</Link>
                </p>
            </div>
        </div>
    );
}
