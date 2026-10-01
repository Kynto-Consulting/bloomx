'use client';

/**
 * Simulador interactivo de un componente del kit (cargado con next/dynamic desde ComponentPage: no pesa en el resto de /docs).
 *
 * Seguridad: solo se renderiza el JSON VALIDADO con el esquema (evaluateNodeText); sin eval; sin red (CALL_BACKEND usa un
 * backend simulado y el renderer corre en modo `dryRun`: avisos, navegacion, URL y portapapeles solo se registran).
 * Funciona sin sesion: no llama a ninguna API autenticada.
 */
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { JsonRenderer, type RendererRuntime } from '@/components/expansions/renderer/JsonRenderer';
import { ExtensionErrorBoundary } from '@/components/expansions/kit/ExtensionError';
import { ExpansionUIContext } from '@/contexts/ExpansionUIContext';
import { CodeEditor, type CodeEditorHandle } from '@/components/extensions/tools/CodeEditor';
import { UI_COMPONENTS, UI_LIMITS } from '@/lib/expansions/ui-schema';
import { EXAMPLE_OVERLAYS } from '@/lib/expansions/ui-examples';
import { parseJson } from '@/lib/expansions/playground/analyze';
import { useI18n } from '@/components/I18nProvider';
import { actionDetail, createMockCaller, createSimLog, DEFAULT_MOCK, evaluateNodeText, fieldText, findNodePath, formFields, nodeAt, parseFieldInput, parseMock, prettyJson, setNodeProp, simContext, SIM_MOUNT_POINTS, TOOLBAR_POINTS, updateAt, type FormField, type MockConfig, type SimEvent, type ToolbarMode } from '../../_content/ui-kit/simulator-core';
import { PRESET_KIND_LABEL, presetsFor, type Preset } from '../../_content/ui-kit/presets';
import { manifestSnippet } from '../../_content/ui-kit/component-docs';
import { fill, kitStrings } from './strings';

const btn = 'inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';
const field = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const card = 'rounded-lg border border-border bg-card p-4 text-card-foreground';
const cap = 'text-xs font-medium text-muted-foreground';

const stable = (value: unknown): string => { try { return JSON.stringify(value) ?? ''; } catch { return ''; } };
const isRecord = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);

// ------------------------------------------------------------------ control generado del esquema
function FieldControl({ id, f, value, onCommit, strings }: { id: string; f: FormField; value: unknown; onCommit: (value: unknown) => void; strings: ReturnType<typeof kitStrings> }) {
    const shown = fieldText(value);
    const [draft, setDraft] = useState(shown);
    const [error, setError] = useState('');
    const ref = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);
    // Si el valor cambia desde otro sitio (editor JSON, preset) y este control no tiene el foco, se actualiza.
    useEffect(() => { if (typeof document === 'undefined' || document.activeElement !== ref.current) { setDraft(shown); setError(''); } }, [shown]);

    const commit = (text: string) => {
        setDraft(text);
        const parsed = parseFieldInput(f, text);
        if (!parsed.ok) { setError(parsed.message); return; }
        setError('');
        onCommit(parsed.value);
    };
    const describedBy = error ? `${id}-err` : undefined;
    const isEnumLike = f.kind === 'enum' || (f.kind === 'boolean' && typeof value !== 'string');
    return (
        <div className="space-y-1">
            <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
                <code className="font-mono font-semibold">{f.name}</code>
                {f.spec.required && <span className="text-destructive" title={strings.colRequired}>*</span>}
                <span className="font-normal text-muted-foreground">{f.spec.k}</span>
            </label>
            {isEnumLike ? (
                <select id={id} ref={ref} value={draft} aria-invalid={error ? true : undefined} aria-describedby={describedBy} onChange={(e) => commit(e.target.value)} className={field}>
                    <option value="">{f.spec.def !== undefined ? `(${strings.colDefault}: ${String(f.spec.def)})` : '—'}</option>
                    {(f.kind === 'boolean' ? ['true', 'false'] : (f.spec.values ?? []).map(String)).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
            ) : f.kind === 'json' ? (
                <textarea id={id} ref={ref} value={draft} rows={2} spellCheck={false} aria-invalid={error ? true : undefined} aria-describedby={describedBy} onChange={(e) => commit(e.target.value)} className="min-h-[4rem] w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            ) : (
                <input id={id} ref={ref} type="text" inputMode={f.kind === 'number' ? 'decimal' : undefined} value={draft} aria-invalid={error ? true : undefined} aria-describedby={describedBy} onChange={(e) => commit(e.target.value)} className={field} placeholder={f.spec.def !== undefined ? String(f.spec.def) : ''} />
            )}
            {f.spec.doc && <p className="text-[11px] text-muted-foreground">{f.spec.doc}</p>}
            {error && <p id={`${id}-err`} role="alert" className="text-[11px] text-destructive">{error}</p>}
        </div>
    );
}

