
import React, { useMemo, useState, useRef, createContext, useContext, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOptionalExpansionUI } from '@/contexts/ExpansionUIContext';
import { useSession } from '@/components/SessionProvider';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { secureWrite, secureRead } from '@/lib/expansions/client/secure-storage';
import { executeExtensionAction } from '@/lib/expansions/api';
import { toBackendContext } from '@/lib/expansions/context';
import { LAZY_KEYS, evaluateExpression, resolveDeep, resolveTemplate } from '@/lib/expansions/expressions';
import { normalizeMount } from '@/lib/expansions/manifest-schema';
import { safeHref, safeImageSrc, safeInternalPath } from '@/lib/expansions/safe-url';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { SafeIframe } from '@/components/ui/SafeIframe';
import { Popover } from '@/components/ui/Popover'; // For TOOLTIP or custom usage
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import * as LucideIcons from 'lucide-react'; // Dynamic icons

const MODAL_WIDTHS: Record<string, string> = {
    sm: '420px',
    md: '560px',
    lg: '720px',
    xl: '920px',
    full: '90vw'
};


// --- State Context ---
interface ExtensionStateContextType {
    state: Record<string, any>;
    setState: (key: string, value: any) => void;
    /** Estado vigente en este instante (incluye SET_STATE ya ejecutados en la misma cadena de acciones). */
    getState: () => Record<string, any>;
}
const ExtensionStateContext = createContext<ExtensionStateContextType>({ state: {}, setState: () => { }, getState: () => ({}) });

export const ExtensionStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, setInternalState] = useState<Record<string, any>>({});
    const stateRef = useRef<Record<string, any>>({});
    const setState = useCallback((key: string, value: any) => {
        stateRef.current = { ...stateRef.current, [key]: value };
        setInternalState(stateRef.current);
    }, []);
    const getState = useCallback(() => stateRef.current, []);
    const value = useMemo(() => ({ state, setState, getState }), [state, setState, getState]);
    return (
        <ExtensionStateContext.Provider value={value}>
            {children}
        </ExtensionStateContext.Provider>
    );
};

// --- Wizard Context (NEXT_STEP / PREV_STEP actuan sobre el WIZARD que contiene al componente) ---
interface WizardContextType {
    step: number;
    next: () => void;
    prev: () => void;
}
const WizardContext = createContext<WizardContextType | null>(null);

const WizardRenderer: React.FC<{
    steps: any[];
    rawSteps: any[];
    context?: any;
}> = ({ steps, rawSteps, context }) => {
    const [step, setStep] = useState(0);
    const total = Array.isArray(rawSteps) ? rawSteps.length : 0;
    const wizard = useMemo<WizardContextType>(() => ({
        step,
        next: () => setStep((current) => Math.min(current + 1, Math.max(total - 1, 0))),
        prev: () => setStep((current) => Math.max(current - 1, 0)),
    }), [step, total]);

    const resolvedStep = Array.isArray(steps) ? steps[step] : null;
    const rawStep = Array.isArray(rawSteps) ? rawSteps[step] : null;
    if (!rawStep) {
        return null;
    }

    return (
        <WizardContext.Provider value={wizard}>
            <div className="space-y-4">
                <h3 className="text-lg font-medium">{resolvedStep?.title ?? rawStep.title}</h3>
                <div>
                    {rawStep.content?.map((child: any, i: number) => <InnerJsonRenderer key={`${step}-${i}`} component={child} context={context} />)}
                </div>
                <div className="flex justify-between mt-4">
                    <Button disabled={step === 0} onClick={wizard.prev} variant="outline">Back</Button>
                    {/* El avance lo dispara el contenido del paso con la accion NEXT_STEP */}
                </div>
            </div>
        </WizardContext.Provider>
    );
};

// --- Renderer ---

interface JsonComponentProps {
    type: string;
    props?: any;
    children?: JsonComponentProps[];
}

interface JsonFormRendererProps {
    fields: any[];
    submitLabel?: string;
    onSubmit?: any;
    context?: any;
    handleAction: (actionDef: any, e?: any, extraContext?: any) => Promise<void>;
}

function buildFieldDefaults(fields: any[]): Record<string, any> {
    const defaults: Record<string, any> = {};
    for (const field of fields) {
        if (!field?.name) {
            continue;
        }
        defaults[field.name] = field.defaultValue ?? '';
    }
    return defaults;
}

