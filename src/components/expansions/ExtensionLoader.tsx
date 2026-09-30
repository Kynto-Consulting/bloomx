'use client';

import React, { useMemo } from 'react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useExtensionPrefs } from '@/hooks/useExtensionPrefs';
import { JsonRenderer } from './renderer/JsonRenderer';
import { ExtensionToolbar } from './toolbar/ExtensionToolbar';
import { isToolbarMountPoint } from '@/lib/expansions/client/toolbar';
import { buildMountContext } from '@/lib/expansions/context';
import { describeProblems, getPreparedManifest, type PreparedManifest } from '@/lib/expansions/prepare-manifest';
import { applyPrefsToExtensions } from '@/lib/expansions/client/prefs';
import { localizeUi } from '@/lib/expansions/ui-schema';
import { manifestIcon, manifestTexts } from '@/lib/expansions/manifest-schema';
import { useI18n } from '@/components/I18nProvider';
import { reportExtensionError } from '@/lib/expansions/client/error-log';
import { ExtensionsLoadError } from './ExtensionsLoadError';

/** Puntos de montaje con espacio para un control: ahi el fallo de carga se muestra como boton Reintentar (los demas no pintan nada). */
const ERROR_MOUNT_POINTS = new Set(['EMAIL_TOOLBAR', 'COMPOSER_TOOLBAR', 'CALENDAR_TOOLBAR', 'CONTACTS_TOOLBAR', 'SIDEBAR_PANEL', 'EMAIL_READER_SIDEBAR', 'COMPOSER_SIDEBAR', 'CONTACT_CARD_PANEL', 'CALENDAR_EVENT_PANEL', 'SETTINGS_PANEL']);

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

// Cada problema se registra una sola vez por (extension, huella del manifest).
const reportedPrepared = new WeakSet<object>();

/**
 * Valida y adapta el manifest (formato antiguo -> kit) una vez; un manifest invalido (o con status "disabled") no se
 * monta. Los errores de UI se aislan por mount (estado de error amable) y se registran para el autor
 * (client/error-log.ts, visible en /extensions).
 */
function loadPrepared(extensionId: string, template: any): PreparedManifest | null {
    if (!template || typeof template !== 'object') return null;
    if (template.status === 'disabled') return null;

    const prepared = getPreparedManifest(extensionId, template);
    if (!reportedPrepared.has(prepared)) {
        reportedPrepared.add(prepared);
        if (!prepared.ok) {
            console.warn(`[Extensions] Manifest de "${extensionId}" invalido, no se carga: ${describeProblems(prepared.errors, 5)}`);
            for (const problem of prepared.errors.slice(0, 20)) reportExtensionError({ extensionId, kind: 'manifest', message: problem.message, path: problem.path });
        } else {
            // Degradacion POR MOUNT: cada elemento descartado (o que se resolvera al ejecutar) queda registrado con su ruta y motivo.
            if (prepared.droppedCount > 0) {
                console.warn(`[Extensions] "${extensionId}" v${template.version ?? '?'}: se descartaron ${prepared.droppedCount} elemento(s) con errores; el resto de la extension se carga. ${describeProblems(prepared.errors, 5)}`);
            }
            for (const problem of prepared.errors.slice(0, 20)) reportExtensionError({ extensionId, kind: 'validation', message: problem.message, path: problem.path });
            if (prepared.warnings.length > 0 && process.env.NODE_ENV !== 'production') {
                console.info(`[Extensions] ${extensionId}: ${prepared.warnings.length} aviso(s) de UI (formato obsoleto). Ver el playground de extensiones.`);
            }
        }
    }
    return prepared.ok ? prepared : null;
}

/** `state` inicial declarado en el manifest (objeto JSON pequeno). */
function initialStateOf(template: any): Record<string, any> | undefined {
    const state = template?.state;
    if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined;
    try { return JSON.stringify(state).length <= 50_000 ? state : undefined; } catch { return undefined; }
}

interface ExtensionLoaderProps {
    mountPoint: string; // e.g., 'EMAIL_TOOLBAR', 'SETTINGS_TAB'
    context?: any;
    priority?: 'HIGH' | 'LOW' | 'NORMAL';
}

