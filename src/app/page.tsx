'use client';

import { Suspense } from 'react';
import { LoadingScreen, MainApp } from '@/components/HomeLayouts';

// Solo el export por defecto: Next.js no admite otros exports en una pagina. Los layouts viven en components/HomeLayouts.tsx.
export default function Home() {
    return (
        <Suspense fallback={<LoadingScreen />}>
            <MainApp />
        </Suspense>
    );
}
