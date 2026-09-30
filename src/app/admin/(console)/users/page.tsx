'use client';

import { Suspense } from 'react';
import { LoadingState } from '@/components/admin/console';
import { UsersPage } from '@/components/admin/users/UsersPage';

// useSearchParams requiere Suspense: los filtros viven en la URL.
export default function AdminUsersPage() {
    return (
        <Suspense fallback={<LoadingState />}>
            <UsersPage />
        </Suspense>
    );
}
