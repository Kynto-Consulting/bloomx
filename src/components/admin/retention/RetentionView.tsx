'use client';

import { PolicyCard } from './PolicyCard';
import { QuotaCard } from './QuotaCard';
import { RunCard } from './RunCard';
import { StorageCard } from './StorageCard';

/** Retencion y almacenamiento: politicas editables, ejecucion manual y resumen agregado (nunca contenido). */
export function RetentionView() {
    return (
        <div className="space-y-6">
            <PolicyCard />
            <QuotaCard />
            <RunCard />
            <StorageCard />
        </div>
    );
}
