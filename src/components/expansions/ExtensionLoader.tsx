
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { JsonRenderer } from './renderer/JsonRenderer';
import { Popover } from '@/components/ui/Popover';
import { buildReadingContext } from '@/lib/expansions/context';
import { formatManifestIssues, normalizeMount, validateManifest } from '@/lib/expansions/manifest-schema';

function getCanonicalExtensionId(extension: any) {
    const templateId = typeof extension?.template?.id === 'string' ? extension.template.id.trim() : '';
    const extensionId = typeof extension?.id === 'string' ? extension.id.trim() : '';
    return templateId || extensionId;
}

function getMountKey(extensionId: string, mount: any) {
    const component = mount?.component;
    const actionTarget = component?.props?.onClick?.targetId || component?.props?.targetId || '';
    const label = component?.props?.label || component?.props?.icon || component?.type || 'mount';
    return `${extensionId}:${mount?.point || 'unknown'}:${mount?.id || actionTarget || label}`;
}

// Manifests ya validados: se evalua una vez por (id, version) y solo se registra el problema la primera vez.
const manifestVerdicts = new Map<string, boolean>();

/** Un manifest invalido (o con status "disabled") no se monta: nada de lo que declare se renderiza. */
function isLoadableManifest(extensionId: string, template: any): boolean {
    if (!template || typeof template !== 'object') return false;
    if (template.status === 'disabled') return false;

    const cacheKey = `${extensionId}@${template.version || ''}:${Array.isArray(template.mounts) ? template.mounts.length : 0}`;
    const cached = manifestVerdicts.get(cacheKey);
    if (cached !== undefined) return cached;

    const verdict = validateManifest(template);
    if (!verdict.ok) {
        console.warn(`[Extensions] Manifest de "${extensionId}" invalido, no se carga: ${formatManifestIssues(verdict.errors, 5)}`);
    }
    manifestVerdicts.set(cacheKey, verdict.ok);
    return verdict.ok;
}

interface ExtensionLoaderProps {
    mountPoint: string; // e.g., 'EMAIL_TOOLBAR', 'SETTINGS_TAB'
    context?: any;
    priority?: 'HIGH' | 'LOW' | 'NORMAL';
}

