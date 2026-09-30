'use client';

import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { ManageExtensionsPage } from '@/components/extensions/manage/ManageExtensionsPage';

/** /extensions: gestion de extensiones para el usuario (el catch-all [...slug] exige al menos un segmento). */
export default function ExtensionsIndexPage() {
    return (
        <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" /></div>}>
            <ManageExtensionsPage />
        </Suspense>
    );
}
