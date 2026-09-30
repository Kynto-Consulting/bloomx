'use client';

import { useMemo } from 'react';
import { JsonRenderer } from './renderer/JsonRenderer';

export interface SlashRun {
    /** Cambia en cada ejecucion: fuerza un montaje nuevo (la accion se dispara al montar). */
    nonce: number;
    extensionId: string;
    /** Accion declarativa del manifest (`slashCommands[].action`). */
    action: unknown;
    overlays: Record<string, any>;
    /** Texto escrito tras el comando ("/calendar Reunion" -> "Reunion"). */
    args: string;
}

/**
 * Ejecuta la accion de un slash command con el mismo motor que los botones de las extensiones (JsonRenderer):
 * INSERT_CONTENT, OPEN_OVERLAY, CALL_BACKEND (+ onSuccess), TOAST, APPEND_BODY...
 * Se monta un componente HEADLESS cuyo `onLoad` es la accion; no pinta nada. `context.args` / `context.slashArgs`
 * llevan los argumentos del comando y `context.extensionId` / `overlays` son los de la extension duena.
 */
export function SlashActionRunner({ run, context }: { run: SlashRun | null; context: Record<string, any> }) {
    const component = useMemo(
        () => (run ? { type: 'HEADLESS', props: { onLoad: run.action } } : null),
        [run],
    );
    if (!run || !component) return null;

    return (
        <JsonRenderer
            key={run.nonce}
            component={component as any}
            context={{
                ...context,
                extensionId: run.extensionId,
                overlays: run.overlays,
                args: run.args,
                slashArgs: run.args,
            }}
        />
    );
}