export const ExtensionLoader: React.FC<ExtensionLoaderProps> = ({ mountPoint, context: rawContext, priority }) => {
    const { extensions, isLoading } = useDomainConfig();
    // Correo abierto (MailView pasa el objeto email): se completan emailContent y fromContact como en el composer.
    const context = useMemo(() => buildReadingContext(rawContext), [rawContext]);
    const containerRef = useRef<HTMLDivElement>(null);
    const overflowTriggerRef = useRef<HTMLButtonElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);
    const [overflowOpen, setOverflowOpen] = useState(false);

    const normalizedExtensions = useMemo(() => {
        const uniqueExtensions = new Map<string, any>();

        for (const extension of extensions) {
            const canonicalId = getCanonicalExtensionId(extension);
            if (!canonicalId || uniqueExtensions.has(canonicalId)) {
                continue;
            }

            if (!isLoadableManifest(canonicalId, extension.template)) {
                continue;
            }

            uniqueExtensions.set(canonicalId, {
                ...extension,
                id: canonicalId,
            });
        }

        return Array.from(uniqueExtensions.values());
    }, [extensions]);

    // Find all mounts matching this point
    const mounts = useMemo(() => {
        const uniqueMounts = new Map<string, any>();

        for (const extension of normalizedExtensions) {
            if (!extension.template || !Array.isArray(extension.template.mounts)) {
                continue;
            }

            const overlayMounts = extension.template.mounts.filter((mount: any) => mount.point === 'OVERLAY').map(normalizeMount);
            const overlays = overlayMounts.reduce((acc: any, mount: any) => {
                if (mount.id) acc[mount.id] = mount.component;
                return acc;
            }, {});

            for (const rawMount of extension.template.mounts.filter((item: any) => item.point === mountPoint)) {
                const mount = normalizeMount(rawMount);
                const preparedMount = {
                    ...mount,
                    extensionId: extension.id,
                    overlays: { ...(extension.template.overlays || {}), ...overlays }
                };

                const mountKey = getMountKey(extension.id, preparedMount);
                if (!uniqueMounts.has(mountKey)) {
                    uniqueMounts.set(mountKey, preparedMount);
                }
            }
        }

        return Array.from(uniqueMounts.values());
    }, [mountPoint, normalizedExtensions]);

    useEffect(() => {
        if (mountPoint !== 'COMPOSER_TOOLBAR' || !containerRef.current) return;

        const element = containerRef.current;
        const updateWidth = () => setContainerWidth(element.clientWidth);
        updateWidth();

        const observer = new ResizeObserver(updateWidth);
        observer.observe(element);

        return () => observer.disconnect();
    }, [mountPoint, mounts.length]);

    useEffect(() => {
        setOverflowOpen(false);
    }, [mounts.length, containerWidth]);

    const composerOverflow = useMemo(() => {
        if (mountPoint !== 'COMPOSER_TOOLBAR') {
            return { visible: mounts, overflow: [] };
        }

        if (!containerWidth || mounts.length === 0) {
            return { visible: mounts, overflow: [] };
        }

        const buttonWidth = 40;
        const gapWidth = 8;
        const inlineSlotWidth = buttonWidth + gapWidth;
        const overflowSlotWidth = buttonWidth + gapWidth;
        const totalInlineCapacity = Math.max(1, Math.floor((containerWidth + gapWidth) / inlineSlotWidth) -1) ;

        if (mounts.length <= totalInlineCapacity) {
            return { visible: mounts, overflow: [] };
        }

        const visibleCount = Math.max(1, Math.floor((containerWidth - overflowSlotWidth + gapWidth) / inlineSlotWidth));
        return {
            visible: mounts.slice(0, visibleCount),
            overflow: mounts.slice(visibleCount)
        };
    }, [containerWidth, mountPoint, mounts]);

    const renderMount = (mount: any, index: number, toolbarButtonMode?: 'compact' | 'menu') => (
        mount.component ? (
            <JsonRenderer
                key={`${mount.extensionId}-${index}-${toolbarButtonMode || 'default'}`}
                component={mount.component}
                context={{
                    ...context,
                    extensionId: mount.extensionId,
                    overlays: mount.overlays,
                    toolbarButtonMode
                }}
            />
        ) : null
    );

    const eventLocationBuilderMount = useMemo(() => {
        if (mountPoint !== 'EVENT_LOCATION_BUILDER' || mounts.length === 0) {
            return null;
        }

        const menuOptions = mounts
            .filter((mount: any) => mount?.component?.type === 'BUTTON' && mount?.component?.props?.onClick)
            .map((mount: any, index: number) => {
                const baseOnClick = mount.component.props.onClick;
                const optionLabel = mount.component.props.label || `Provider ${index + 1}`;
                const optionIcon = mount.component.props.icon || 'Video';

                if (typeof baseOnClick !== 'object' || baseOnClick === null) {
                    return {
                        label: optionLabel,
                        icon: optionIcon,
                        onClick: baseOnClick,
                    };
                }

                return {
                    label: optionLabel,
                    icon: optionIcon,
                    onClick: {
                        ...baseOnClick,
                        extensionId: mount.extensionId,
                        overlays: mount.overlays,
                    },
                };
            });

        if (menuOptions.length === 0) {
            return null;
        }

        return {
            extensionId: 'event-location-builder',
            overlays: {},
            component: {
                type: 'BUTTON',
                props: {
                    label: 'Video meeting',
                    showLabel: false,
                    icon: 'Video',
                    variant: 'outline',
                    className: 'h-10 w-10 rounded-md border border-border bg-card px-0 text-muted-foreground hover:bg-muted/50 hover:text-foreground shadow-none',
                    menuOptions,
                },
            },
        };
    }, [mountPoint, mounts]);

    // Sort by priority if needed (not implemented deep sort yet)

    if (isLoading) {
        return null;
    }

    if (mountPoint === 'COMPOSER_TOOLBAR') {
        return (
            <div ref={containerRef} className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden">
                {composerOverflow.visible.map((mount: any, i: number) => renderMount(mount, i, 'compact'))}

                {composerOverflow.overflow.length > 0 && (
                    <>
                        <button
                            ref={overflowTriggerRef}
                            type="button"
                            title="More actions"
                            aria-label="More actions"
                            onClick={() => setOverflowOpen((current) => !current)}
                            className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-transparent bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            <Plus className="h-5 w-5" />
                        </button>

                        <Popover
                            trigger={overflowTriggerRef}
                            isOpen={overflowOpen}
                            onClose={() => setOverflowOpen(false)}
                            width={220}
                            header={false}
                            className="rounded-2xl border border-border bg-card p-2 shadow-2xl"
                        >
                            <div className="flex flex-col gap-1">
                                {composerOverflow.overflow.map((mount: any, i: number) => renderMount(mount, i, 'menu'))}
                            </div>
                        </Popover>
                    </>
                )}
            </div>
        );
    }

    if (mountPoint === 'EVENT_LOCATION_BUILDER') {
        if (!eventLocationBuilderMount) {
            return null;
        }

        return renderMount(eventLocationBuilderMount, 0);
    }

    return (
        <>
            {mounts.map((mount: any, i: number) => (
                renderMount(mount, i)
            ))}
        </>
    );
};
