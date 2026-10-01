import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { UI_COMPONENTS } from '@/lib/expansions/ui-schema';
import { ComponentPage } from '../../_components/ui-kit/ComponentPage';
import { KIT_TYPES, kitCategoryLabel, slugToType, typeToSlug } from '../../_content/ui-kit/kit';

// Una pagina estatica por componente del esquema (UI_COMPONENTS); cualquier otro slug es 404.
export const dynamicParams = false;

export function generateStaticParams(): Array<{ component: string }> {
    return KIT_TYPES.map((type) => ({ component: typeToSlug(type) }));
}

export async function generateMetadata({ params }: { params: Promise<{ component: string }> }): Promise<Metadata> {
    const type = slugToType((await params).component);
    if (!type) return { title: 'Docs | BloomX Docs' };
    const spec = UI_COMPONENTS[type];
    return { title: `${type} | ${kitCategoryLabel(spec.category, 'en')} | BloomX Docs`, description: spec.doc };
}

export default async function DocsKitComponentPage({ params }: { params: Promise<{ component: string }> }) {
    const type = slugToType((await params).component);
    if (!type) notFound();
    return <ComponentPage type={type} />;
}
