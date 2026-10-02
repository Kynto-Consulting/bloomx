import type { Metadata } from 'next';
import { DocView } from '../_components/DocView';
import { findDocPage } from '../_content/nav';

const SLUG = 'marketplace-metadata';

export function generateMetadata(): Metadata {
    const p = findDocPage(SLUG);
    return { title: `${p ? p.title.en : 'Docs'} | BloomX Docs`, description: p ? p.description.en : undefined };
}

export default function DocsPage() {
    return <DocView slug={SLUG} />;
}
