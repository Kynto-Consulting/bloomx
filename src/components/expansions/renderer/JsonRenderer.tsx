
import React, { useMemo, useState, createContext, useContext, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOptionalExpansionUI } from '@/contexts/ExpansionUIContext';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { secureWrite, secureRead } from '@/lib/expansions/client/secure-storage';
import { executeExtensionAction } from '@/lib/expansions/api';
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
}
const ExtensionStateContext = createContext<ExtensionStateContextType>({ state: {}, setState: () => { } });

export const ExtensionStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, setInternalState] = useState<Record<string, any>>({});
    const setState = (key: string, value: any) => {
        setInternalState(prev => ({ ...prev, [key]: value }));
    };
    return (
        <ExtensionStateContext.Provider value={{ state, setState }}>
            {children}
        </ExtensionStateContext.Provider>
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

const JsonFormRenderer: React.FC<JsonFormRendererProps> = ({
    fields,
    submitLabel,
    onSubmit,
    context,
    handleAction,
}) => {
    const [formValues, setFormValues] = useState<Record<string, any>>({});

    useEffect(() => {
        const initialValues: Record<string, any> = {};
        for (const field of fields) {
            if (!field?.name) {
                continue;
            }
            initialValues[field.name] = field.defaultValue ?? '';
        }
        setFormValues(initialValues);
    }, [fields]);

    const setFieldValue = (fieldName: string, value: any) => {
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
    // If not already inside a provider (top level), we might need one, 
    // but usually the ExtensionLoader should wrap it or the Overlay.
    // For recursive calls, we just use the context.

    // We can't conditionally wrap. So we assume wrapper exists or we accept local state is per-component tree if not.
    // However, manifests like Hubspot assume shared state between "onLoad" and "CONDITIONAL" children.
    // So the ROOT renderer call must be wrapped in a state provider.

    return (
        <ExtensionStateProvider>
            <InnerJsonRenderer component={component} context={context} />
        </ExtensionStateProvider>
    );
};

const InnerJsonRenderer: React.FC<{ component: JsonComponentProps; context?: any }> = ({ component, context }) => {
    if (!component || typeof component !== 'object') {
        return null;
    }

    const type = typeof component.type === 'string' ? component.type : '';
    const props = component.props ?? {};

    if (!type) {
        console.warn('[JsonRenderer] Skipping invalid component without type', component);
        return null;
    }

    const children = component.children || props?.children;
    const expansionUI = useOptionalExpansionUI();
    const openOverlay = expansionUI?.openModal || context?.openOverlay;
    const closeOverlay = expansionUI?.closeModal || context?.onClose || context?.close;
    const { state, setState } = useContext(ExtensionStateContext);
    const [wizardStep, setWizardStep] = useState<number>(0);
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

    // Assume userId is available in context or we need to fetch it?
    // For now, prompt User or use a default if context.userId is missing.
    // Ideally, context should have user info.
    const userId = context?.user?.id || 'default-user';

    const parseLiteral = (value: string) => {
        const trimmed = value.trim();

        if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
            return trimmed.slice(1, -1);
        }
        if (trimmed === 'true') return true;
        if (trimmed === 'false') return false;
        if (trimmed === 'null') return null;
        if (trimmed === 'undefined') return undefined;

        const numeric = Number(trimmed);
        if (!Number.isNaN(numeric) && trimmed !== '') {
            return numeric;
        }

        return undefined;
    };

    // Helper to look up a single dotted path like "context.from.email" or "state.contact"
    const lookupPath = (key: string, ctx: any, st: any): any => {
        let actualKey = key.trim();
        let invert = false;

        if (actualKey.includes('||')) {
            const options = actualKey.split('||').map((part) => part.trim()).filter(Boolean);
            let fallback: any;

            for (const option of options) {
                const literalValue = parseLiteral(option);
                const resolved = literalValue !== undefined ? literalValue : lookupPath(option, ctx, st);
                fallback = resolved;

                if (!(resolved === undefined || resolved === null || resolved === '')) {
                    return resolved;
                }
            }

            return fallback;
        }

        const literalValue = parseLiteral(actualKey);
        if (literalValue !== undefined) {
            return literalValue;
        }

        if (actualKey.startsWith('!')) {
            invert = true;
            actualKey = actualKey.substring(1).trim();
        }

        let checkNotNull = false;
        let checkNull = false;
        if (actualKey.endsWith('!= null') || actualKey.endsWith('!== null')) {
            checkNotNull = true;
            actualKey = actualKey.replace(/!==?\s*null$/, '').trim();
        } else if (actualKey.endsWith('== null') || actualKey.endsWith('=== null')) {
            checkNull = true;
            actualKey = actualKey.replace(/===?\s*null$/, '').trim();
        }

        const parts = actualKey.split('.');
        let val: any = undefined;

        if (parts[0] === 'context') val = ctx;
        else if (parts[0] === 'state') val = st;
        else if (parts[0] === 'env') val = ctx?.env;
        else if (ctx && parts[0] in ctx) val = ctx;

        if (val) {
            let startIndex = 1;
            if (parts[0] !== 'context' && parts[0] !== 'state' && parts[0] !== 'env') {
                startIndex = 0;
            }
            for (let i = startIndex; i < parts.length; i++) {
                val = val?.[parts[i]];
            }
        }
        
        let finalVal = val;
        if (checkNotNull) finalVal = (val !== undefined && val !== null && val !== '');
        if (checkNull) finalVal = (val === undefined || val === null || val === '');
        if (invert) finalVal = !finalVal;

        return finalVal;
    };

    // Resolve variables: supports pure refs "${context.email}" AND template strings "From: ${context.from}"
    const resolveValue = (p: any, ctx: any, st: any): any => {
        if (typeof p !== 'string') return p;

        // Pure variable reference (entire string is one expression)
        if (p.startsWith('${') && p.endsWith('}') && p.indexOf('${', 2) === -1) {
            return lookupPath(p.slice(2, -1), ctx, st);
        }

        // Template string with embedded expressions
        if (p.includes('${')) {
            return p.replace(/\$\{([^}]+)\}/g, (_, key) => {
                const val = lookupPath(key.trim(), ctx, st);
                return val !== undefined && val !== null ? String(val) : '';
            });
        }

        return p;
    };

    const resolveProps = (p: any, ctx: any, st: any): any => {
        if (typeof p === 'object' && p !== null) {
            if (Array.isArray(p)) {
                return p.map((item: any) => resolveProps(item, ctx, st));
            }
            const newObj: any = {};
            for (const k in p) {
                newObj[k] = resolveProps(p[k], ctx, st);
            }
            return newObj;
        }
        // If it's a string, try resolving it.
        return resolveValue(p, ctx, st);
    };

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

        let actions = Array.isArray(actionDef)
            ? actionDef
            : (Array.isArray(actionDef.actions) ? actionDef.actions : [actionDef]);

        for (const act of actions) {
            const resolvedAct = resolveProps(act, processingContext, state);
            if (Array.isArray(resolvedAct?.actions)) {
                await handleAction(resolvedAct.actions, e, extraContext);
                continue;
            }
            console.log("handleAction executing:", resolvedAct, "with state:", state, "Context:", processingContext);

            if (resolvedAct.action === 'SET_STATE') {
                setState(resolvedAct.key, resolvedAct.value);
            }
            if (resolvedAct.action === 'OPEN_OVERLAY') {
                const { targetId } = resolvedAct;
                console.log("Opening overlay", targetId);

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
                            <JsonRenderer component={overlayDef} context={overlayContext} />,
                            { width: resolveModalWidth(overlayDef?.props?.width) }
                        );
                    } else {
                        setFallbackOverlay({
                            component: overlayDef,
                            context: overlayContext,
                            width: resolveModalWidth(overlayDef?.props?.width),
                        });
                    }
                } else {
                    console.warn(`Overlay ID ${targetId} not found in extension manifest`);
                    toast.error("Overlay not found");
                }
            }
            if (resolvedAct.action === 'OAUTH_CONNECT') {
                const provider = resolvedAct.provider; // e.g. 'google', 'slack'
                const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                const url = resolvedAct.url || `/api/auth/${provider}?returnTo=${encodeURIComponent(returnTo)}`;

                window.location.href = url;
            }

            if (resolvedAct.action === 'COPY_TO_CLIPBOARD') {
                try {
                    await navigator.clipboard.writeText(resolvedAct.text);
                    toast.success("Copied to clipboard");
                } catch (err) {
                    toast.error("Failed to copy");
                }
            }

            if (resolvedAct.action === 'OPEN_URL') {
                window.open(resolvedAct.url, '_blank', 'noopener,noreferrer');
            }

            if (resolvedAct.action === 'NAVIGATE') {
                router.push(resolvedAct.path);
            }

            if (resolvedAct.action === 'REFRESH') {
                router.refresh();
            }

            if (resolvedAct.action === 'DELAY') {
                await new Promise(resolve => setTimeout(resolve, resolvedAct.ms || 1000));
            }

            if (resolvedAct.action === 'CALL_BACKEND') {
                try {
                    const result = await executeExtensionAction(
                        context.extensionId,
                        resolvedAct.function,
                        resolvedAct.args || resolvedAct.params,
                        context // Automatically passed, but we might want to filter it? api.ts handles it.
                    );

                    if (!result.success) {
                        throw new Error(result.error || 'Request failed');
                    }

                    // Pass the result to the next action via extraContext
                    if (act.onSuccess) {
                        console.log("CALL_BACKEND SUCCESS, firing handleAction with result:", result.result);
                        await handleAction(act.onSuccess, e, { result: result.result });
                    }

                } catch (err: any) {
                    console.error("Backend Call Failed", err);
                    if (act.onError) {
                        await handleAction(act.onError, e, { error: err.message });
                    } else {
                        toast.error(err.message || "Action failed");
                    }
                }
            }
            if (resolvedAct.action === 'CALL_API') {
                try {
                    const method = (resolvedAct.method || 'GET').toUpperCase();
                    const requestHeaders: Record<string, string> = {
                        ...(resolvedAct.headers || {}),
                    };
                    const requestBody = resolvedAct.body ?? resolvedAct.args ?? resolvedAct.params;
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

                    const response = await fetch(resolvedAct.url, init);
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
                        await handleAction(act.onSuccess, e, { result });
                    }
                } catch (err: any) {
                    console.error('Client API Call Failed', err);
                    if (act.onError) {
                        await handleAction(act.onError, e, { error: err.message });
                    } else {
                        toast.error(err.message || 'Action failed');
                    }
                }
            }
            if (resolvedAct.action === 'TOAST') {
                if (resolvedAct.variant === 'error') {
                    toast.error(resolvedAct.message);
                } else if (resolvedAct.variant === 'success') {
                    toast.success(resolvedAct.message);
                } else {
                    toast(resolvedAct.message);
                }
            }
            if (resolvedAct.action === 'SET_SUBJECT') {
                const nextSubject = resolvedAct.subject ?? resolvedAct.value;
                const currentSubject = typeof context.subject === 'string' ? context.subject.trim() : '';

                if (nextSubject && context.setSubject && (!resolvedAct.ifEmpty || !currentSubject)) {
                    await context.setSubject(nextSubject);
                }
            }
            if (resolvedAct.action === 'ADD_ATTACHMENT') {
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
            }
            if (resolvedAct.action === 'INSERT_CONTENT') {
                console.log("Insert content", resolvedAct.content);
                if (context.insertBody) {
                    context.insertBody(resolvedAct.content);
                } else {
                    console.warn("No insertBody method in context");
                    toast.error("Cannot insert content: Editor context missing");
                }

                // Handle closeOverlay if requested in the same action scope?
                // Some manifests might omit "closeOverlay" action and expect it.
                // Zoom manifest has "closeOverlay": true in the action props.
                if (resolvedAct.closeOverlay) {
                    closeAnyOverlay();
                }
            }
            if (resolvedAct.action === 'APPEND_BODY') {
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
            }
            if (resolvedAct.action === 'CLOSE_OVERLAY') {
                closeAnyOverlay();
            }
            if (resolvedAct.action === 'SET_CONTEXT_VALUE') {
                const targetKey = resolvedAct.key;
                if (targetKey && typeof context?.[targetKey] === 'function') {
                    context[targetKey](resolvedAct.value);
                } else {
                    toast.error(`Context setter '${targetKey}' is unavailable`);
                }
            }
            if (resolvedAct.action === 'NEXT_STEP') {
                setWizardStep(prev => prev + 1);
            }
            if (resolvedAct.action === 'PREV_STEP') {
                setWizardStep(prev => prev - 1);
            }

            // --- Secure Storage Actions ---
            if (resolvedAct.action === 'SECURE_SAVE') {
                try {
                    await secureWrite(resolvedAct.key, resolvedAct.value, userId);
                    if (act.onSuccess) {
                        await handleAction(act.onSuccess, e, extraContext);
                    }
                } catch (err: any) {
                    console.error("Secure Save Failed", err);
                    if (act.onError) await handleAction(act.onError, e, { error: err.message });
                }
            }
            if (resolvedAct.action === 'SECURE_READ') {
                try {
                    const val = await secureRead(resolvedAct.key, userId);
                    // Usually we want to set this to state
                    if (resolvedAct.targetState) {
                        setState(resolvedAct.targetState, val);
                    }
                    if (act.onSuccess) {
                        await handleAction(act.onSuccess, e, { ...extraContext, value: val });
                    }
                } catch (err: any) {
                    console.error("Secure Read Failed", err);
                    if (act.onError) await handleAction(act.onError, e, { error: err.message });
                }
            }

            // --- Navigation & UI Actions ---
            if (resolvedAct.action === 'OPEN_URL') {
                window.open(resolvedAct.url, resolvedAct.target || '_blank');
            }
            if (resolvedAct.action === 'NAVIGATE') {
                router.push(resolvedAct.path);
            }
            if (resolvedAct.action === 'CONFIRM') {
                const confirmed = window.confirm(resolvedAct.message || 'Are you sure?');
                if (confirmed && act.onConfirm) {
                    await handleAction(act.onConfirm, e, extraContext);
                } else if (!confirmed && act.onCancel) {
                    await handleAction(act.onCancel, e, extraContext);
                }
            }
            if (resolvedAct.action === 'COPY_TO_CLIPBOARD') {
                try {
                    await navigator.clipboard.writeText(resolvedAct.text);
                    toast.success(resolvedAct.successMessage || 'Copied!');
                } catch {
                    toast.error('Failed to copy');
                }
            }
            if (resolvedAct.action === 'SET_LOADING') {
                setLoadingKeys(prev => ({ ...prev, [resolvedAct.key]: resolvedAct.value ?? true }));
            }
            if (resolvedAct.action === 'DELAY') {
                await new Promise(resolve => setTimeout(resolve, resolvedAct.ms || 1000));
            }

            // --- State Manipulation ---
            if (resolvedAct.action === 'MERGE_STATE') {
                const existing = state[resolvedAct.key] || {};
                setState(resolvedAct.key, { ...existing, ...resolvedAct.value });
            }
            if (resolvedAct.action === 'MAP_ARRAY') {
                const arr = state[resolvedAct.source];
                if (Array.isArray(arr)) {
                    const mapped = arr.map((item: any) => {
                        const itemCtx = { ...processingContext, item };
                        return resolveProps(resolvedAct.template, itemCtx, state);
                    });
                    setState(resolvedAct.target || resolvedAct.source, mapped);
                }
            }
            if (resolvedAct.action === 'FILTER_ARRAY') {
                const arr = state[resolvedAct.source];
                if (Array.isArray(arr)) {
                    const filtered = arr.filter((item: any) => {
                        const itemCtx = { ...processingContext, item };
                        return resolveValue(resolvedAct.condition, itemCtx, state);
                    });
                    setState(resolvedAct.target || resolvedAct.source, filtered);
                }
            }

            if (resolvedAct.action === 'OAUTH_DISCONNECT') {
                try {
                    await fetch(`/api/auth/oauth/${resolvedAct.provider}/disconnect`, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ extensionId: context.extensionId })
                    });
                    toast.success('Disconnected');
                    if (act.onSuccess) await handleAction(act.onSuccess, e, extraContext);
                } catch {
                    toast.error('Failed to disconnect');
                }
            }
        }
    };

    // Auto-run onLoad
    useEffect(() => {
        if (!props?.onLoad) return;

        const shouldRunOnLoad = resolvedProps.onLoadWhen === undefined
            ? true
            : Boolean(
                typeof resolvedProps.onLoadWhen === 'string'
                    ? resolvedProps.onLoadWhen.trim()
                    : resolvedProps.onLoadWhen
            );

        if (shouldRunOnLoad) {
            handleAction(props.onLoad);
        }
    }, [props?.onLoad, resolvedProps.onLoadWhen]);

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
            if (resolvedProps.variant === 'error') className += " text-red-500 bg-red-50 p-3 rounded-md";
            if (resolvedProps.variant === 'success') className += " text-green-600 bg-green-50 p-3 rounded-md";
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
            
            if (resolvedProps.multiline) {
                const { multiline, ...textareaProps } = resolvedProps;
                return (
                    <textarea 
                        {...textareaProps}
                        onChange={handleChange}
                        className="w-full min-h-[80px] rounded-xl bg-muted/50 px-3.5 py-2.5 text-sm outline-none hover:bg-muted/70 focus:bg-background focus:ring-2 focus:ring-offset-0 transition-all resize-y placeholder:text-muted-foreground disabled:opacity-50"
                    />
                );
            }
            return <Input {...resolvedProps} onChange={handleChange} />;
        }
        case 'CARD':
            return (
                <Card>
                    <CardHeader><CardTitle>{resolvedProps.title}</CardTitle></CardHeader>
                    <CardContent>
                        {children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}
                    </CardContent>
                </Card>
            );
        case 'ROW':
            return (
                <div className="flex flex-row gap-2 items-center">
                    {children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}
                </div>
            );
        case 'COLUMN':
            return (
                <div className="flex flex-col gap-2">
                    {children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}
                </div>
            );
        case 'CONDITIONAL':
            if (resolvedProps.condition) {
                return <>{(props as any).true?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}</>;
            } else {
                return <>{(props as any).false?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}</>;
            }
        case 'LINK':
            return <a href={resolvedProps.url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">{resolvedProps.label}</a>;
        case 'TABS': {
            const rawTabs = Array.isArray(props.tabs) ? props.tabs : [];
            const resolvedTabs = Array.isArray(resolvedProps.tabs) ? resolvedProps.tabs : [];
            if (rawTabs.length === 0) {
                return null;
            }

            return (
                <Tabs defaultValue={resolvedTabs[0]?.label || rawTabs[0]?.label}>
                    <TabsList>
                        {resolvedTabs.map((tab: any, i: number) => (
                            <TabsTrigger key={i} value={tab.label}>{tab.label}</TabsTrigger>
                        ))}
                    </TabsList>
                    {rawTabs.map((tab: any, i: number) => (
                        <TabsContent key={i} value={resolvedTabs[i]?.label || tab.label}>
                            {tab.content?.map((child: any, k: number) => <InnerJsonRenderer key={k} component={child} context={context} />)}
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
                        {children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}
                    </div>
                </div>
            );
        case 'HEADLESS':
            return null;
        case 'WIZARD':
            const step = resolvedProps.steps[wizardStep];
            if (!step) {
                return null;
            }
            return (
                <div className="space-y-4">
                    <h3 className="text-lg font-medium">{step.title}</h3>
                    <div>
                        {step.content?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}
                    </div>
                    <div className="flex justify-between mt-4">
                        <Button disabled={wizardStep === 0} onClick={() => setWizardStep(s => s - 1)} variant="outline">Back</Button>
                        {/* Next button usually handled by content actions, but we could add default */}
                    </div>
                </div>
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
                        {resolvedProps.options?.map((opt: any) => (
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
        case 'LIST':
            // Renders a list of items using a template
            const items = resolvedProps.items;
            if (!Array.isArray(items)) return null;

            return (
                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                    {items.map((item: any, i: number) => {
                        const itemContext = { ...context, item };
                        return (
                            <InnerJsonRenderer key={i} component={resolvedProps.itemTemplate} context={itemContext} />
                        );
                    })}
                </div>
            );
        case 'IMAGE_BUTTON':
            return (
                <button
                    className="hover:opacity-80 transition-opacity rounded-xl overflow-hidden"
                    onClick={(e) => handleAction(props.onClick, e)}
                >
                    <img src={resolvedProps.src} alt={resolvedProps.alt} className="w-full h-auto object-cover" />
                </button>
            );

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
            const switchValue = resolvedProps.value;
            const cases = resolvedProps.cases || {};
            const matchedCase = cases[switchValue] || resolvedProps.default;
            if (!matchedCase) return null;
            if (Array.isArray(matchedCase)) {
                return <>{matchedCase.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}</>;
            }
            return <InnerJsonRenderer component={matchedCase} context={context} />;
        }

        case 'CHECKBOX':
            return (
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        className="w-4 h-4 rounded accent-primary"
                        checked={resolvedProps.checked || state[resolvedProps.bindTo] || false}
                        onChange={(e) => {
                            if (resolvedProps.bindTo) setState(resolvedProps.bindTo, e.target.checked);
                            if (props.onChange) handleAction(props.onChange, e, { value: e.target.checked });
                        }}
                    />
                    <span className="text-sm">{resolvedProps.label}</span>
                </label>
            );

        case 'TOGGLE':
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
            const badgeVariants: Record<string, string> = {
                default: 'bg-muted text-muted-foreground',
                primary: 'bg-primary/10 text-primary',
                success: 'bg-green-100 text-green-700',
                warning: 'bg-yellow-100 text-yellow-700',
                error: 'bg-red-100 text-red-700',
            };
            return (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badgeVariants[resolvedProps.variant || 'default']}`}>
                    {resolvedProps.label}
                </span>
            );

        case 'DIVIDER':
            return <hr className={`border-border ${resolvedProps.className || 'my-3'}`} />;

        case 'SPACER':
            return <div style={{ height: resolvedProps.size || 16 }} />;

        case 'PROGRESS': {
            const pct = Math.min(100, Math.max(0, resolvedProps.value || 0));
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

        case 'ALERT': {
            const alertStyles: Record<string, string> = {
                info: 'bg-blue-50 border-blue-200 text-blue-800',
                success: 'bg-green-50 border-green-200 text-green-800',
                warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
                error: 'bg-red-50 border-red-200 text-red-800',
            };
            return (
                <div className={`p-3 rounded-lg border ${alertStyles[resolvedProps.variant || 'info']}`}>
                    {resolvedProps.title && <div className="font-semibold text-sm mb-1">{resolvedProps.title}</div>}
                    <div className="text-sm">{resolvedProps.message}</div>
                </div>
            );
        }

        case 'ICON': {
            // Render a real Lucide icon or an emoji/text icon fallback
            return renderIcon(resolvedProps.name, resolvedProps.size || 16, `inline-flex items-center ${resolvedProps.className || ''}`);
        }

        case 'ACCORDION': {
            const [openSections, setOpenSections] = useState<Record<number, boolean>>({});
            return (
                <div className="rounded-xl bg-muted/20 divide-y divide-border overflow-hidden">
                    {resolvedProps.sections?.map((section: any, i: number) => (
                        <div key={i}>
                            <button
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
        }

        case 'GRID': {
            const cols = resolvedProps.columns || 2;
            return (
                <div className={`grid gap-${resolvedProps.gap || 2} max-h-${resolvedProps.maxHeight || 60} overflow-y-auto`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                    {children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}
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
            const content = resolvedProps.content || '';
            const html = sanitizeHtml(
                content
                    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
                    .replace(/\*(.*?)\*/g, '<i>$1</i>')
                    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" class="text-blue-500 hover:underline">$1</a>')
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
                                    // Fallback: Read as base64 and pass to action?
                                    // Or just warn
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
                    {children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}
                </div>
            );

        case 'REPEAT': {
            const count = resolvedProps.count;
            const items = resolvedProps.items;
            let loopItems: any[] = [];

            if (Array.isArray(items)) {
                loopItems = items;
            } else if (typeof count === 'number') {
                loopItems = Array.from({ length: count }, (_, i) => i);
            }

            const alias = resolvedProps.as || 'item';
            const indexAlias = resolvedProps.index || 'index';

            return (
                <>
                    {loopItems.map((item: any, i: number) => {
                        const itemContext = { ...context, [alias]: item, [indexAlias]: i };
                        return (
                            <React.Fragment key={i}>
                                {children?.map((child: any, k: number) => <InnerJsonRenderer key={k} component={child} context={itemContext} />)}
                            </React.Fragment>
                        );
                    })}
                </>
            );
        }

        case 'DEBUG':
            return (
                <details className="mt-2 text-xs bg-muted/50 p-2 rounded border overflow-auto max-h-40">
                    <summary className="cursor-pointer font-bold text-muted-foreground">Debug Context</summary>
                    <pre>{JSON.stringify({ context, state, props: resolvedProps }, null, 2)}</pre>
                </details>
            );

        case 'CONDITION': {
            const ifValue = resolvedProps.if;
            const truthyBranch = Array.isArray(children) ? children : resolvedProps.true;
            const falsyBranch = resolvedProps.false ?? resolvedProps.else;

            if (ifValue) {
                if (Array.isArray(truthyBranch)) {
                    return <>{truthyBranch.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}</>;
                }

                return truthyBranch ? <InnerJsonRenderer component={truthyBranch} context={context} /> : null;
            }

            if (Array.isArray(falsyBranch)) {
                return <>{falsyBranch.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}</>;
            }

            return falsyBranch ? <InnerJsonRenderer component={falsyBranch} context={context} /> : null;
        }

        case 'SWITCH': {
            const value = resolvedProps.value;
            const cases = children?.filter((child: any) => child.type === 'CASE') || [];
            const defaultCase = children?.find((child: any) => child.type === 'DEFAULT');

            const match = cases.find((child: any) => child.props.value === value);

            if (match) {
                return <InnerJsonRenderer component={match} context={context} />;
            } else if (defaultCase) {
                return <InnerJsonRenderer component={defaultCase} context={context} />;
            }
            return null;
        }

        case 'CASE':
        case 'DEFAULT':
            // These just render their children, logic is handled by parent SWITCH
            return <>{children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}</>;

        case 'SET_VAR':
            // Invisible component to set state logic
            // Careful with infinite loops
            useEffect(() => {
                if (resolvedProps.name && resolvedProps.value !== undefined) {
                    // Check if different to avoid loop?
                    if (state[resolvedProps.name] !== resolvedProps.value) {
                        setState(resolvedProps.name, resolvedProps.value);
                    }
                }
            }, [resolvedProps.name, resolvedProps.value]); // Dependencies matter
            return null;

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

        case 'AVATAR':
            return (
                <div className={`relative inline-block rounded-full overflow-hidden bg-muted ${resolvedProps.className}`} style={{ width: resolvedProps.size || 32, height: resolvedProps.size || 32 }}>
                    {resolvedProps.src ? (
                        <img src={resolvedProps.src} alt={resolvedProps.alt || 'Avatar'} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground font-bold">
                            {(resolvedProps.initials || '?').substring(0, 2).toUpperCase()}
                        </div>
                    )}
                </div>
            );

        case 'TOOLTIP':
            // Simple tooltip wrapper since we don't have the full component handy yet
            // or use Popover on hover? Popover is typically click.
            // Let's use standard title for MVP or a relative group.
            return (
                <div className="group relative inline-block" title={resolvedProps.text}>
                    {children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}
                </div>
            );

        case 'EMPTY_STATE':
            return (
                <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground space-y-3">
                    {resolvedProps.icon && <div className="text-4xl opacity-50">{resolvedProps.icon}</div>}
                    {resolvedProps.title && <h3 className="text-lg font-medium text-foreground">{resolvedProps.title}</h3>}
                    {resolvedProps.description && <p className="text-sm max-w-xs">{resolvedProps.description}</p>}
                    {resolvedProps.action && (
                        <Button
                            variant="outline"
                            onClick={(e) => handleAction(resolvedProps.action, e)}
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

        case 'ACCORDION':
            return (
                <div className="border rounded divide-y">
                    {children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}
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
                        {children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}
                    </div>
                </details>
            );

        case 'TABS': {
            const defaultValue = children?.[0]?.props?.value;
            const [activeTab, setActiveTab] = useState(defaultValue);

            return (
                <div className="w-full">
                    <div className="flex border-b">
                        {children?.map((child: any, i: number) => (
                            <button
                                key={i}
                                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === child.props.value
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                                    }`}
                                onClick={() => setActiveTab(child.props.value)}
                            >
                                {child.props.label}
                            </button>
                        ))}
                    </div>
                    <div className="p-4">
                        {children?.map((child: any, i: number) => (
                            <div key={i} className={activeTab === child.props.value ? 'block' : 'hidden'}>
                                {/* Render children of TAB_ITEM */}
                                <InnerJsonRenderer component={child} context={context} />
                            </div>
                        ))}
                    </div>
                </div>
            );
        }

        case 'TAB_ITEM':
            return <>{children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}</>;

        case 'BADGE':
            return (
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${resolvedProps.variant === 'secondary' ? 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80' :
                    resolvedProps.variant === 'destructive' ? 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80' :
                        resolvedProps.variant === 'outline' ? 'text-foreground' :
                            'border-transparent bg-primary text-primary-foreground hover:bg-primary/80'
                    } ${resolvedProps.className}`}>
                    {resolvedProps.label || children}
                </span>
            );

        case 'PROGRESS':
            return (
                <div className="w-full bg-muted rounded-full h-2.5">
                    <div className="bg-primary h-2.5 rounded-full" style={{ width: `${Math.min(100, Math.max(0, resolvedProps.value || 0))}%` }}></div>
                </div>
            );

        case 'CODE_BLOCK':
            return (
                <pre className="p-4 rounded bg-slate-950 text-slate-50 overflow-x-auto text-xs font-mono my-2">
                    <code>{resolvedProps.code}</code>
                </pre>
            );

        case 'ALERT':
            return (
                <div className={`p-4 rounded-lg border ${resolvedProps.variant === 'destructive' ? 'bg-red-50 text-red-900 border-red-200' :
                        resolvedProps.variant === 'warning' ? 'bg-yellow-50 text-yellow-900 border-yellow-200' :
                            'bg-blue-50 text-blue-900 border-blue-200'
                    } ${resolvedProps.className}`}>
                    {resolvedProps.title && <h5 className="font-medium mb-1">{resolvedProps.title}</h5>}
                    <div className="text-sm">{resolvedProps.description || children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}</div>
                </div>
            );

        // --- Layout Components ---

        case 'GRID':
            return (
                <div
                    className={`grid ${resolvedProps.className || ''}`}
                    style={{
                        gridTemplateColumns: `repeat(${resolvedProps.columns || 1}, minmax(0, 1fr))`,
                        gap: `${resolvedProps.gap || 4}px`,
                        ...resolvedProps.style
                    }}
                >
                    {children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}
                </div>
            );

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
                    {children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}
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
                    {children?.map((child: any, i: number) => <InnerJsonRenderer key={i} component={child} context={context} />)}
                </div>
            );

        case 'SEPARATOR':
            return <hr className={`my-4 border-border ${resolvedProps.className || ''}`} />;

        default:
            console.warn(`[JsonRenderer] Unknown component type: ${type}`);
            return null;
    }
};