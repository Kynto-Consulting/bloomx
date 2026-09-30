'use client';

/**
 * JsonRenderer: convierte el UI JSON de una extension (`{type, props, children}`) en componentes del KIT
 * (src/components/expansions/kit), que heredan tema, radio, fuente y modo de la empresa.
 *
 * Reparto de responsabilidades:
 *   - ui-schema.ts   catalogo, validacion, saneado de props y adaptador del formato antiguo (migrateLegacyUi)
 *   - expressions.ts evaluador seguro de `${...}` (sin eval)
 *   - state.tsx      estado local de la extension (`state`, con rutas "a.b" y enlace bidireccional `bind`)
 *   - actions.ts     motor de acciones (CALL_BACKEND con carga/error/reintento automaticos, SET_STATE, TOAST...)
 *   - nodes.tsx / forms.tsx   un componente del kit por tipo de nodo
 *   - este fichero   raiz: proveedores, recursion, onLoad, overlays y confirmaciones
 *
 * Las extensiones NO eligen estilos: className/style/color se eliminan al migrar y los enums se coaccionan antes de
 * pintar. Un fallo de render de una extension queda contenido en ExtensionErrorBoundary.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/SessionProvider';
import { useOptionalExpansionUI } from '@/contexts/ExpansionUIContext';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LAZY_KEYS, evaluateExpression, resolveDeep } from '@/lib/expansions/expressions';
import { localizeUi, migrateLegacyUi } from '@/lib/expansions/ui-schema';
import { createActionRunner, normalizeOverlayDef, type ActionEnv, type BackendCaller, type OverlayRequest } from './actions';
import { ExtensionStateContext, ExtensionStateProvider, WizardContext } from './state';
import { KitNode, type NodeEnv } from './nodes';
import { ExtensionErrorBoundary } from '../kit/ExtensionError';
import { OverlayHost, normalizeWidth } from '../kit/OverlayHost';
import { getKitStrings } from '../kit/strings';
import { useI18n } from '@/components/I18nProvider';

export { ExtensionStateProvider };

export interface JsonComponentProps {
    type: string;
    props?: any;
    children?: JsonComponentProps[];
}

// ------------------------------------------------------------------ entorno de la raiz
/** Ajustes de ejecucion de una raiz de renderizado (los hereda cada overlay que abre). */
export interface RendererRuntime {
    /** Sustituye las llamadas CALL_BACKEND (playground/vista previa con datos simulados). */
    callBackend?: BackendCaller;
    /** Observa el `state` de la raiz (panel de estado del playground). */
    onStateChange?: (state: Record<string, any>) => void;
}

interface RootEnv {
    runtime?: RendererRuntime;
    userId: string | null;
    router: { push: (path: string) => void; refresh: () => void };
    showOverlay: (request: OverlayRequest, context: Record<string, any>) => void;
    closeOverlay: (context: Record<string, any>) => void;
    confirm: (message: string) => Promise<boolean>;
}

const RootEnvContext = createContext<RootEnv | null>(null);

/**
 * Raiz de renderizado. Cada raiz (mount, overlay, pagina) tiene su propio `state`; `initialState` (manifest.state)
 * lo inicializa. Las llamadas recursivas reutilizan los mismos proveedores.
 */
export const JsonRenderer: React.FC<{ component: JsonComponentProps; context?: any; initialState?: Record<string, any>; runtime?: RendererRuntime }> = ({ component, context, initialState, runtime }) => {
    const { locale } = useI18n();
    // Textos por idioma ({es, en}) al idioma del usuario ANTES de adaptar el formato antiguo; un string normal no cambia.
    const migrated = useMemo(() => migrateLegacyUi(localizeUi(component, locale)).ui as JsonComponentProps, [component, locale]);
    const { data: session } = useSession();
    const router = useRouter();
    const expansionUI = useOptionalExpansionUI();
    const strings = getKitStrings(locale);
    const [fallback, setFallback] = useState<{ request: OverlayRequest; context: Record<string, any> } | null>(null);
    const [confirmState, setConfirmState] = useState<{ message: string; resolve: (value: boolean) => void } | null>(null);
    const initialRef = useRef(initialState);
    initialRef.current = initialState;
    const runtimeRef = useRef(runtime);
    runtimeRef.current = runtime;

    // Identidad del usuario para el almacenamiento local cifrado. Sin sesion NO se usa un usuario generico.
    const userId: string | null = session?.user?.id || context?.user?.id || null;

    const env = useMemo<RootEnv>(() => ({
        runtime: undefined,
        userId,
        router,
        showOverlay: (request, ctx) => {
            const kind = request.kind;
            const close = () => {
                if (!expansionUI) { setFallback(null); return; }
                if (kind === 'drawer') expansionUI.closeDrawer(); else expansionUI.closeModal();
            };
            const content = <JsonRenderer component={request.component} context={{ ...request.context, onClose: close }} initialState={initialRef.current} runtime={runtimeRef.current ? { ...runtimeRef.current, onStateChange: undefined } : undefined} />;
            const width = normalizeWidth(request.width);
            if (expansionUI) {
                if (kind === 'drawer') expansionUI.openDrawer(content, { width, label: request.label });
                else expansionUI.openModal(content, { width, label: request.label });
            } else if (typeof ctx?.openOverlay === 'function') {
                ctx.openOverlay(content, { width, label: request.label });
            } else {
                setFallback({ request, context: request.context });
            }
        },
        closeOverlay: (ctx) => {
            if (typeof ctx?.onClose === 'function') ctx.onClose();
            else if (typeof ctx?.close === 'function') ctx.close();
            else if (expansionUI) { expansionUI.closeModal(); expansionUI.closeDrawer(); }
            else setFallback(null);
        },
        confirm: (message) => new Promise<boolean>((resolve) => setConfirmState({ message, resolve })),
    }), [userId, router, expansionUI]);

    const envWithRuntime = useMemo<RootEnv>(() => ({ ...env, runtime }), [env, runtime]);

    const settleConfirm = (value: boolean) => {
        confirmState?.resolve(value);
        setConfirmState(null);
    };

    return (
        <ExtensionErrorBoundary extensionId={typeof context?.extensionId === 'string' ? context.extensionId : undefined}>
            <RootEnvContext.Provider value={envWithRuntime}>
                <ExtensionStateProvider initialState={initialState} onStateChange={runtime?.onStateChange}>
                    <InnerJsonRenderer component={migrated} context={context} />
                </ExtensionStateProvider>
                {fallback && (
                    <OverlayHost
                        kind={fallback.request.kind}
                        open
                        onClose={() => setFallback(null)}
                        label={fallback.request.label}
                        width={fallback.request.width}
                    >
                        <JsonRenderer
                            component={fallback.request.component}
                            context={{ ...fallback.context, close: () => setFallback(null), onClose: () => setFallback(null) }}
                            initialState={initialState}
                            runtime={runtime ? { ...runtime, onStateChange: undefined } : undefined}
                        />
                    </OverlayHost>
                )}
                <ConfirmDialog
                    open={confirmState !== null}
                    title={strings.confirmTitle}
                    description={confirmState?.message ?? ''}
                    confirmLabel={strings.accept}
                    cancelLabel={strings.cancel}
                    onConfirm={() => settleConfirm(true)}
                    onCancel={() => settleConfirm(false)}
                />
            </RootEnvContext.Provider>
        </ExtensionErrorBoundary>
    );
};

