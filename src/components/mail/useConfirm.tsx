'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useI18n } from '@/components/I18nProvider';

export interface ConfirmOptions {
    title: string;
    description: ReactNode;
    confirmLabel: string;
    destructive?: boolean;
}

/**
 * Confirmacion asincrona accesible (sustituye a window.confirm, que los navegadores integrados bloquean).
 * `const { confirm, dialog } = useConfirm();` -> `if (!(await confirm({...}))) return;` y renderiza `{dialog}` una vez.
 */
export function useConfirm() {
    const { t } = useI18n();
    const [opts, setOpts] = useState<ConfirmOptions | null>(null);
    const resolver = useRef<((v: boolean) => void) | null>(null);

    const finish = useCallback((value: boolean) => {
        resolver.current?.(value);
        resolver.current = null;
        setOpts(null);
    }, []);

    const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
        // Una confirmacion abierta que se sustituye cuenta como "no".
        resolver.current?.(false);
        resolver.current = resolve;
        setOpts(options);
    }), []);

    const dialog = (
        <ConfirmDialog
            open={opts !== null}
            title={opts?.title ?? ''}
            description={opts?.description ?? ''}
            confirmLabel={opts?.confirmLabel ?? ''}
            cancelLabel={t('common.cancel')}
            destructive={opts?.destructive ?? true}
            onConfirm={() => finish(true)}
            onCancel={() => finish(false)}
        />
    );

    return { confirm, dialog };
}
