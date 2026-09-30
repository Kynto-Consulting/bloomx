'use client';

import { Suspense } from 'react';
import { LoadingState } from '@/components/admin/console';
import { AccountsPage } from '@/components/admin/accounts/AccountsPage';

export default function AdminAccountsPage() {
    return (
        <Suspense fallback={<LoadingState />}>
            <AccountsPage />
        </Suspense>
    );
}