// ------------------------------------------------------------------ nodo
const InnerJsonRenderer: React.FC<{ component: JsonComponentProps; context?: any }> = ({ component, context: rawContext }) => {
    // Todos los hooks van ANTES de cualquier retorno temprano (reglas de hooks).
    const root = useContext(RootEnvContext);
    const { state, setState, getState } = useContext(ExtensionStateContext);
    const wizard = useContext(WizardContext);
    const context = useMemo(() => rawContext ?? {}, [rawContext]);
    const isNode = component !== null && typeof component === 'object';
    const type = isNode && typeof component.type === 'string' ? component.type : '';
    const props = (isNode ? component.props : undefined) ?? {};
    const rawChildren = (isNode ? component.children : undefined) || props?.children;
    // `children` solo es valido como arreglo de componentes (un string como "${state.gifs}" no rompe el render)
    const children: any[] | undefined = Array.isArray(rawChildren) ? rawChildren : undefined;

    const resolvedProps = useMemo(() => resolveDeep(props, { ctx: context, state }, LAZY_KEYS), [props, context, state]);

    // El ejecutor de acciones es estable; `getEnv` siempre ve el contexto/estado mas reciente.
    const actionEnv: ActionEnv = {
        context,
        getState,
        setState,
        wizard,
        router: root?.router ?? { push: () => { }, refresh: () => { } },
        userId: root?.userId ?? null,
        showOverlay: (request) => root?.showOverlay(request, context),
        closeOverlay: () => root?.closeOverlay(context),
        confirm: root?.confirm,
        callBackend: root?.runtime?.callBackend,
    };
    const envRef = useRef(actionEnv);
    envRef.current = actionEnv;
    const run = useMemo(() => createActionRunner(() => envRef.current), []);

    // Auto-run onLoad: una sola vez, al pasar onLoadWhen de falso a verdadero (o al montar si no hay condicion)
    const shouldRunOnLoad = resolvedProps.onLoadWhen === undefined
        ? true
        : Boolean(typeof resolvedProps.onLoadWhen === 'string' ? resolvedProps.onLoadWhen.trim() : resolvedProps.onLoadWhen);
    const hasOnLoad = Boolean(props?.onLoad);
    useEffect(() => {
        if (hasOnLoad && shouldRunOnLoad) void run(props.onLoad);
        // props.onLoad es dato estatico del manifest
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasOnLoad, shouldRunOnLoad]);

    const renderNode = useCallback((node: any, ctx?: Record<string, any>) => (
        node && typeof node === 'object' ? <InnerJsonRenderer component={node} context={ctx ?? context} /> : null
    ), [context]);
    const renderChildren = useCallback((list: any, ctx?: Record<string, any>) => {
        const items = Array.isArray(list) ? list : list && typeof list === 'object' ? [list] : [];
        return items.map((child: any, i: number) => (child && typeof child === 'object' ? <InnerJsonRenderer key={i} component={child} context={ctx ?? context} /> : null));
    }, [context]);

    if (!type) {
        if (isNode) console.warn('[JsonRenderer] Se ignora un componente sin `type`');
        return null;
    }

    const nodeEnv: NodeEnv = { context, state, setState, run, renderChildren, renderNode };
    return <KitNode type={type} raw={props} resolved={resolvedProps} children={children} env={nodeEnv} />;
};

/** Los OVERLAY del manifest pueden venir en la forma heredada `component: "MODAL"` (ver normalizeMount). */
export { normalizeOverlayDef as normalizeOverlay };

// Exportado para pruebas y para otras superficies que necesiten evaluar una condicion suelta
export function evaluateCondition(expression: string, ctx: any, state: any): any {
    return evaluateExpression(expression, { ctx, state });
}
