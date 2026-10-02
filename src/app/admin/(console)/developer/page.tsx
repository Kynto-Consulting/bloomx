'use client';

import { Suspense } from 'react';
import { LoadingState } from '@/components/admin/console';
import { DeveloperScreen } from '@/components/admin/developer/DeveloperScreen';

/** /admin/developer — portal de desarrolladores del marketplace (dueno del dominio, nivel 4). */
export default function AdminDeveloperPage() {
    return (
        <Suspense fallback={<LoadingState />}>
            <DeveloperScreen />
        </Suspense>
    );
}
