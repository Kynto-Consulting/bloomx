'use client';

import { Suspense } from 'react';
import { LoadingState } from '@/components/admin/console';
import { BillingScreen } from '@/components/admin/billing/BillingScreen';

/** /admin/billing — facturacion y pagos (dueno del dominio, nivel 4 + step-up). */
export default function AdminBillingPage() {
    // useSearchParams (retornos de PayPal ?order= / ?subscription= / ?paypal=) exige Suspense en el render estatico.
    return (
        <Suspense fallback={<LoadingState />}>
            <BillingScreen />
        </Suspense>
    );
}