// ------------------------------------------------------------------ descripcion de interacciones
function describeTarget(el: Element | null): string {
    const target = el?.closest('button,a,[role="button"],[role="menuitem"],[role="tab"],[role="option"],[role="checkbox"],[role="switch"],[role="radio"],input,select,textarea,summary');
    if (!target) return el?.tagName.toLowerCase() ?? '?';
    const label = target.getAttribute('aria-label') || (target.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || target.getAttribute('name') || target.id || '';
    const role = target.getAttribute('role') || target.tagName.toLowerCase();
    return label ? `${role} "${label}"` : role;
}

export interface SimulatorProps { type: string }

export default function Simulator({ type }: SimulatorProps) {
    const { locale } = useI18n();
    const t = kitStrings(locale);
    const spec = UI_COMPONENTS[type];
    const presets = useMemo<Preset[]>(() => presetsFor(type), [type]);
    const first = presets[0];

    const [presetId, setPresetId] = useState(first?.id ?? '');
    const [text, setText] = useState(() => prettyJson(first?.node ?? { type }));
    const [stateText, setStateText] = useState(() => prettyJson(first?.state ?? {}));
    const [point, setPoint] = useState('EMAIL_TOOLBAR');
    const [toolbar, setToolbar] = useState<ToolbarMode>('off');
    const [contextText, setContextText] = useState(() => prettyJson(simContext('EMAIL_TOOLBAR', 'off')));
    const [mock, setMock] = useState<MockConfig>(DEFAULT_MOCK);
    const [tab, setTab] = useState<'form' | 'json'>('form');
    const [events, setEvents] = useState<SimEvent[]>([]);
    const [toasts, setToasts] = useState<Array<{ id: number; message: string; variant: string }>>([]);
    const [live, setLive] = useState<Record<string, any>>({});
    const [resetCount, setResetCount] = useState(0);
    const [status, setStatus] = useState('');
    const editorRef = useRef<CodeEditorHandle>(null);
    const logEndRef = useRef<HTMLOListElement>(null);

    // ---- validacion en vivo (con el validador del esquema)
    const deferred = useDeferredValue(text);
    const evaluation = useMemo(() => evaluateNodeText(deferred), [deferred]);
    const lastValid = useRef<Record<string, any> | null>(null);
    if (evaluation.status === 'ok' && evaluation.node) lastValid.current = evaluation.node;
    const shownNode = evaluation.status === 'ok' && evaluation.node ? evaluation.node : lastValid.current;

    const stateParse = useMemo(() => parseJson(stateText), [stateText]);
    const lastState = useRef<Record<string, any>>({});
    const stateError = !stateParse.ok ? stateParse.message : !isRecord(stateParse.value) ? 'El estado debe ser un objeto { "clave": valor }' : '';
    if (stateParse.ok && isRecord(stateParse.value)) lastState.current = stateParse.value;
    const initialState = lastState.current;

    const contextParse = useMemo(() => parseJson(contextText), [contextText]);
    const lastContext = useRef<Record<string, any>>(simContext('EMAIL_TOOLBAR'));
    const contextError = !contextParse.ok ? contextParse.message : !isRecord(contextParse.value) ? 'El contexto debe ser un objeto' : '';
    if (contextParse.ok && isRecord(contextParse.value)) lastContext.current = contextParse.value;
    const context = useMemo(() => ({ ...lastContext.current, overlays: EXAMPLE_OVERLAYS }), [contextText]); // eslint-disable-line react-hooks/exhaustive-deps

    // ---- registro de eventos
    const log = useRef(createSimLog());
    const push = useCallback((event: Omit<SimEvent, 'id' | 'time'>) => {
        const made = log.current.make(event);
        setEvents((list) => log.current.append(list, made));
        return made;
    }, []);

    const mockRef = useRef(mock);
    mockRef.current = mock;
    const toastId = useRef(0);
    const runtime = useMemo<RendererRuntime>(() => ({
        dryRun: true,
        onStateChange: setLive,
        onAction: (step) => {
            push({ kind: 'action', name: step.action || '(sin action)', detail: actionDetail(step.args), depth: step.depth });
            if (step.action === 'TOAST') {
                const variant = String(step.args.variant ?? step.args.tone ?? 'info');
                setToasts((list) => [...list.slice(-3), { id: ++toastId.current, message: String(step.args.message ?? ''), variant }]);
            }
        },
        callBackend: createMockCaller(() => parseMock(mockRef.current), ({ fn, params, response }) => {
            push({ kind: 'backend', name: fn, detail: response.success ? { params, result: response.result } : { params, error: response.error }, outcome: response.success ? 'ok' : 'error' });
        }),
    }), [push]);

    useEffect(() => { const el = logEndRef.current; if (el) el.scrollTop = el.scrollHeight; }, [events]);
    useEffect(() => { if (!status) return; const h = setTimeout(() => setStatus(''), 2500); return () => clearTimeout(h); }, [status]);

    // ---- acciones
    const applyPreset = useCallback((preset: Preset) => {
        setPresetId(preset.id);
        setText(prettyJson(preset.node));
        setStateText(prettyJson(preset.state ?? {}));
        setEvents([]); setToasts([]); setLive({});
        setResetCount((n) => n + 1);
    }, []);
    const reset = () => {
        if (first) applyPreset(first); else { setText(prettyJson({ type })); setStateText('{}'); setResetCount((n) => n + 1); }
        setPresetId(first?.id ?? '');
        setMock(DEFAULT_MOCK);
        setPoint('EMAIL_TOOLBAR'); setToolbar('off'); setContextText(prettyJson(simContext('EMAIL_TOOLBAR', 'off')));
        setStatus(t.reset);
    };
    const changePoint = (next: string) => {
        setPoint(next);
        const mode: ToolbarMode = TOOLBAR_POINTS.has(next) ? toolbar : 'off';
        if (mode !== toolbar) setToolbar(mode);
        setContextText(prettyJson(simContext(next, mode)));
    };
    const changeToolbar = (mode: ToolbarMode) => { setToolbar(mode); setContextText(prettyJson(simContext(point, mode))); };
    const copy = async (value: string) => {
        try { await navigator.clipboard.writeText(value); setStatus(t.copied); } catch { setStatus(t.copyFailed); }
    };

    // ---- formulario generado: edita las props del nodo del componente dentro del JSON
    const textParse = useMemo(() => parseJson(text), [text]);
    const rootNode = textParse.ok && isRecord(textParse.value) ? textParse.value : undefined;
    const nodePath = rootNode ? findNodePath(rootNode, type) : undefined;
    const target = rootNode && nodePath ? nodeAt(rootNode, nodePath) : undefined;
    const fields = useMemo(() => formFields(spec?.props ?? {}), [spec]);
    const edit = (name: string, value: unknown) => {
        if (!rootNode || !nodePath) return;
        const next = updateAt(rootNode, nodePath, (n) => setNodeProp(n, name, value));
        setText(prettyJson(next));
    };

    // ---- interacciones en la vista previa (clic/cambio/envio) y enlaces bloqueados
    const onClickCapture = (e: React.MouseEvent) => {
        const el = e.target as Element;
        const anchor = el.closest?.('a[href]');
        push({ kind: 'interaction', name: t.interaction.click, detail: describeTarget(el) });
        if (anchor) {
            e.preventDefault();
            push({ kind: 'interaction', name: 'navegación bloqueada', detail: anchor.getAttribute('href') ?? '' });
        }
    };
    const onChangeCapture = (e: React.ChangeEvent) => {
        const el = e.target as HTMLInputElement;
        push({ kind: 'interaction', name: t.interaction.change, detail: { target: describeTarget(el), value: el.type === 'password' ? '••••' : el.type === 'checkbox' || el.type === 'radio' ? el.checked : String(el.value ?? '').slice(0, 80) } });
    };
    const onSubmitCapture = (e: React.FormEvent) => { push({ kind: 'interaction', name: t.interaction.submit, detail: describeTarget(e.target as Element) }); };

    const groups = useMemo(() => {
        const map = new Map<string, Preset[]>();
        for (const p of presets) map.set(p.kind, [...(map.get(p.kind) ?? []), p]);
        return [...map.entries()];
    }, [presets]);
    const mockParsed = useMemo(() => parseMock(mock), [mock]);
    const mountKey = `${resetCount}:${stable(initialState)}`;
    const errorLines = evaluation.errors.filter((e) => e.line !== undefined).map((e) => e.line!);
    const issueRows = (title: string, items: typeof evaluation.errors, tone: string) => items.length > 0 && (
        <div>
            <h4 className={`text-xs font-semibold ${tone}`}>{title} ({items.length})</h4>
            <ul className="mt-1 space-y-1">
                {items.slice(0, 12).map((e, i) => (
                    <li key={i} className="rounded bg-muted px-2 py-1 text-xs text-foreground">
                        <code className="font-mono font-semibold">{e.path}</code>
                        {e.line !== undefined && <button type="button" className="ml-2 text-link underline hover:text-link-hover" onClick={() => editorRef.current?.jumpTo(e.line!, e.column)}>{fill(t.line, { line: e.line, col: e.column ?? 1 })}</button>}
                        <span className="block text-muted-foreground">{e.message}</span>
                    </li>
                ))}
            </ul>
        </div>
    );

    if (!spec) return null;
    const tabBtn = (id: 'form' | 'json', label: string) => (
        <button key={id} type="button" role="tab" id={`sim-tab-${id}`} aria-selected={tab === id} aria-controls={`sim-panel-${id}`} onClick={() => setTab(id)}
            className={`h-9 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${tab === id ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground hover:bg-accent hover:text-accent-foreground'}`}>{label}</button>
    );

    return (
        <div className="grid gap-4 lg:grid-cols-2" data-testid="simulator">
            {/* Vista previa: arriba en movil */}
            <section aria-label={t.preview} className={`${card} min-w-0 space-y-3 lg:col-start-1 lg:row-start-1`}>
                <h3 className="text-sm font-semibold text-foreground">{t.preview}</h3>
                <div
                    role="region"
                    aria-label={t.previewRegion}
                    data-testid="sim-preview"
                    className="overflow-x-auto rounded-lg border border-border bg-background p-4 text-foreground"
                    onClickCapture={onClickCapture}
                    onChangeCapture={onChangeCapture}
                    onSubmitCapture={onSubmitCapture}
                >
                    {shownNode ? (
                        <ExtensionErrorBoundary key={mountKey} extensionId="docs-simulator">
                            {/* Sin proveedor de overlays de la app: los dialogos se abren con el renderer propio */}
                            <ExpansionUIContext.Provider value={undefined}>
                                <JsonRenderer key={mountKey} component={shownNode as any} context={context} initialState={initialState} runtime={runtime} />
                            </ExpansionUIContext.Provider>
                        </ExtensionErrorBoundary>
                    ) : <p className="text-sm text-muted-foreground">{t.invalid}</p>}
                </div>
                {evaluation.status === 'invalid' && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-foreground">{t.invalid}</p>}
                <div role="status" aria-live="polite" aria-label={t.toasts} className="space-y-1" data-testid="sim-toasts">
                    {toasts.map((x) => <p key={x.id} className={`rounded-md border px-2 py-1 text-xs text-foreground ${x.variant === 'error' || x.variant === 'danger' ? 'border-destructive/50 bg-destructive/10' : x.variant === 'success' ? 'border-success/40 bg-success/10' : x.variant === 'warning' ? 'border-warning/50 bg-warning/10' : 'border-border bg-muted'}`}><span className="font-medium">{t.toasts}:</span> {x.message}</p>)}
                </div>
            </section>

            {/* Controles: debajo en movil */}
            <section aria-label={t.controls} className={`${card} min-w-0 space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1`}>
                <div className="flex flex-wrap items-end gap-2">
                    <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                        <label htmlFor="sim-preset" className={cap}>{t.preset}</label>
                        <select id="sim-preset" value={presetId} onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) applyPreset(p); }} className={field}>
                            {groups.map(([kind, list]) => (
                                <optgroup key={kind} label={PRESET_KIND_LABEL[kind as keyof typeof PRESET_KIND_LABEL][locale]}>
                                    {list.map((p) => <option key={p.id} value={p.id}>{p.title[locale]}</option>)}
                                </optgroup>
                            ))}
                        </select>
                    </div>
                    <button type="button" className={btn} onClick={() => copy(text)}>{t.copyJson}</button>
                    <button type="button" className={btn} onClick={() => shownNode && copy(manifestSnippet(shownNode, point, initialState))} disabled={!shownNode}>{t.copySnippet}</button>
                    <button type="button" className={btn} onClick={reset}>{t.reset}</button>
                    <span role="status" aria-live="polite" className="min-w-[4rem] text-xs text-muted-foreground">{status}</span>
                </div>

                <div>
                    <div role="tablist" aria-label={t.controls} className="inline-flex overflow-hidden rounded-md border border-input">{tabBtn('form', t.tabForm)}{tabBtn('json', t.tabJson)}</div>
                    {tab === 'form' ? (
                        <div role="tabpanel" id="sim-panel-form" aria-labelledby="sim-tab-form" className="mt-3 space-y-3">
                            <p className="text-xs text-muted-foreground">{t.formHint}</p>
                            {!target ? <p className="text-xs text-muted-foreground">{t.invalid}</p> : (
                                <div className="max-h-[28rem] space-y-3 overflow-auto pr-1">
                                    {fields.length === 0 && <p className="text-xs text-muted-foreground">{t.noProps}</p>}
                                    {fields.map((f) => <FieldControl key={`${resetCount}:${f.name}`} id={`sim-f-${f.name}`} f={f} value={target.props?.[f.name]} onCommit={(v) => edit(f.name, v)} strings={t} />)}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div role="tabpanel" id="sim-panel-json" aria-labelledby="sim-tab-json" className="mt-3 space-y-2">
                            <CodeEditor ref={editorRef} id="sim-json" label={t.jsonLabel} value={text} onChange={setText} errorLines={errorLines} invalid={evaluation.status === 'invalid'} rows={14} describedBy="sim-issues" />
                        </div>
                    )}
                    <div id="sim-issues" className="mt-3 space-y-2" aria-live="polite">
                        <p className={`text-xs ${evaluation.status === 'invalid' ? 'font-medium text-destructive' : 'text-success'}`}>{evaluation.status === 'invalid' ? t.invalid : t.valid} · {fill(t.bytes, { n: evaluation.bytes, max: UI_LIMITS.maxBytes })}</p>
                        {issueRows(t.errors, evaluation.errors, 'text-destructive')}
                        {issueRows(t.warnings, evaluation.warnings, 'text-foreground')}
                        {issueRows(t.deprecations, evaluation.deprecations, 'text-muted-foreground')}
                    </div>
                </div>

                <div className="space-y-1">
                    <label htmlFor="sim-state" className={cap}>{t.stateEditor}</label>
                    <textarea id="sim-state" value={stateText} rows={4} spellCheck={false} aria-invalid={stateError ? true : undefined} aria-describedby="sim-state-hint" onChange={(e) => setStateText(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    <p id="sim-state-hint" className="text-[11px] text-muted-foreground">{t.stateEditorHint}</p>
                    {stateError && <p role="alert" className="text-xs text-destructive">{stateError}</p>}
                    <details open>
                        <summary className="cursor-pointer text-xs font-medium text-foreground">{t.liveState}</summary>
                        <pre data-testid="sim-live-state" className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] text-foreground">{prettyJson(live)}</pre>
                    </details>
                </div>

                <fieldset className="space-y-2 rounded-md border border-border p-3">
                    <legend className="px-1 text-xs font-semibold text-foreground">{t.context}</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="flex flex-col gap-1">
                            <label htmlFor="sim-point" className={cap}>{t.mountPoint}</label>
                            <select id="sim-point" value={point} onChange={(e) => changePoint(e.target.value)} className={field}>
                                {SIM_MOUNT_POINTS.map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label htmlFor="sim-toolbar" className={cap}>{t.toolbarMode}</label>
                            <select id="sim-toolbar" value={toolbar} disabled={!TOOLBAR_POINTS.has(point)} aria-describedby="sim-toolbar-hint" onChange={(e) => changeToolbar(e.target.value as ToolbarMode)} className={`${field} disabled:opacity-50`}>
                                <option value="off">{t.toolbarOff}</option>
                                <option value="compact">{t.toolbarCompact}</option>
                                <option value="menu">{t.toolbarMenu}</option>
                            </select>
                        </div>
                    </div>
                    <p id="sim-toolbar-hint" className="text-[11px] text-muted-foreground">{t.toolbarOnlyBars}</p>
                    <label htmlFor="sim-context" className={cap}>{t.contextJson}</label>
                    <textarea id="sim-context" value={contextText} rows={5} spellCheck={false} aria-invalid={contextError ? true : undefined} onChange={(e) => setContextText(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    {contextError && <p role="alert" className="text-xs text-destructive">{contextError}</p>}
                </fieldset>

                <fieldset className="space-y-2 rounded-md border border-border p-3">
                    <legend className="px-1 text-xs font-semibold text-foreground">{t.backend}</legend>
                    <p className="text-[11px] text-muted-foreground">{t.backendIntro}</p>
                    <div role="radiogroup" aria-label={t.backend} className="inline-flex overflow-hidden rounded-md border border-input">
                        {(['success', 'error'] as const).map((mode) => (
                            <button key={mode} type="button" role="radio" aria-checked={mock.mode === mode} onClick={() => setMock({ ...mock, mode })}
                                className={`h-9 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${mock.mode === mode ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground hover:bg-accent hover:text-accent-foreground'}`}>
                                {mode === 'success' ? t.backendSuccess : t.backendError}
                            </button>
                        ))}
                    </div>
                    {mock.mode === 'success' ? (
                        <div className="space-y-1">
                            <label htmlFor="sim-mock-result" className={cap}>{t.backendResult}</label>
                            <textarea id="sim-mock-result" value={mock.resultText} rows={3} spellCheck={false} aria-invalid={mockParsed.resultError ? true : undefined} onChange={(e) => setMock({ ...mock, resultText: e.target.value })} className="w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                            {mockParsed.resultError && <p role="alert" className="text-xs text-destructive">{mockParsed.resultError}</p>}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            <label htmlFor="sim-mock-error" className={cap}>{t.backendErrorText}</label>
                            <input id="sim-mock-error" type="text" value={mock.errorText} onChange={(e) => setMock({ ...mock, errorText: e.target.value })} className={field} />
                        </div>
                    )}
                    <div className="space-y-1">
                        <label htmlFor="sim-mock-delay" className={cap}>{t.backendDelay}</label>
                        <input id="sim-mock-delay" type="number" min={0} max={10000} step={100} value={mock.delayMs} onChange={(e) => setMock({ ...mock, delayMs: Number(e.target.value) || 0 })} className={`${field} sm:w-40`} />
                    </div>
                </fieldset>
            </section>

            {/* Registro de eventos */}
            <section aria-label={t.eventLog} className={`${card} min-w-0 space-y-2 lg:col-start-1 lg:row-start-2`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{t.eventLog} ({events.length})</h3>
                    <button type="button" className={btn} onClick={() => setEvents([])} disabled={events.length === 0}>{t.clearLog}</button>
                </div>
                <p className="text-xs text-muted-foreground">{t.eventLogIntro}</p>
                <ol ref={logEndRef} role="log" aria-live="polite" aria-relevant="additions" aria-label={t.eventLog} data-testid="sim-log" className="max-h-80 min-h-[3rem] space-y-1 overflow-auto">
                    {events.length === 0 && <li className="text-xs text-muted-foreground">{t.logEmpty}</li>}
                    {events.map((event) => (
                        <li key={event.id} data-kind={event.kind} data-name={event.name} className="rounded-md bg-muted px-2 py-1 text-xs" style={{ marginLeft: `${Math.min(event.depth ?? 0, 6) * 12}px` }}>
                            <div className="flex flex-wrap items-center gap-2">
                                <time className="font-mono text-muted-foreground">{event.time}</time>
                                <span className="rounded-full bg-chip px-1.5 text-[10px] font-medium text-chip-foreground">{event.kind === 'interaction' ? t.kindInteraction : event.kind === 'action' ? t.kindAction : event.kind === 'backend' ? t.kindBackend : t.kindComposer}</span>
                                <code className={`font-mono font-semibold ${event.outcome === 'error' ? 'text-destructive' : 'text-foreground'}`}>{event.name}</code>
                                {event.outcome && <span className={event.outcome === 'error' ? 'text-destructive' : 'text-success'}>{event.outcome === 'error' ? t.outcomeError : t.outcomeOk}</span>}
                            </div>
                            {event.detail !== undefined && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">{typeof event.detail === 'string' ? event.detail : JSON.stringify(event.detail)}</pre>}
                        </li>
                    ))}
                </ol>
            </section>
        </div>
    );
}
