import type { Metadata } from 'next';
import { ToolsGate } from '@/components/extensions/tools/ToolsGate';
import { Gallery } from '@/components/extensions/tools/Gallery';

// Ruta estatica: gana sobre el catch-all src/app/extensions/[...slug]. Solo administradores (ver tools/access.ts).
export const metadata: Metadata = { title: 'Componentes de extensiones', robots: { index: false, follow: false } };

export default function ExtensionsComponentsPage() {
    return (
        <ToolsGate>
            <Gallery />
        </ToolsGate>
    );
}
