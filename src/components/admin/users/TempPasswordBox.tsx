'use client';

import * as React from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/components/I18nProvider';
import { btnOutline } from '@/components/admin/console';
import { copyToClipboard } from './password';

/** Muestra una contrasena temporal UNA vez, con boton de copiar. Se monta solo mientras el admin la necesita. */
export function TempPasswordBox({ value, label, copyLabel }: { value: string; label: string; copyLabel: string }) {
    const { t } = useI18n();
    const uid = React.useId();
    return (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
            <label htmlFor={uid} className="block text-xs font-medium text-foreground">{label}</label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                    id={uid}
                    readOnly
                    value={value}
                    onFocus={(e) => e.currentTarget.select()}
                    spellCheck={false}
                    autoComplete="off"
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                    type="button"
                    className={btnOutline}
                    onClick={async () => {
                        if (await copyToClipboard(value)) toast.success(t('admin.console.users.toast.copied'));
                    }}
                >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    {copyLabel}
                </button>
            </div>
        </div>
    );
}
