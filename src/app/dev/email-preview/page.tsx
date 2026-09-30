import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { canOpenEmailPreviewLab } from '@/lib/dev/email-preview-gate';
import { EmailPreviewLab } from '@/components/dev/EmailPreviewLab';

// Herramienta de DESARROLLO: 404 en produccion; en desarrollo exige NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE o sesion de admin
// (ver lib/dev/email-preview-gate.ts). No indexable.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Correos de reuniones (desarrollo)', robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Estado inicial por URL (?brand=yellow&locale=en&mode=full&device=mobile&variant=update&logo=1): revisiones reproducibles. */
export default async function DevEmailPreviewPage({ searchParams }: { searchParams?: Promise<SearchParams> } = {}) {
    if (!(await canOpenEmailPreviewLab())) notFound();
    const q = (await searchParams) ?? {};
    return (
        <EmailPreviewLab
            initial={{ brand: first(q.brand), color: first(q.color), locale: first(q.locale), mode: first(q.mode), device: first(q.device), variant: first(q.variant), logo: first(q.logo) }}
        />
    );
}
