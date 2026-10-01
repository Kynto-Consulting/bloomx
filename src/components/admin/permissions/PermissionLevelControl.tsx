'use client';

import * as React from 'react';
import { useI18n } from '@/components/I18nProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ApiError, Badge, Field, adminFetch, btnOutline, selectClass, useConsole } from '@/components/admin/console';
import { permsErrorText } from './PermissionsView';
import { useStepUp } from './useStepUp';

const NAMES = ['user', 'support', 'operator', 'admin', 'superadmin'];

/**
 * "Nivel de permisos: N · nombre" de una cuenta, con su origen (entorno / consola) y, si el actor puede cambiarlo, un selector con SOLO los
 * niveles que puede asignar + dialogo de confirmacion + step-up (MFA). Las reglas reales las aplica el servidor (permissions-core).
 */
export function PermissionLevelControl({ email, level, source, isSelf, onChanged }: { email: string; level: number; source: string; isSelf: boolean; onChanged: () => void }) {
    const { t } = useI18n();
    const { me } = useConsole();
    const uid = React.useId();
    const { guard, dialog } = useStepUp();
    const [pick, setPick] = React.useState('');
    const [confirm, setConfirm] = React.useState(false);
    const [confirmSuper, setConfirmSuper] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);
    const p = (k: string, v?: Record<string, string | number>) => t(`admin.console.perms.drawer.${k}`, v);
    const mine = me?.permission_level ?? 0;
    const canChange = mine >= 3 && !isSelf && source !== 'env' && (level < mine || (mine >= 4 && level >= 4 && source === 'console'));
    const options = [0, 1, 2, 3, 4].filter((l) => l !== level && (mine >= 4 ? true : l < mine));
    const origin = source === 'env' ? p('fromEnv') : source === 'console' ? p('fromConsole') : source === 'manager' ? p('fromManager') : p('none');

    const run = () => {
        setConfirm(false);
        void guard(async () => {
            setBusy(true);
            setError(null);
            try {
                await adminFetch('/api/admin/permissions', { method: 'POST', body: { email, permission_level: Number(pick), confirmSuper: confirmSuper || undefined } });
                setPick(''); setConfirmSuper(false);
                onChanged();
            } catch (err) {
                if (err instanceof ApiError && err.code === 'reauth_required') throw err;
                setError(permsErrorText(t, err));
            } finally { setBusy(false); }
        });
    };

    return (
        <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                <Badge tone={level >= 3 ? 'info' : 'neutral'}>{p('current', { level, name: NAMES[level] ?? '' })}</Badge>
                <span className="text-muted-foreground">({origin})</span>
            </p>
            {canChange ? (
                <div className="flex flex-wrap items-end gap-2">
                    <Field label={p('select')} htmlFor={`${uid}-lv`} className="min-w-[10rem]">
                        <select id={`${uid}-lv`} className={selectClass} value={pick} onChange={(e) => setPick(e.target.value)}>
                            <option value="" />
                            {options.map((l) => <option key={l} value={l}>{l} · {NAMES[l]}</option>)}
                        </select>
                    </Field>
                    <button type="button" className={btnOutline} disabled={pick === '' || busy} onClick={() => setConfirm(true)}>{p('change')}</button>
                </div>
            ) : <p className="text-xs text-muted-foreground">{p('cannotChange')}</p>}
            <p className="text-xs text-muted-foreground">{p('help')}</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <ConfirmDialog
                open={confirm}
                title={p('confirmTitle')}
                description={p('confirmBody', { email, from: level, to: pick })}
                confirmLabel={p('change')}
                cancelLabel={t('admin.console.common.cancel')}
                onCancel={() => setConfirm(false)}
                onConfirm={() => { if (pick === '4') setConfirmSuper(true); run(); }}
            />
            {dialog}
        </div>
    );
}
