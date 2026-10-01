import type { Metadata } from 'next';
import { IndexView } from '../../_components/tsdocs/IndexView';

export const metadata: Metadata = {
    title: 'TSDocs: SDK reference | BloomX Docs',
    description: 'Reference generated from the real BloomX extension SDK .d.ts files: interfaces, types, functions, constants, actions and host services.',
};

export default function TsDocsIndexPage() {
    return <IndexView />;
}