const JsonFormRenderer: React.FC<JsonFormRendererProps> = ({
    fields,
    submitLabel,
    onSubmit,
    context,
    handleAction,
}) => {
    const [formValues, setFormValues] = useState<Record<string, any>>(() => buildFieldDefaults(fields));
    const touchedRef = useRef<Set<string>>(new Set());

    // Los valores por defecto pueden cambiar (p.ej. cuando una lectura asincrona rellena el estado). Solo se
    // reaplican a los campos que el usuario aun no toco: lo tecleado nunca se pierde por un SET_STATE ajeno.
    const defaultsKey = JSON.stringify(Object.entries(buildFieldDefaults(fields)));
    useEffect(() => {
        const defaults = buildFieldDefaults(fields);
        setFormValues((prev) => {
            const next: Record<string, any> = {};
            for (const name of Object.keys(defaults)) {
                next[name] = touchedRef.current.has(name) && name in prev ? prev[name] : defaults[name];
            }
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultsKey]);

    const setFieldValue = (fieldName: string, value: any) => {
        touchedRef.current.add(fieldName);
        setFormValues((prev) => ({
            ...prev,
            [fieldName]: value ?? '',
        }));
    };

    const toIsoIfValid = useCallback((value: any) => {
        const raw = String(value ?? '').trim();
        if (!raw) return '';

        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) {
            return raw;
        }

        return parsed.toISOString();
    }, []);

    const buildMountContext = (field: any) => {
        const fieldName = String(field?.name || 'value');
        const setterName = field.contextSetter || `set${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1)}`;
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const startsAtValue = formValues.startsAt || context?.startsAt;
        const endsAtValue = formValues.endsAt || context?.endsAt;

        return {
            ...context,
            formData: formValues,
            eventTitle: formValues.title || context?.eventTitle,
            startsAt: startsAtValue,
            endsAt: endsAtValue,
            startsAtIso: toIsoIfValid(startsAtValue),
            endsAtIso: toIsoIfValid(endsAtValue),
            timeZone,
            currentLocation: formValues.location || context?.currentLocation || '',
            [setterName]: (value: any) => setFieldValue(fieldName, value),
        };
    };
    const handleInternalSubmit = () => {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const submissionData: Record<string, any> = {
            ...formValues,
            timeZone,
            timezone: timeZone,
            submittedAt: new Date().toISOString(),
        };

        for (const field of fields) {
            if (field?.type !== 'datetime-local' || !field?.name) {
                continue;
            }

            const fieldName = String(field.name);
            const rawValue = String(formValues[fieldName] ?? '').trim();
            if (!rawValue) {
                continue;
            }

            const parsed = new Date(rawValue);
            if (Number.isNaN(parsed.getTime())) {
                continue;
            }

            submissionData[fieldName] = parsed.toISOString();
            submissionData[`${fieldName}Local`] = rawValue;
            submissionData[`${fieldName}TimeZone`] = timeZone;
        }

        handleAction(onSubmit, null, { formData: submissionData });
    };

    return (
        <div className="space-y-4">
            {fields.map((field: any, i: number) => {
                const fieldValue = formValues[field.name] ?? '';
                const inlineMount = Boolean(field.mountPoint && field.mountInline);

                const fieldInput = field.type === 'textarea' || field.type === 'richtext' ? (
                    <textarea
                        className="w-full rounded-xl bg-muted/50 px-3.5 py-2.5 text-sm outline-none hover:bg-muted/70 focus:bg-background focus:ring-2 focus:ring-offset-0 transition-all min-h-[80px] resize-y"
                        name={field.name}
                        value={fieldValue}
                        readOnly={field.readOnly}
                        placeholder={field.placeholder}
                        onChange={(e) => setFieldValue(field.name, e.target.value)}
                    />
                ) : field.type === 'select' ? (
                    <select
                        className="w-full rounded-xl bg-muted/50 px-3.5 py-2.5 text-sm outline-none hover:bg-muted/70 focus:bg-background focus:ring-2 focus:ring-offset-0 transition-all"
                        name={field.name}
                        value={fieldValue}
                        disabled={field.readOnly}
                        onChange={(e) => setFieldValue(field.name, e.target.value)}
                    >
                        {field.options?.map((opt: any) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                ) : field.type === 'checkbox' ? (
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            name={field.name}
                            checked={Boolean(fieldValue)}
                            disabled={field.readOnly}
                            onChange={(e) => setFieldValue(field.name, e.target.checked)}
                        />
                        <span>{field.label}</span>
                    </div>
                ) : field.type === 'datetime-local' ? (
                    <input
                        type="datetime-local"
                        name={field.name}
                        value={fieldValue}
                        disabled={field.readOnly}
                        onChange={(e) => setFieldValue(field.name, e.target.value)}
                    />
                ) : (
                    <Input
                        type={field.type || 'text'}
                        name={field.name}
                        value={fieldValue}
                        readOnly={field.readOnly}
                        placeholder={field.placeholder}
                        onChange={(e) => setFieldValue(field.name, e.target.value)}
                    />
                );

                return (
                    <div key={i} className="space-y-2">
                        <label className="text-sm font-medium">{field.label}</label>
                        {inlineMount ? (
                            <div className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">{fieldInput}</div>
                                <div className="shrink-0">
                                    <ExtensionLoader
                                        mountPoint={field.mountPoint}
                                        context={buildMountContext(field)}
                                    />
                                </div>
                            </div>
                        ) : (
                            fieldInput
                        )}

                        {field.mountPoint && !inlineMount ? (
                            <div className="pt-1">
                                <ExtensionLoader
                                    mountPoint={field.mountPoint}
                                    context={buildMountContext(field)}
                                />
                            </div>
                        ) : null}
                    </div>
                );
            })}

            <Button onClick={handleInternalSubmit}>
                {submitLabel || 'Submit'}
            </Button>
        </div>
    );
};

export const JsonRenderer: React.FC<{ component: JsonComponentProps; context?: any }> = ({ component, context }) => {
    // La raiz debe tener su propio estado compartido: manifests como HubSpot asumen que "onLoad" y los hijos
    // CONDITIONAL comparten `state`. Las llamadas recursivas reutilizan el mismo proveedor.
    return (
        <ExtensionStateProvider>
            <InnerJsonRenderer component={component} context={context} />
        </ExtensionStateProvider>
    );
};

// --- Componentes con estado propio (antes usaban hooks dentro del switch) ---

const AccordionRenderer: React.FC<{ sections: any[]; context?: any }> = ({ sections, context }) => {
    const [openSections, setOpenSections] = useState<Record<number, boolean>>({});
    return (
        <div className="rounded-xl bg-muted/20 divide-y divide-border overflow-hidden">
            {sections?.map((section: any, i: number) => (
                <div key={i}>
                    <button
                        type="button"
                        className="w-full flex justify-between items-center p-3 text-sm font-medium text-left hover:bg-muted/60 transition-colors"
                        onClick={() => setOpenSections(prev => ({ ...prev, [i]: !prev[i] }))}
                    >
                        {section.title}
                        <span className={`transition-transform ${openSections[i] ? 'rotate-180' : ''}`}>▼</span>
                    </button>
                    {openSections[i] && (
                        <div className="p-3 pt-0">
                            {section.content?.map((child: any, k: number) => (
                                <InnerJsonRenderer key={k} component={child} context={context} />
                            ))}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

const ChildTabsRenderer: React.FC<{ tabs: any[]; context?: any }> = ({ tabs, context }) => {
    const [activeTab, setActiveTab] = useState<any>(tabs?.[0]?.props?.value);
    return (
        <div className="w-full">
            <div className="flex border-b">
                {tabs?.map((child: any, i: number) => (
                    <button
                        type="button"
                        key={i}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === child.props?.value
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                        onClick={() => setActiveTab(child.props?.value)}
                    >
                        {child.props?.label}
                    </button>
                ))}
            </div>
            <div className="p-4">
                {tabs?.map((child: any, i: number) => (
                    <div key={i} className={activeTab === child.props?.value ? 'block' : 'hidden'}>
                        <InnerJsonRenderer component={child} context={context} />
                    </div>
                ))}
            </div>
        </div>
    );
};

const SetVarRenderer: React.FC<{ name?: string; value: any }> = ({ name, value }) => {
    const { getState, setState } = useContext(ExtensionStateContext);
    useEffect(() => {
        if (name && value !== undefined && getState()[name] !== value) {
            setState(name, value);
        }
    }, [name, value, getState, setState]);
    return null;
};

/** Solo estos atributos llegan al <input>/<textarea> (el resto son props del manifest: bindTo, onChange, ...). */
const INPUT_DOM_PROPS = ['placeholder', 'type', 'name', 'value', 'defaultValue', 'disabled', 'readOnly', 'className', 'rows', 'maxLength', 'min', 'max', 'step', 'autoFocus', 'id', 'required'];

function pickDomProps(source: Record<string, any>) {
    const out: Record<string, any> = {};
    for (const key of INPUT_DOM_PROPS) {
        if (source[key] !== undefined) out[key] = source[key];
    }
    return out;
}

const BADGE_VARIANTS: Record<string, string> = {
    default: 'bg-muted text-muted-foreground',
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/15 text-warning',
    error: 'bg-destructive/15 text-destructive',
    destructive: 'bg-destructive/15 text-destructive',
    secondary: 'bg-secondary text-secondary-foreground',
    outline: 'border text-foreground',
};

const ALERT_STYLES: Record<string, string> = {
    info: 'bg-primary/10 border-primary/20 text-foreground',
    success: 'bg-success/10 border-success/30 text-success',
    warning: 'bg-warning/10 border-warning/30 text-warning',
    error: 'bg-destructive/10 border-destructive/30 text-destructive',
    destructive: 'bg-destructive/10 border-destructive/30 text-destructive',
};

const InnerJsonRenderer: React.FC<{ component: JsonComponentProps; context?: any }> = ({ component, context: rawContext }) => {
    // Todos los hooks van ANTES de cualquier retorno temprano (reglas de hooks).
    const context = useMemo(() => rawContext ?? {}, [rawContext]);
    const type = component && typeof component === 'object' && typeof component.type === 'string' ? component.type : '';
    const props = (component && typeof component === 'object' ? component.props : undefined) ?? {};
    const rawChildren = (component && typeof component === 'object' ? component.children : undefined) || props?.children;
    // `children` solo es valido como arreglo de componentes (un string como "${state.gifs}" ya no rompe el render)
    const children: any[] | undefined = Array.isArray(rawChildren) ? rawChildren : undefined;

    const expansionUI = useOptionalExpansionUI();
    const openOverlay = expansionUI?.openModal || context?.openOverlay;
    const closeOverlay = expansionUI?.closeModal || context?.onClose || context?.close;
    const { state, setState, getState } = useContext(ExtensionStateContext);
    const wizard = useContext(WizardContext);
    const { data: session } = useSession();
    const [loadingKeys, setLoadingKeys] = useState<Record<string, boolean>>({});
    const [fallbackMenuOpen, setFallbackMenuOpen] = useState(false);
    const [fallbackMenuTrigger, setFallbackMenuTrigger] = useState<HTMLElement | null>(null);
    const [fallbackMenuOptions, setFallbackMenuOptions] = useState<any[]>([]);
    const [fallbackOverlay, setFallbackOverlay] = useState<{
        component: JsonComponentProps;
        context: any;
        width?: string;
    } | null>(null);
    const router = useRouter();

    const closeAnyOverlay = useCallback(() => {
        if (closeOverlay) {
            closeOverlay();
            return;
        }

        setFallbackOverlay(null);
    }, [closeOverlay]);

    // Identidad del usuario para el almacenamiento local cifrado. Sin sesion NO se usa un usuario generico.
    const userId: string | null = session?.user?.id || context?.user?.id || null;

    // Evaluacion segura de `${...}` (sin eval): ver lib/expansions/expressions.ts
    const resolveValue = (p: any, ctx: any, st: any): any => (typeof p === 'string' ? resolveTemplate(p, { ctx, state: st }) : p);
    const resolveProps = (p: any, ctx: any, st: any): any => resolveDeep(p, { ctx, state: st }, LAZY_KEYS);

    const resolvedProps = useMemo(() => resolveProps(props, context, state), [props, context, state]);

    const resolveModalWidth = (width: unknown) => {
        if (typeof width !== 'string') {
            return undefined;
        }

        return MODAL_WIDTHS[width] || width;
    };


    const handleAction = async (actionDef: any, e?: any, extraContext: any = {}) => {
        if (!actionDef) return;

        // Merge extraContext (like { result: ... }) into the context for resolution
        const processingContext = { ...context, ...extraContext };

        const actions = Array.isArray(actionDef)
            ? actionDef
            : (Array.isArray(actionDef.actions) ? actionDef.actions : [actionDef]);

        for (const act of actions) {
            if (!act || typeof act !== 'object') continue;

            // Estado fresco en cada paso: un SET_STATE anterior de la misma cadena ya es visible.
            const currentState = getState();
            const resolvedAct = resolveProps(act, processingContext, currentState);
            if (Array.isArray(resolvedAct?.actions)) {
                await handleAction(act.actions, e, extraContext);
                continue;
            }

            switch (resolvedAct.action) {
                case 'SET_STATE':
                    setState(resolvedAct.key, resolvedAct.value);
                    break;

                case 'OPEN_OVERLAY': {
                    const { targetId } = resolvedAct;

                    const activeOverlays = resolvedAct.overlays || processingContext.overlays || context.overlays;
                    const activeExtensionId = resolvedAct.extensionId || processingContext.extensionId || context.extensionId;
                    const overlayDef = activeOverlays?.[targetId];
                    if (overlayDef) {
                        const overlayContext = {
                            ...processingContext,
                            extensionId: activeExtensionId,
                            overlays: activeOverlays,
                            onClose: closeOverlay || (() => setFallbackOverlay(null)),
                            toolbarButtonMode: undefined,
                        };

                        if (openOverlay) {
                            openOverlay(
                                <JsonRenderer component={normalizeOverlay(overlayDef)} context={overlayContext} />,
                                { width: resolveModalWidth(overlayDef?.props?.width) }
                            );
                        } else {
                            setFallbackOverlay({
                                component: normalizeOverlay(overlayDef),
                                context: overlayContext,
                                width: resolveModalWidth(overlayDef?.props?.width),
                            });
                        }
                    } else {
                        console.warn(`Overlay ID ${targetId} not found in extension manifest`);
                        toast.error("Overlay not found");
                    }
                    break;
                }

                case 'OAUTH_CONNECT': {
                    const provider = String(resolvedAct.provider || '');
                    if (!/^[a-z0-9_-]{1,32}$/i.test(provider)) {
                        toast.error('Invalid OAuth provider');
                        break;
                    }
                    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                    // Solo rutas internas: una URL del manifest no puede sacar al usuario a otro sitio.
                    const url = safeInternalPath(resolvedAct.url) || `/api/auth/${provider}?returnTo=${encodeURIComponent(returnTo)}`;

                    window.location.href = url;
                    break;
                }

                case 'COPY_TO_CLIPBOARD':
                    try {
                        await navigator.clipboard.writeText(String(resolvedAct.text ?? ''));
                        toast.success(resolvedAct.successMessage || 'Copied!');
                    } catch {
                        toast.error('Failed to copy');
                    }
                    break;

                case 'OPEN_URL': {
                    const href = safeHref(resolvedAct.url);
                    if (!href) {
                        toast.error('Blocked unsafe link');
                        break;
                    }
                    window.open(href, '_blank', 'noopener,noreferrer');
                    break;
                }

                case 'NAVIGATE': {
                    const path = safeInternalPath(resolvedAct.path);
                    if (!path) {
                        toast.error('Blocked unsafe navigation');
                        break;
                    }
                    router.push(path);
                    break;
                }

                case 'REFRESH':
                    router.refresh();
                    break;

                case 'DELAY':
                    await new Promise(resolve => setTimeout(resolve, Math.min(Number(resolvedAct.ms) || 1000, 10_000)));
                    break;

                case 'CALL_BACKEND': {
                    try {
                        // Args explicitos ganan; formData del formulario que disparo la accion se completa solo.
                        const explicitArgs = resolvedAct.args ?? resolvedAct.params;
                        const formData = extraContext?.formData && typeof extraContext.formData === 'object' ? extraContext.formData : null;
                        const params = formData && (explicitArgs === undefined || (explicitArgs && typeof explicitArgs === 'object' && !Array.isArray(explicitArgs)))
                            ? { ...formData, ...(explicitArgs || {}) }
                            : explicitArgs;

                        const result = await executeExtensionAction(
                            processingContext.extensionId,
                            resolvedAct.function,
                            params,
                            toBackendContext(context)
                        );

                        if (!result.success) {
                            throw new Error(result.error || 'Request failed');
                        }

                        // Pasa el resultado a la siguiente accion conservando value/formData del evento original
                        if (act.onSuccess) {
                            await handleAction(act.onSuccess, e, { ...extraContext, result: result.result });
                        }

                    } catch (err: any) {
                        console.error("Backend Call Failed", err?.message);
                        if (act.onError) {
                            await handleAction(act.onError, e, { ...extraContext, error: err.message });
                        } else {
                            toast.error(err.message || "Action failed");
                        }
                    }
                    break;
                }

                case 'CALL_API': {
                    try {
                        const method = (resolvedAct.method || 'GET').toUpperCase();
                        const requestHeaders: Record<string, string> = {
                            ...(resolvedAct.headers || {}),
                        };
                        const requestBody = resolvedAct.body ?? resolvedAct.args ?? resolvedAct.params;
                        // Solo rutas del propio origen (/api/...): un manifest no puede hacer que el navegador llame a otros hosts con cookies.
                        const url = safeInternalPath(resolvedAct.url);
                        if (!url) throw new Error('Blocked unsafe API url');
                        const init: RequestInit = {
                            method,
                            headers: requestHeaders,
                        };

                        if (requestBody !== undefined && method !== 'GET') {
                            if (!requestHeaders['Content-Type']) {
                                requestHeaders['Content-Type'] = 'application/json';
                            }
                            init.body = requestHeaders['Content-Type'] === 'application/json'
                                ? JSON.stringify(requestBody)
                                : requestBody;
                        }

                        const response = await fetch(url, init);
                        const contentType = response.headers.get('content-type') || '';
                        const result = contentType.includes('application/json')
                            ? await response.json()
                            : await response.text();

                        if (!response.ok) {
                            const errorMessage = typeof result === 'object' && result !== null && 'error' in result
                                ? String((result as any).error)
                                : `Request failed with status ${response.status}`;
                            throw new Error(errorMessage);
                        }

                        if (resolvedAct.emitEvent && typeof window !== 'undefined') {
                            window.dispatchEvent(new CustomEvent(resolvedAct.emitEvent, { detail: result }));
                        }

                        if (act.onSuccess) {
                            await handleAction(act.onSuccess, e, { ...extraContext, result });
                        }
                    } catch (err: any) {
                        console.error('Client API Call Failed', err?.message);
                        if (act.onError) {
                            await handleAction(act.onError, e, { ...extraContext, error: err.message });
                        } else {
                            toast.error(err.message || 'Action failed');
                        }
                    }
                    break;
                }

                case 'TOAST':
                    if (resolvedAct.variant === 'error') {
                        toast.error(resolvedAct.message);
                    } else if (resolvedAct.variant === 'success') {
                        toast.success(resolvedAct.message);
                    } else {
                        toast(resolvedAct.message);
                    }
                    break;

                case 'SET_SUBJECT': {
                    const nextSubject = resolvedAct.subject ?? resolvedAct.value;
                    const currentSubject = typeof context.subject === 'string' ? context.subject.trim() : '';

                    if (nextSubject && context.setSubject && (!resolvedAct.ifEmpty || !currentSubject)) {
                        await context.setSubject(nextSubject);
                    }
                    break;
                }

                case 'ADD_ATTACHMENT': {
                    const attachment = resolvedAct.attachment || resolvedAct;

                    if (attachment?.url && context.addAttachment) {
                        context.addAttachment(attachment);
                    } else if (attachment?.contentBase64 && context.addAttachment) {
                        const binary = atob(attachment.contentBase64);
                        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
                        context.addAttachment({
                            ...attachment,
                            filename: attachment.filename || 'attachment.bin',
                            mimeType: attachment.mimeType || 'application/octet-stream',
                            contentBase64: attachment.contentBase64,
                            size: attachment.size || bytes.byteLength,
                        });
                    } else {
                        toast.error('Attachment payload invalid');
                    }
                    break;
                }

                case 'INSERT_CONTENT':
                    if (context.insertBody) {
                        context.insertBody(resolvedAct.content);
                    } else {
                        toast.error("Cannot insert content: Editor context missing");
                    }

                    if (resolvedAct.closeOverlay) {
                        closeAnyOverlay();
                    }
                    break;

                case 'APPEND_BODY': {
                    const nextContent = typeof resolvedAct.content === 'string'
                        ? resolvedAct.content
                        : typeof resolvedAct.content?.content === 'string'
                            ? resolvedAct.content.content
                            : '';

                    if (context.appendBody) {
                        context.appendBody(nextContent);
                    } else {
                        toast.error('Cannot append content: Composer context missing');
                    }

                    if (resolvedAct.closeOverlay) {
                        closeAnyOverlay();
                    }
                    break;
                }

                case 'CLOSE_OVERLAY':
                    closeAnyOverlay();
                    break;

                case 'SET_CONTEXT_VALUE': {
                    const targetKey = resolvedAct.key;
                    if (targetKey && typeof context?.[targetKey] === 'function') {
                        context[targetKey](resolvedAct.value);
                    } else {
                        toast.error(`Context setter '${targetKey}' is unavailable`);
                    }
                    break;
                }

                case 'NEXT_STEP':
                    wizard?.next();
                    break;

                case 'PREV_STEP':
                    wizard?.prev();
                    break;

                // --- Secure Storage Actions ---
                case 'SECURE_SAVE':
                    try {
                        if (!userId) throw new Error('Sign in to save this setting');
                        await secureWrite(resolvedAct.key, resolvedAct.value, userId);
                        if (act.onSuccess) {
                            await handleAction(act.onSuccess, e, extraContext);
                        }
                    } catch (err: any) {
                        console.error("Secure Save Failed", err?.message);
                        if (act.onError) await handleAction(act.onError, e, { ...extraContext, error: err.message });
                        else toast.error(err?.message === 'SECURE_STORAGE_UNAVAILABLE' ? 'Secure storage is not available in this browser' : (err?.message || 'Could not save'));
                    }
                    break;

                case 'SECURE_READ':
                    try {
                        // Sin sesion no hay clave: se trata como "sin dato" (no como un usuario generico compartido)
                        const val = userId ? await secureRead(resolvedAct.key, userId) : null;
                        // Usually we want to set this to state
                        if (resolvedAct.targetState) {
                            setState(resolvedAct.targetState, val);
                        }
                        if (act.onSuccess) {
                            await handleAction(act.onSuccess, e, { ...extraContext, value: val });
                        }
                    } catch (err: any) {
                        console.error("Secure Read Failed", err?.message);
                        if (act.onError) await handleAction(act.onError, e, { ...extraContext, error: err.message });
                    }
                    break;

                // --- Navigation & UI Actions ---
                case 'CONFIRM': {
                    const confirmed = window.confirm(resolvedAct.message || 'Are you sure?');
                    if (confirmed && act.onConfirm) {
                        await handleAction(act.onConfirm, e, extraContext);
                    } else if (!confirmed && act.onCancel) {
                        await handleAction(act.onCancel, e, extraContext);
                    }
                    break;
                }

                case 'SET_LOADING':
                    setLoadingKeys(prev => ({ ...prev, [resolvedAct.key]: resolvedAct.value ?? true }));
                    break;

                // --- State Manipulation ---
                case 'MERGE_STATE': {
                    const existing = currentState[resolvedAct.key] || {};
                    setState(resolvedAct.key, { ...existing, ...resolvedAct.value });
                    break;
                }

                case 'MAP_ARRAY': {
                    const arr = currentState[resolvedAct.source];
                    if (Array.isArray(arr)) {
                        const mapped = arr.map((item: any) => resolveProps(act.template, { ...processingContext, item }, currentState));
                        setState(resolvedAct.target || resolvedAct.source, mapped);
                    }
                    break;
                }

                case 'FILTER_ARRAY': {
                    const arr = currentState[resolvedAct.source];
                    if (Array.isArray(arr)) {
                        const filtered = arr.filter((item: any) => {
                            const itemCtx = { ...processingContext, item };
                            return typeof act.condition === 'string'
                                ? Boolean(resolveValue(act.condition, itemCtx, currentState))
                                : Boolean(act.condition);
                        });
                        setState(resolvedAct.target || resolvedAct.source, filtered);
                    }
                    break;
                }

                case 'OAUTH_DISCONNECT': {
                    const provider = String(resolvedAct.provider || '');
                    if (!/^[a-z0-9_-]{1,32}$/i.test(provider)) {
                        toast.error('Invalid OAuth provider');
                        break;
                    }
                    try {
                        await fetch(`/api/auth/oauth/${provider}/disconnect`, {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ extensionId: context.extensionId })
                        });
                        toast.success('Disconnected');
                        if (act.onSuccess) await handleAction(act.onSuccess, e, extraContext);
                    } catch {
                        toast.error('Failed to disconnect');
                    }
                    break;
                }

                default:
                    console.warn('[JsonRenderer] Unknown action:', resolvedAct.action);
            }
        }
    };

    // Auto-run onLoad: una sola vez, al pasar onLoadWhen de falso a verdadero (o al montar si no hay condicion)
    const shouldRunOnLoad = resolvedProps.onLoadWhen === undefined
        ? true
        : Boolean(
            typeof resolvedProps.onLoadWhen === 'string'
                ? resolvedProps.onLoadWhen.trim()
                : resolvedProps.onLoadWhen
        );
    const hasOnLoad = Boolean(props?.onLoad);
    const handleActionRef = useRef(handleAction);
    handleActionRef.current = handleAction;
    useEffect(() => {
        if (hasOnLoad && shouldRunOnLoad) {
            handleActionRef.current(props.onLoad);
        }
        // props.onLoad es dato estatico del manifest
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasOnLoad, shouldRunOnLoad]);

    if (!type) {
        if (component && typeof component === 'object') {
            console.warn('[JsonRenderer] Skipping invalid component without type');
        }
        return null;
    }

    const renderIcon = (iconName: string, size: number = 16, className: string = '') => {
        if (!iconName) return null;

        let normalizedName = iconName;
        // Map missing custom brand icons to Lucide equivalents
        const iconMap: Record<string, string> = {
            'GoogleDrive': 'Cloud',
            'Drive': 'Cloud',
            'HubSpot': 'Briefcase',
            'Notion': 'BookOpen',
            'Zoom': 'Video',
            'Trello': 'Trello', // If available, otherwise Layout
        };
        if (iconMap[iconName]) {
            normalizedName = iconMap[iconName];
        }

        const IconComponent = (LucideIcons as any)[normalizedName];
        if (IconComponent) {
            return <IconComponent size={size} className={className} />;
        }
        // Fallback if not a Lucide icon (e.g. an emoji)
        return <span className={className} style={{ fontSize: size }}>{iconName}</span>;
    };

    const renderChildren = (list: any[] | undefined, ctx: any = context) =>
        list?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={ctx} />);

    const renderMenuOptionButton = (option: any, index: number) => {
        const optionLabel = option?.label || `Option ${index + 1}`;
        return (
            <button
                key={`${optionLabel}-${index}`}
                type="button"
                onClick={(e) => {
                    handleAction(option?.onClick, e);
                    setFallbackMenuOpen(false);
                    if (context?.close) {
                        context.close();
                    }
                }}
                className="inline-flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
            >
                {option?.icon ? <span>{renderIcon(option.icon, 16)}</span> : null}
                <span>{optionLabel}</span>
            </button>
        );
    };

    const openButtonMenu = (target: EventTarget | null, menuOptions: any[]) => {
        if (!target || !Array.isArray(menuOptions) || menuOptions.length === 0) {
            return;
        }

        if (context?.openPopover) {
            const anchor = target as HTMLElement;
            context.openPopover(
                anchor,
                <div className="flex min-w-[200px] flex-col gap-1 p-1">
                    {menuOptions.map((option, index) => renderMenuOptionButton(option, index))}
                </div>,
                { width: 220, header: false }
            );
            return;
        }

        if (target instanceof HTMLElement) {
            setFallbackMenuTrigger(target);
            setFallbackMenuOptions(menuOptions);
            setFallbackMenuOpen(true);
        }
    };

    switch (type) {
        case 'BUTTON': {
            const providedVariant = resolvedProps.variant || 'default';
            const resolvedVariant = providedVariant === 'primary' ? 'default' : providedVariant;
            const toolbarButtonMode = context?.toolbarButtonMode;
            const isCompactToolbarButton = toolbarButtonMode === 'compact';
            const isToolbarMenuButton = toolbarButtonMode === 'menu';
            const shouldRenderLabel = !isCompactToolbarButton && resolvedProps.showLabel !== false;
            const buttonLabel = resolvedProps.label || 'Action';
            const compactClassName = "h-10 w-10 rounded-xl bg-transparent px-0 text-muted-foreground shadow-none hover:bg-muted";
            const menuClassName = "w-full justify-start rounded-xl bg-transparent px-3 text-foreground shadow-none hover:bg-muted";
            const buttonVariant = (isCompactToolbarButton || isToolbarMenuButton) ? 'ghost' : resolvedVariant;
            const buttonClassName = isCompactToolbarButton
                ? compactClassName
                : isToolbarMenuButton
                    ? menuClassName
                    : (resolvedProps.className || "w-full shadow-sm");

            const menuOptions = resolvedProps.menuOptions;
            const hasMenuOptions = Array.isArray(menuOptions) && menuOptions.length > 0;

            const handleButtonClick = (e: React.MouseEvent) => {
                if (hasMenuOptions) {
                    openButtonMenu(e.currentTarget, menuOptions);
                    return;
                }

                handleAction(props.onClick, e);
            };

            const handleDesktopHover = (e: React.MouseEvent) => {
                if (!hasMenuOptions) {
                    return;
                }

                const isDesktopViewport = typeof window !== 'undefined' && window.innerWidth >= 1024;
                if (!isDesktopViewport) {
                    return;
                }

                const canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;
                if (!canHover) {
                    return;
                }

                openButtonMenu(e.currentTarget, menuOptions);
            };

            return (
                <>
                    <Button
                        onClick={handleButtonClick}
                        onMouseEnter={handleDesktopHover}
                        variant={buttonVariant}
                        size="sm"
                        title={buttonLabel}
                        aria-label={buttonLabel}
                        className={buttonClassName}
                    >
                        {resolvedProps.icon && (
                            <span className={isCompactToolbarButton ? "" : "mr-2"}>{renderIcon(resolvedProps.icon)}</span>
                        )}
                        {shouldRenderLabel && resolvedProps.label}
                    </Button>

                    {fallbackMenuTrigger && (
                        <Popover
                            trigger={fallbackMenuTrigger}
                            isOpen={fallbackMenuOpen}
                            onClose={() => setFallbackMenuOpen(false)}
                            width={220}
                            header={false}
                            className="rounded-2xl bg-background border p-2 shadow-2xl"
                        >
                            <div className="flex min-w-[200px] flex-col gap-1">
                                {fallbackMenuOptions.map((option, index) => renderMenuOptionButton(option, index))}
                            </div>
                        </Popover>
                    )}

                    {fallbackOverlay && (
                        <div
                            className="fixed inset-0 z-[160] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                            onClick={(event) => {
                                if (event.target === event.currentTarget) {
                                    setFallbackOverlay(null);
                                }
                            }}
                        >
                            <div
                                className="relative max-h-[85vh] overflow-y-auto rounded-xl bg-background shadow-2xl border"
                                style={{ width: fallbackOverlay.width || 'auto', maxWidth: '90vw' }}
                            >
                                <button
                                    type="button"
                                    onClick={() => setFallbackOverlay(null)}
                                    className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>

                                <JsonRenderer
                                    component={fallbackOverlay.component}
                                    context={{
                                        ...fallbackOverlay.context,
                                        close: () => setFallbackOverlay(null),
                                        onClose: () => setFallbackOverlay(null),
                                    }}
                                />
                            </div>
                        </div>
                    )}
                </>
            );
        }
        case 'TEXT': {
            let className = resolvedProps.className || "text-sm text-foreground whitespace-pre-wrap";
            if (resolvedProps.variant === 'h4') return <h4 className={`text-base font-semibold ${resolvedProps.className || ''}`}>{resolvedProps.content}</h4>;
            if (resolvedProps.variant === 'error') className += " text-destructive bg-destructive/10 p-3 rounded-md";
            if (resolvedProps.variant === 'success') className += " text-success bg-success/10 p-3 rounded-md";
            if (resolvedProps.variant === 'body') className += " leading-relaxed bg-muted/40 p-3 rounded-lg";
            if (resolvedProps.variant === 'muted') className += " text-muted-foreground";
            return <div className={className}>{resolvedProps.content}</div>;
        }
        case 'INPUT': {
            const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                if (props.onChange) {
                    handleAction(props.onChange, e, { value: e.target.value });
                }
                if (props.bindTo) {
                    setState(props.bindTo, e.target.value);
                }
            };

            const domProps = pickDomProps(resolvedProps);
            if (resolvedProps.multiline) {
                return (
                    <textarea
                        {...domProps}
                        onChange={handleChange}
                        className="w-full min-h-[80px] rounded-xl bg-muted/50 px-3.5 py-2.5 text-sm outline-none hover:bg-muted/70 focus:bg-background focus:ring-2 focus:ring-offset-0 transition-all resize-y placeholder:text-muted-foreground disabled:opacity-50"
                    />
                );
            }
            return <Input {...domProps} onChange={handleChange} />;
        }
        case 'CARD':
            return (
                <Card>
                    <CardHeader><CardTitle>{resolvedProps.title}</CardTitle></CardHeader>
                    <CardContent>
                        {renderChildren(children)}
                    </CardContent>
                </Card>
            );
        case 'ROW':
            return (
                <div className="flex flex-row gap-2 items-center">
                    {renderChildren(children)}
                </div>
            );
        case 'COLUMN':
            return (
                <div className="flex flex-col gap-2">
                    {renderChildren(children)}
                </div>
            );
        case 'CONDITIONAL':
            if (resolvedProps.condition) {
                return <>{renderChildren((props as any).true)}</>;
            } else {
                return <>{renderChildren((props as any).false)}</>;
            }
        case 'LINK': {
            const href = safeHref(resolvedProps.url);
            if (!href) {
                return <span className="text-muted-foreground">{resolvedProps.label}</span>;
            }
            return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{resolvedProps.label}</a>;
        }
        case 'TABS': {
            // Forma A: props.tabs = [{label, content:[...]}]. Forma B: children = TAB_ITEM {value,label}.
            const rawTabs = Array.isArray(props.tabs) ? props.tabs : [];
            if (rawTabs.length === 0) {
                return children ? <ChildTabsRenderer tabs={children} context={context} /> : null;
            }
            const resolvedTabs = Array.isArray(resolvedProps.tabs) ? resolvedProps.tabs : [];

            return (
                <Tabs defaultValue={resolvedTabs[0]?.label || rawTabs[0]?.label}>
                    <TabsList>
                        {resolvedTabs.map((tab: any, i: number) => (
                            <TabsTrigger key={i} value={tab.label}>{tab.label}</TabsTrigger>
                        ))}
                    </TabsList>
                    {rawTabs.map((tab: any, i: number) => (
                        <TabsContent key={i} value={resolvedTabs[i]?.label || tab.label}>
                            {renderChildren(tab.content)}
                        </TabsContent>
                    ))}
                </Tabs>
            );
        }
        case 'MODAL':
            // Render as a proper local pseudo-modal card for inside-the-page overlays
            return (
                <div className="bg-background rounded-xl shadow-lg p-4 w-full text-left flex flex-col gap-4 max-h-full overflow-y-auto">
                    {resolvedProps.title && (
                        <div className="flex justify-between items-center pb-2 border-b flex-shrink-0">
                            <h2 className="text-base font-semibold flex items-center gap-2">
                                {resolvedProps.icon && renderIcon(resolvedProps.icon, 18, "text-primary")}
                                {resolvedProps.title}
                            </h2>
                            {/* Removing the double X button as it's handled by GlobalWindow context popup */}
                        </div>
                    )}
                    <div className="flex flex-col gap-4 text-sm text-foreground overflow-y-auto custom-scrollbar">
                        {renderChildren(children)}
                    </div>
                </div>
            );
        case 'HEADLESS':
            return null;
        case 'WIZARD':
            return (
                <WizardRenderer
                    steps={Array.isArray(resolvedProps.steps) ? resolvedProps.steps : []}
                    rawSteps={Array.isArray(props.steps) ? props.steps : []}
                    context={context}
                />
            );
        case 'SELECT':
            return (
                <div className="space-y-2">
                    <label className="text-sm font-medium">{resolvedProps.label}</label>
                    <select
                        className="w-full rounded-xl bg-muted/50 px-3.5 py-2.5 text-sm outline-none hover:bg-muted/70 focus:bg-background focus:ring-2 focus:ring-offset-0 transition-all"
                        onChange={(e) => handleAction(props.onChange, undefined, { value: e.target.value })}
                    >
                        <option value="">Select...</option>
                        {(Array.isArray(resolvedProps.options) ? resolvedProps.options : []).map((opt: any) => (
                            <option key={opt[resolvedProps.valueKey || 'value']} value={opt[resolvedProps.valueKey || 'value']}>
                                {opt[resolvedProps.labelKey || 'label']}
                            </option>
                        ))}
                    </select>
                </div>
            );
        case 'FORM':
            return (
                <JsonFormRenderer
                    fields={Array.isArray(resolvedProps.fields) ? resolvedProps.fields : []}
                    submitLabel={resolvedProps.submitLabel}
                    onSubmit={props.onSubmit}
                    context={context}
                    handleAction={handleAction}
                />
            );
        case 'LIST': {
            // Renders a list of items using a template (la plantilla se resuelve por item, no antes)
            const items = resolvedProps.items;
            if (!Array.isArray(items) || !props.itemTemplate) return null;

            return (
                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                    {items.map((item: any, i: number) => {
                        const itemContext = { ...context, item };
                        return (
                            <InnerJsonRenderer key={i} component={props.itemTemplate} context={itemContext} />
                        );
                    })}
                </div>
            );
        }
        case 'IMAGE_BUTTON': {
            const src = safeImageSrc(resolvedProps.src);
            if (!src) return null;
            return (
                <button
                    type="button"
                    className="hover:opacity-80 transition-opacity rounded-xl overflow-hidden"
                    onClick={(e) => handleAction(props.onClick, e)}
                >
                    <img src={src} alt={resolvedProps.alt} className="w-full h-auto object-cover" />
                </button>
            );
        }

        // --- New Components (Phase 2) ---

        case 'FOR_EACH': {
            const forItems = resolvedProps.items;
            if (!Array.isArray(forItems) || forItems.length === 0) {
                return props.empty ? <InnerJsonRenderer component={props.empty} context={context} /> : null;
            }
            const alias = resolvedProps.as || 'item';
            const indexAlias = resolvedProps.index || 'index';
            return (
                <>
                    {forItems.map((item: any, idx: number) => {
                        const itemContext = { ...context, [alias]: item, [indexAlias]: idx };
                        return <InnerJsonRenderer key={idx} component={props.template} context={itemContext} />;
                    })}
                </>
            );
        }

        case 'SWITCH': {
            // Forma A: props.cases = { valor: componente | [componentes] } + props.default
            // Forma B: children = CASE {value} / DEFAULT
            const value = resolvedProps.value;
            if (props.cases && typeof props.cases === 'object') {
                const matchedCase = props.cases[String(value)] || props.default;
                if (!matchedCase) return null;
                if (Array.isArray(matchedCase)) {
                    return <>{renderChildren(matchedCase)}</>;
                }
                return <InnerJsonRenderer component={matchedCase} context={context} />;
            }

            const cases = children?.filter((child: any) => child.type === 'CASE') || [];
            const defaultCase = children?.find((child: any) => child.type === 'DEFAULT');
            const match = cases.find((child: any) => child.props?.value === value);

            if (match) {
                return <InnerJsonRenderer component={match} context={context} />;
            } else if (defaultCase) {
                return <InnerJsonRenderer component={defaultCase} context={context} />;
            }
            return null;
        }

        case 'CHECKBOX':
            return (
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        className="w-4 h-4 rounded accent-primary"
                        checked={Boolean(resolvedProps.checked || state[resolvedProps.bindTo])}
                        onChange={(e) => {
                            if (resolvedProps.bindTo) setState(resolvedProps.bindTo, e.target.checked);
                            if (props.onChange) handleAction(props.onChange, e, { value: e.target.checked });
                        }}
                    />
                    <span className="text-sm">{resolvedProps.label}</span>
                </label>
            );

        case 'TOGGLE': {
            const toggleVal = resolvedProps.value ?? state[resolvedProps.bindTo] ?? false;
            return (
                <label className="flex items-center gap-3 cursor-pointer">
                    <div
                        className={`relative w-10 h-5 rounded-full transition-colors ${toggleVal ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                        onClick={() => {
                            const newVal = !toggleVal;
                            if (resolvedProps.bindTo) setState(resolvedProps.bindTo, newVal);
                            if (props.onChange) handleAction(props.onChange, null, { value: newVal });
                        }}
                    >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${toggleVal ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </div>
                    {resolvedProps.label && <span className="text-sm">{resolvedProps.label}</span>}
                </label>
            );
        }

        case 'TEXTAREA':
            return (
                <div className="space-y-1">
                    {resolvedProps.label && <label className="text-sm font-medium">{resolvedProps.label}</label>}
                    <textarea
                        className="w-full rounded-xl bg-muted/50 px-3.5 py-2.5 text-sm outline-none hover:bg-muted/70 focus:bg-background focus:ring-2 transition-all min-h-[80px] resize-y"
                        name={resolvedProps.name}
                        placeholder={resolvedProps.placeholder}
                        defaultValue={resolvedProps.defaultValue}
                        rows={resolvedProps.rows || 4}
                        onChange={(e) => {
                            if (props.bindTo) setState(props.bindTo, e.target.value);
                            if (props.onChange) handleAction(props.onChange, e, { value: e.target.value });
                        }}
                    />
                </div>
            );

        case 'BADGE':
            return (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${BADGE_VARIANTS[resolvedProps.variant || 'default'] || BADGE_VARIANTS.default} ${resolvedProps.className || ''}`}>
                    {resolvedProps.label ?? renderChildren(children)}
                </span>
            );

        case 'DIVIDER':
            return <hr className={`border-border ${resolvedProps.className || 'my-3'}`} />;

        case 'SPACER':
            return <div style={{ height: resolvedProps.size || 16 }} />;

        case 'PROGRESS': {
            const pct = Math.min(100, Math.max(0, Number(resolvedProps.value) || 0));
            return (
                <div className="space-y-1">
                    {resolvedProps.label && (
                        <div className="flex justify-between text-sm">
                            <span>{resolvedProps.label}</span>
                            <span className="text-muted-foreground">{pct}%</span>
                        </div>
                    )}
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary rounded-full transition-all duration-300"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                </div>
            );
        }

        case 'SMART_REPLY_CHIPS': {
            const suggestions = Array.isArray(resolvedProps.suggestions) ? resolvedProps.suggestions.filter(Boolean) : [];
            if (suggestions.length === 0) {
                return null;
            }

            return (
                <div className="flex flex-wrap gap-2">
                    {suggestions.map((suggestion: string, index: number) => (
                        <button
                            key={`${suggestion}-${index}`}
                            type="button"
                            onClick={(e) => handleAction(props.onSelect, e, { value: suggestion })}
                            className="inline-flex max-w-full items-center rounded-full bg-muted/60 px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
                        >
                            <span className="truncate">{suggestion}</span>
                        </button>
                    ))}
                </div>
            );
        }

        case 'LOADING':
            return (
                <div className={`flex items-center justify-center ${resolvedProps.className || 'p-4'}`}>
                    <div className="w-6 h-6 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
                    {resolvedProps.label && <span className="ml-2 text-sm text-muted-foreground">{resolvedProps.label}</span>}
                </div>
            );

        case 'ALERT':
            return (
                <div className={`p-3 rounded-lg border ${ALERT_STYLES[resolvedProps.variant || 'info'] || ALERT_STYLES.info} ${resolvedProps.className || ''}`}>
                    {resolvedProps.title && <div className="font-semibold text-sm mb-1">{resolvedProps.title}</div>}
                    <div className="text-sm">{resolvedProps.message ?? resolvedProps.description ?? renderChildren(children)}</div>
                </div>
            );

        case 'ICON': {
            // Render a real Lucide icon or an emoji/text icon fallback
            return renderIcon(resolvedProps.name, resolvedProps.size || 16, `inline-flex items-center ${resolvedProps.className || ''}`);
        }

        case 'ACCORDION':
            // Forma A: props.sections = [{title, content}]. Forma B: children = ACCORDION_ITEM.
            if (Array.isArray(props.sections)) {
                return <AccordionRenderer sections={Array.isArray(resolvedProps.sections) ? resolvedProps.sections.map((section: any, i: number) => ({ ...section, content: props.sections[i]?.content })) : []} context={context} />;
            }
            return (
                <div className="border rounded divide-y">
                    {renderChildren(children)}
                </div>
            );

        case 'GRID': {
            const columns = Number(resolvedProps.columns) || 2;
            const gap = Number(resolvedProps.gap ?? 2) * 4;
            const maxHeight = resolvedProps.maxHeight === undefined ? undefined : `${Number(resolvedProps.maxHeight) / 4}rem`;
            return (
                <div
                    className={`grid ${maxHeight ? 'overflow-y-auto' : ''} ${resolvedProps.className || ''}`}
                    style={{
                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                        gap: `${gap}px`,
                        maxHeight,
                        ...(resolvedProps.style && typeof resolvedProps.style === 'object' ? resolvedProps.style : {}),
                    }}
                >
                    {renderChildren(children)}
                </div>
            );
        }

        case 'DATA_TABLE': {
            const tableData = resolvedProps.data;
            const columns = resolvedProps.columns || [];
            if (!Array.isArray(tableData)) return null;
            return (
                <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/40">
                            <tr>
                                {columns.map((col: any, i: number) => (
                                    <th key={i} className="px-4 py-2 text-left font-medium text-muted-foreground">{col.label}</th>
                                ))}
                                {resolvedProps.actions && <th className="px-4 py-2 w-[100px]">Actions</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {tableData.map((row: any, ri: number) => (
                                <tr key={ri} className="hover:bg-muted/30">
                                    {columns.map((col: any, ci: number) => (
                                        <td key={ci} className="px-4 py-2">{row[col.key]}</td>
                                    ))}
                                    {resolvedProps.actions && (
                                        <td className="px-4 py-2 flex gap-2">
                                            {resolvedProps.actions.map((act: any, ai: number) => (
                                                <Button
                                                    key={ai}
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-8 w-8"
                                                    onClick={(e) => handleAction(act.onClick, e, { row })}
                                                    title={act.label}
                                                >
                                                    {act.icon ? <span className="text-xs">{act.icon}</span> : (act.label || 'Do')}
                                                </Button>
                                            ))}
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        }

        case 'MARKDOWN': {
            // Simple subset of markdown or allow HTML if sanitized
            const content = String(resolvedProps.content || '');
            const html = sanitizeHtml(
                content
                    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
                    .replace(/\*(.*?)\*/g, '<i>$1</i>')
                    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" class="text-primary hover:underline">$1</a>')
                    .replace(/\n/g, '<br/>')
            );
            return (
                <div
                    className={`prose text-sm ${resolvedProps.className || ''}`}
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            );
        }

        case 'FILE_UPLOAD': {
            return (
                <div className="space-y-2">
                    {resolvedProps.label && <label className="text-sm font-medium">{resolvedProps.label}</label>}
                    <Input
                        type="file"
                        accept={resolvedProps.accept}
                        onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;

                            if (props.onUpload) {
                                // If context provides upload capability
                                if (context.uploadAttachment) {
                                    try {
                                        setLoadingKeys(prev => ({ ...prev, [props.key]: true }));
                                        const result = await context.uploadAttachment(file);
                                        await handleAction(props.onSuccess, e, { result });
                                    } catch (err: any) {
                                        await handleAction(props.onError, e, { error: err.message });
                                    } finally {
                                        setLoadingKeys(prev => ({ ...prev, [props.key]: false }));
                                    }
                                } else {
                                    toast.error("Upload handler not found in context");
                                }
                            }
                        }}
                    />
                </div>
            );
        }

        // --- Logic & Control Flow ---

        case 'BLOCK':
            return (
                <div className={resolvedProps.className} style={resolvedProps.style}>
                    {renderChildren(children)}
                </div>
            );

        case 'REPEAT': {
            const count = resolvedProps.count;
            const items = resolvedProps.items;
            let loopItems: any[] = [];

            if (Array.isArray(items)) {
                loopItems = items;
            } else if (typeof count === 'number') {
                loopItems = Array.from({ length: Math.min(count, 200) }, (_, i) => i);
            }

            const alias = resolvedProps.as || 'item';
            const indexAlias = resolvedProps.index || 'index';

            return (
                <>
                    {loopItems.map((item: any, i: number) => {
                        const itemContext = { ...context, [alias]: item, [indexAlias]: i };
                        return (
                            <React.Fragment key={i}>
                                {renderChildren(children, itemContext)}
                            </React.Fragment>
                        );
                    })}
                </>
            );
        }

        case 'DEBUG':
            // Solo desarrollo: el contexto puede contener el correo abierto.
            if (process.env.NODE_ENV === 'production') return null;
            return (
                <details className="mt-2 text-xs bg-muted/50 p-2 rounded border overflow-auto max-h-40">
                    <summary className="cursor-pointer font-bold text-muted-foreground">Debug Context</summary>
                    <pre>{JSON.stringify({ context: toBackendContext(context), state, props: resolvedProps }, null, 2)}</pre>
                </details>
            );

        case 'CONDITION': {
            const ifValue = resolvedProps.if;
            const truthyBranch = Array.isArray(children) ? children : props.true;
            const falsyBranch = props.false ?? props.else;

            if (ifValue) {
                if (Array.isArray(truthyBranch)) {
                    return <>{renderChildren(truthyBranch)}</>;
                }

                return truthyBranch ? <InnerJsonRenderer component={truthyBranch} context={context} /> : null;
            }

            if (Array.isArray(falsyBranch)) {
                return <>{renderChildren(falsyBranch)}</>;
            }

            return falsyBranch ? <InnerJsonRenderer component={falsyBranch} context={context} /> : null;
        }

        case 'CASE':
        case 'DEFAULT':
        case 'TAB_ITEM':
            // Solo renderizan sus hijos; la logica la lleva el padre (SWITCH / TABS)
            return <>{renderChildren(children)}</>;

        case 'SET_VAR':
            // Componente invisible que fija una variable de estado
            return <SetVarRenderer name={resolvedProps.name} value={resolvedProps.value} />;

        // --- More UI Components ---

        case 'DATE_PICKER':
            return (
                <div className="space-y-1">
                    {resolvedProps.label && <label className="text-sm font-medium">{resolvedProps.label}</label>}
                    <input
                        type="date"
                        className="w-full rounded-xl bg-muted/50 px-3.5 py-2.5 text-sm outline-none hover:bg-muted/70 focus:bg-background focus:ring-2 focus:ring-offset-0 transition-all"
                        value={resolvedProps.value || state[resolvedProps.bindTo] || ''}
                        onChange={(e) => {
                            if (resolvedProps.bindTo) setState(resolvedProps.bindTo, e.target.value);
                            if (props.onChange) handleAction(props.onChange, e, { value: e.target.value });
                        }}
                    />
                </div>
            );

        case 'SLIDER':
            return (
                <div className="space-y-1">
                    {resolvedProps.label && <label className="text-sm font-medium flex justify-between">
                        <span>{resolvedProps.label}</span>
                        <span>{resolvedProps.value || state[resolvedProps.bindTo]}</span>
                    </label>}
                    <input
                        type="range"
                        className="w-full"
                        min={resolvedProps.min || 0}
                        max={resolvedProps.max || 100}
                        step={resolvedProps.step || 1}
                        value={resolvedProps.value || state[resolvedProps.bindTo] || 0}
                        onChange={(e) => {
                            const val = Number(e.target.value);
                            if (resolvedProps.bindTo) setState(resolvedProps.bindTo, val);
                            if (props.onChange) handleAction(props.onChange, e, { value: val });
                        }}
                    />
                </div>
            );

        case 'AVATAR': {
            const avatarSrc = resolvedProps.src ? safeImageSrc(resolvedProps.src) : null;
            return (
                <div className={`relative inline-block rounded-full overflow-hidden bg-muted ${resolvedProps.className || ''}`} style={{ width: resolvedProps.size || 32, height: resolvedProps.size || 32 }}>
                    {avatarSrc ? (
                        <img src={avatarSrc} alt={resolvedProps.alt || 'Avatar'} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground font-bold">
                            {(resolvedProps.initials || '?').substring(0, 2).toUpperCase()}
                        </div>
                    )}
                </div>
            );
        }

        case 'TOOLTIP':
            // Tooltip simple con title nativo
            return (
                <div className="group relative inline-block" title={resolvedProps.text}>
                    {renderChildren(children)}
                </div>
            );

        case 'EMPTY_STATE':
            return (
                <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground space-y-3">
                    {resolvedProps.icon && <div className="text-4xl opacity-50">{resolvedProps.icon}</div>}
                    {resolvedProps.title && <h3 className="text-lg font-medium text-foreground">{resolvedProps.title}</h3>}
                    {resolvedProps.description && <p className="text-sm max-w-xs">{resolvedProps.description}</p>}
                    {props.action && (
                        <Button
                            variant="outline"
                            onClick={(e) => handleAction(props.action, e)}
                        >
                            {resolvedProps.actionLabel || 'Action'}
                        </Button>
                    )}
                </div>
            );

        case 'IFRAME':
            return (
                <SafeIframe
                    html={resolvedProps.html || ''}
                    className={resolvedProps.className || 'w-full rounded-xl border'}
                />
            );

        case 'CODE_EDITOR':
            return (
                <div className="space-y-1">
                    {resolvedProps.label && <label className="text-sm font-medium">{resolvedProps.label}</label>}
                    <textarea
                        className="w-full rounded-xl bg-muted/50 px-3.5 py-2.5 font-mono text-xs outline-none hover:bg-muted/70 focus:bg-background focus:ring-1 transition-all min-h-[100px]"
                        value={resolvedProps.value || state[resolvedProps.bindTo] || ''}
                        onChange={(e) => {
                            if (resolvedProps.bindTo) setState(resolvedProps.bindTo, e.target.value);
                            if (props.onChange) handleAction(props.onChange, e, { value: e.target.value });
                        }}
                    />
                </div>
            );

        case 'ACCORDION_ITEM':
            return (
                <details className="group">
                    <summary className="flex cursor-pointer items-center justify-between p-4 font-medium hover:bg-muted/30">
                        {resolvedProps.title}
                        <span className="transition group-open:rotate-180">
                            <svg fill="none" height="24" shapeRendering="geometricPrecision" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="24"><path d="M6 9l6 6 6-6"></path></svg>
                        </span>
                    </summary>
                    <div className="p-4 pt-0 text-sm text-muted-foreground">
                        {renderChildren(children)}
                    </div>
                </details>
            );

        case 'CODE_BLOCK':
            return (
                <pre className="p-4 rounded bg-muted text-foreground border border-border overflow-x-auto text-xs font-mono my-2">
                    <code>{resolvedProps.code}</code>
                </pre>
            );

        // --- Layout Components ---

        case 'FLEX':
            return (
                <div
                    className={`flex ${resolvedProps.className || ''}`}
                    style={{
                        flexDirection: resolvedProps.direction || 'row',
                        alignItems: resolvedProps.align || 'stretch',
                        justifyContent: resolvedProps.justify || 'flex-start',
                        gap: `${resolvedProps.gap || 0}px`,
                        ...resolvedProps.style
                    }}
                >
                    {renderChildren(children)}
                </div>
            );

        case 'BOX':
            return (
                <div
                    className={resolvedProps.className}
                    style={{
                        padding: resolvedProps.p ? `${resolvedProps.p * 4}px` : undefined,
                        margin: resolvedProps.m ? `${resolvedProps.m * 4}px` : undefined,
                        backgroundColor: resolvedProps.bg,
                        borderRadius: resolvedProps.rounded,
                        boxShadow: resolvedProps.shadow,
                        border: resolvedProps.border,
                        ...resolvedProps.style,
                    }}
                >
                    {renderChildren(children)}
                </div>
            );

        case 'SEPARATOR':
            return <hr className={`my-4 border-border ${resolvedProps.className || ''}`} />;

        default:
            console.warn(`[JsonRenderer] Unknown component type: ${type}`);
            return null;
    }
};

/** Los OVERLAY del manifest pueden venir en la forma heredada `component: "MODAL"` (ver normalizeMount). */
function normalizeOverlay(overlay: any): JsonComponentProps {
    if (overlay && typeof overlay === 'object' && typeof overlay.type === 'string') return overlay;
    const normalized = normalizeMount({ point: 'OVERLAY', component: overlay?.component ?? overlay, props: overlay?.props });
    return normalized.component as JsonComponentProps;
}

// Exportado para pruebas y para otras superficies que necesiten evaluar una condicion suelta
export function evaluateCondition(expression: string, ctx: any, state: any): any {
    return evaluateExpression(expression, { ctx, state });
}
