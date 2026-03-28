
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(res => res.json());

function getCanonicalExtensionId(extension: any) {
    const templateId = typeof extension?.template?.id === 'string' ? extension.template.id.trim() : '';
    const extensionId = typeof extension?.id === 'string' ? extension.id.trim() : '';
    return templateId || extensionId;
}

function normalizeExtensions(extensions: any[]) {
    const uniqueExtensions = new Map<string, any>();

    for (const extension of extensions) {
        const canonicalId = getCanonicalExtensionId(extension);
        if (!canonicalId) {
            continue;
        }

        if (!uniqueExtensions.has(canonicalId)) {
            uniqueExtensions.set(canonicalId, {
                ...extension,
                id: canonicalId,
            });
        }
    }

    return Array.from(uniqueExtensions.values());
}

export const DEFAULT_CONFIG = {
    name: process.env.NEXT_PUBLIC_BRAND_NAME || 'Bloom',
    displayName: process.env.NEXT_PUBLIC_BRAND_NAME || 'Bloom',
    logo: process.env.NEXT_PUBLIC_BRAND_LOGO || null,
    theme: {
        primaryColor: process.env.NEXT_PUBLIC_BRAND_COLOR || '#2563EB', // blue-600 default
    }
};
export function useDomainConfig() {
    const { data, error, isLoading } = useSWR('/api/config', fetcher, {
        revalidateOnFocus: true
    });

    if (isLoading) {
        return {
            config: DEFAULT_CONFIG,
            extensions: [],
            isLoading: true,
            isError: false
        }
    }

    const config = data.config;
    return {
        config,
        extensions: normalizeExtensions(data?.extensions || []),
        isLoading,
        isError: error
    };
}