export const ExtensionLoader: React.FC<ExtensionLoaderProps> = ({ mountPoint, context: rawContext }) => {
    const { extensions, isLoading, isError, extensionsLoaded, retry, isRetrying } = useDomainConfig();
    const { prefs } = useExtensionPrefs();
    const { locale } = useI18n();
    // Correo abierto (MailView pasa el objeto email): se completan emailContent y fromContact como en el composer.
    const context = useMemo(() => buildMountContext(mountPoint, rawContext), [mountPoint, rawContext]);

    const normalizedExtensions = useMemo(() => {
        const uniqueExtensions = new Map<string, any>();

        for (const extension of extensions) {
            const canonicalId = getCanonicalExtensionId(extension);
            if (!canonicalId || uniqueExtensions.has(canonicalId)) continue;

            const prepared = loadPrepared(canonicalId, extension.template);
            if (!prepared) continue;

            uniqueExtensions.set(canonicalId, { ...extension, id: canonicalId, template: localizeUi(prepared.template, locale) });
        }

        // Preferencias del usuario: extensiones desactivadas fuera y orden propio de botones/paneles.
        return applyPrefsToExtensions(Array.from(uniqueExtensions.values()), prefs);
    }, [extensions, prefs, locale]);

    // Find all mounts matching this point
    const mounts = useMemo(() => {
        const uniqueMounts = new Map<string, any>();

        for (const extension of normalizedExtensions) {
            if (!extension.template || !Array.isArray(extension.template.mounts)) continue;

            const overlayMounts = extension.template.mounts.filter((mount: any) => mount.point === 'OVERLAY');
            const overlays = overlayMounts.reduce((acc: any, mount: any) => {
                if (mount.id) acc[mount.id] = mount.component;
                return acc;
            }, {});
            const initialState = initialStateOf(extension.template);

            for (const mount of extension.template.mounts.filter((item: any) => item.point === mountPoint)) {
                const texts = manifestTexts(extension.template, locale);
                const preparedMount = {
                    ...mount,
                    extensionId: extension.id,
                    extensionName: texts.name || extension.id,
                    extensionDescription: texts.description || undefined,
                    extensionIcon: manifestIcon(extension.template) ?? undefined,
                    initialState,
                    overlays: { ...(extension.template.overlays || {}), ...overlays },
                };

                const mountKey = getMountKey(extension.id, preparedMount);
                if (!uniqueMounts.has(mountKey)) uniqueMounts.set(mountKey, preparedMount);
            }
        }

        return Array.from(uniqueMounts.values());
    }, [mountPoint, normalizedExtensions, locale]);

    const renderMount = (mount: any, index: number) => (
        mount.component ? (
            <JsonRenderer
                key={`${mount.extensionId}-${index}`}
                component={mount.component}
                initialState={mount.initialState}
                context={{
                    ...context,
                    // Encabezados de seccion de la barra lateral: poco espacio, los botones van solo con icono (tooltip con el nombre).
                    ...(mountPoint === 'SIDEBAR_HEADER' ? { toolbarButtonMode: 'compact', toolbarMeta: { label: mount.component?.props?.label, extensionIcon: mount.extensionIcon } } : null),
                    extensionId: mount.extensionId,
                    overlays: mount.overlays,
                }}
            />
        ) : null
    );

    // Varios proveedores de videollamada se agrupan en UN menu "Video meeting" (cada mount es un BUTTON con onClick).
    const eventLocationBuilderMount = useMemo(() => {
        if (mountPoint !== 'EVENT_LOCATION_BUILDER' || mounts.length === 0) return null;

        const items = mounts
            .filter((mount: any) => mount?.component?.type === 'BUTTON' && mount?.component?.props?.onClick)
            .map((mount: any, index: number) => {
                const baseOnClick = mount.component.props.onClick;
                const label = typeof mount.component.props.label === 'string' ? mount.component.props.label : `Provider ${index + 1}`;
                const icon = typeof mount.component.props.icon === 'string' ? mount.component.props.icon : 'Video';
                const onClick = typeof baseOnClick === 'object' && baseOnClick !== null && !Array.isArray(baseOnClick)
                    ? { ...baseOnClick, extensionId: mount.extensionId, overlays: mount.overlays }
                    : baseOnClick;
                return { label, icon, onClick };
            });

        if (items.length === 0) return null;

        return {
            extensionId: 'event-location-builder',
            overlays: {},
            component: { type: 'MENU', props: { label: 'Video meeting', showLabel: false, icon: 'Video', variant: 'outline', items } },
        };
    }, [mountPoint, mounts]);

    if (isLoading) return null;

    // Fallo de carga SIN datos buenos previos: no es "sin extensiones". Con datos previos se siguen mostrando (stale-while-error).
    if (isError && extensionsLoaded !== true && extensions.length === 0) {
        if (!ERROR_MOUNT_POINTS.has(mountPoint) || !retry) return null;
        return <ExtensionsLoadError variant="inline" onRetry={retry} retrying={isRetrying} />;
    }

    // Barras de acciones: presentacion compacta unica (iconos anclados + menu "Extensiones"), ver toolbar/ExtensionToolbar.
    if (isToolbarMountPoint(mountPoint)) {
        return <ExtensionToolbar mountPoint={mountPoint} mounts={mounts} context={context} />;
    }

    if (mountPoint === 'EVENT_LOCATION_BUILDER') {
        if (!eventLocationBuilderMount) return null;
        return renderMount(eventLocationBuilderMount, 0);
    }

    return (
        <>
            {mounts.map((mount: any, i: number) => renderMount(mount, i))}
        </>
    );
};
