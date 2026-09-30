import type { Metadata } from 'next';
import { ToolsGate } from '@/components/extensions/tools/ToolsGate';
import { Playground } from '@/components/extensions/tools/Playground';

// Ruta estatica: gana sobre el catch-all src/app/extensions/[...slug]. Solo administradores (ver tools/access.ts).
export const metadata: Metadata = { title: 'Playground de extensiones', robots: { index: false, follow: false } };

export default function ExtensionsPlaygroundPage() {
    return (
        <ToolsGate>
            <Playground />
        </ToolsGate>
    );
}
