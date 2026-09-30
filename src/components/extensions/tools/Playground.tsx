'use client';

/**
 * Playground de extensiones: pega un manifest o un nodo de UI, valida en linea y previsualiza en vivo con backend
 * simulado y el tema que elijas (solo dentro del marco de la vista previa).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { RendererRuntime } from '@/components/expansions/renderer/JsonRenderer';
import { analyze, parseJson, type Analysis } from '@/lib/expansions/playground/analyze';
import { createBackendSimulator, createComposerFunctions, createEventLog, parseBackendScript, type BackendScript, type PlaygroundEvent } from '@/lib/expansions/playground/simulate';
import { DEFAULT_CONTEXT_TEXT, DEFAULT_SAMPLE_ID, DEFAULT_SCRIPT_TEXT, PLAYGROUND_SAMPLES, findSample } from '@/lib/expansions/playground/samples';
import { VIEWPORT_WIDTH, loadDraft, saveDraft, takePending, type Viewport } from '@/lib/expansions/playground/storage';
import { EXAMPLE_CONTEXT } from '@/lib/expansions/ui-examples';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import { IssuesPanel } from './IssuesPanel';
import { LivePreview } from './LivePreview';
import { ThemePicker } from './ThemePicker';
import { ThemeChoicesProvider } from './ThemeScope';
import { useToolStrings } from './strings';

const DEBOUNCE_MS = 250;
const VIEWPORTS: Viewport[] = ['mobile', 'tablet', 'desktop'];

const btn = 'inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';
const card = 'rounded-lg border border-border bg-card p-4 text-card-foreground';

function JsonBlock({ value }: { value: unknown }) {
    let text = '';
    try { text = JSON.stringify(value, null, 2) ?? ''; } catch { text = String(value); }
    return <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-xs text-foreground">{text}</pre>;
}

export function PlaygroundInner() {
    const t = useToolStrings();
    const defaultSample = findSample(DEFAULT_SAMPLE_ID)!;

    const [text, setText] = useState(defaultSample.text);
    const [debounced, setDebounced] = useState(defaultSample.text);
    const [sampleId, setSampleId] = useState(DEFAULT_SAMPLE_ID);
    const [contextText, setContextText] = useState(DEFAULT_CONTEXT_TEXT);
    const [scriptText, setScriptText] = useState(DEFAULT_SCRIPT_TEXT);
    const [themeId, setThemeId] = useState('light');
    const [viewport, setViewport] = useState<Viewport>('desktop');
    const [strict, setStrict] = useState(false);
    const [targetKey, setTargetKey] = useState('');
    const [resetCount, setResetCount] = useState(0);
    const [events, setEvents] = useState<PlaygroundEvent[]>([]);
    const [stateSnapshot, setStateSnapshot] = useState<Record<string, any>>({});
    const [good, setGood] = useState<Analysis | null>(null);
    const [hydrated, setHydrated] = useState(false);
    const [notice, setNotice] = useState('');
    const editorRef = useRef<CodeEditorHandle>(null);

    // ---- Borrador: se recupera al montar (o el ejemplo que dejo la galeria) y se guarda al cambiar.
    useEffect(() => {
        const draft = loadDraft();
        const pending = takePending();
        const nextText = pending ?? draft.text;
        if (nextText !== undefined) { setText(nextText); setDebounced(nextText); setSampleId(''); }
        if (draft.context !== undefined) setContextText(draft.context);
        if (draft.script !== undefined) setScriptText(draft.script);
        if (draft.theme) setThemeId(draft.theme);
        if (draft.viewport) setViewport(draft.viewport);
        if (draft.strict !== undefined) setStrict(draft.strict);
        if (pending !== null) setNotice(t.loadedFromGallery);
        setHydrated(true);
        // solo al montar
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        if (!hydrated) return;
        const handle = setTimeout(() => saveDraft({ text, context: contextText, script: scriptText, theme: themeId, viewport, strict }), 400);
        return () => clearTimeout(handle);
    }, [hydrated, text, contextText, scriptText, themeId, viewport, strict]);

    // ---- Vista previa con debounce de 250 ms
    useEffect(() => {
        if (text === debounced) return;
        const handle = setTimeout(() => setDebounced(text), DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [text, debounced]);

    const analysis = useMemo(() => analyze(debounced, { strict }), [debounced, strict]);
    useEffect(() => { if (analysis.targets.length > 0) setGood(analysis); }, [analysis]);
    const shown = analysis.targets.length > 0 ? analysis : good;
    const stale = analysis.targets.length === 0 && good !== null;
    const target = shown?.targets.find((x) => x.key === targetKey) ?? shown?.targets[0] ?? null;

    // ---- Contexto simulado y respuestas del backend
    const contextParse = useMemo(() => parseJson(contextText), [contextText]);
    const lastContext = useRef<Record<string, any>>(EXAMPLE_CONTEXT);
    let baseContext = lastContext.current;
    if (contextParse.ok && contextParse.value && typeof contextParse.value === 'object' && !Array.isArray(contextParse.value)) {
        baseContext = contextParse.value as Record<string, any>;
        lastContext.current = baseContext;
    }
    const scriptParse = useMemo(() => parseBackendScript(scriptText), [scriptText]);
    const scriptRef = useRef<BackendScript>({});
    scriptRef.current = scriptParse.script;

    const log = useRef(createEventLog());
    const sink = useCallback((event: Omit<PlaygroundEvent, 'id' | 'time'>) => {
        const made = log.current.make(event);
        setEvents((list) => log.current.append(list, made));
    }, []);
    const simulator = useMemo(() => createBackendSimulator(() => scriptRef.current, sink), [sink]);
    const composer = useMemo(() => createComposerFunctions(sink), [sink]);

    const context = useMemo(
        () => ({ ...baseContext, extensionId: shown?.extensionId ?? 'playground', overlays: shown?.overlays ?? {}, ...composer }),
        [baseContext, shown, composer],
    );
    const runtime = useMemo<RendererRuntime>(() => ({ callBackend: simulator.callBackend, onStateChange: setStateSnapshot }), [simulator]);

    const reset = useCallback(() => { simulator.reset(); setStateSnapshot({}); setResetCount((n) => n + 1); }, [simulator]);

    const loadSample = (id: string) => {
        const sample = findSample(id);
        setSampleId(id);
        if (!sample) return;
        setText(sample.text);
        setDebounced(sample.text);
        setTargetKey('');
        setNotice('');
    };
    const onEdit = (value: string) => { setText(value); setSampleId(''); };
    const migrate = () => {
        const fresh = analyze(text);
        if (!fresh.migratedText) return;
        setText(fresh.migratedText);
        setDebounced(fresh.migratedText);
        setSampleId('');
        setNotice(t.migrated);
    };
    const format = () => {
        const parsed = parseJson(text);
        if (!parsed.ok) return;
        const pretty = JSON.stringify(parsed.value, null, 2);
        setText(pretty);
        setDebounced(pretty);
    };

    const errorLines = useMemo(() => analysis.issues.filter((i) => i.source === 'json' && i.line !== undefined).map((i) => i.line!), [analysis]);
    const jsonError = analysis.issues.find((i) => i.source === 'json');
    const width = VIEWPORT_WIDTH[viewport];
    const groups = useMemo(() => ({
        manifest: PLAYGROUND_SAMPLES.filter((s) => s.group === 'manifest'),
        legacy: PLAYGROUND_SAMPLES.filter((s) => s.group === 'legacy'),
        component: PLAYGROUND_SAMPLES.filter((s) => s.group === 'component'),
    }), []);

    return (
        <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                    <h1 className="text-2xl font-semibold text-foreground">{t.playgroundTitle}</h1>
                    <p className="max-w-3xl text-sm text-muted-foreground">{t.playgroundIntro}</p>
                </div>
                <Link href="/extensions/components" className="text-sm text-link underline-offset-4 hover:text-link-hover hover:underline">{t.goToGallery}</Link>
            </header>

            <section aria-label={t.toolbar} className={`${card} flex flex-wrap items-end gap-3`}>
                <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
                    <label htmlFor="pg-sample" className="text-xs font-medium text-muted-foreground">{t.examples}</label>
                    <select id="pg-sample" value={sampleId} onChange={(e) => loadSample(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <option value="">{t.chooseExample}</option>
                        <optgroup label={t.groupManifest}>{groups.manifest.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</optgroup>
                        <optgroup label={t.groupLegacy}>{groups.legacy.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</optgroup>
                        <optgroup label={t.groupComponents}>{groups.component.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</optgroup>
                    </select>
                </div>
                <ThemePicker id="pg-theme" value={themeId} onChange={setThemeId} />
                <div role="radiogroup" aria-label={t.viewport} className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">{t.viewport}</span>
                    <div className="inline-flex overflow-hidden rounded-md border border-input">
                        {VIEWPORTS.map((v) => (
                            <button key={v} type="button" role="radio" aria-checked={viewport === v} onClick={() => setViewport(v)} className={`h-9 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${viewport === v ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground hover:bg-accent'}`}>
                                {v === 'mobile' ? t.vpMobile : v === 'tablet' ? t.vpTablet : t.vpDesktop}
                            </button>
                        ))}
                    </div>
                </div>
                <label className="flex h-9 items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" role="switch" checked={strict} onChange={(e) => setStrict(e.target.checked)} className="h-4 w-4 accent-primary" />
                    <span>{t.strict}</span>
                </label>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
                <div className="min-w-0 space-y-4">
                    <section className={card} aria-label={t.editorSection}>
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <h2 className="text-sm font-semibold text-foreground">{t.editor}</h2>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" className={btn} onClick={format} disabled={analysis.status !== 'ok'}>{t.format}</button>
                                <button type="button" className={btn} onClick={migrate} disabled={!analysis.needsMigration} title={t.migrateHint}>{t.migrate}</button>
                            </div>
                        </div>
                        <CodeEditor
                            ref={editorRef}
                            id="pg-editor"
                            label={t.editorLabel}
                            value={text}
                            onChange={onEdit}
                            errorLines={errorLines}
                            invalid={analysis.status === 'invalid-json'}
                            describedBy={jsonError ? 'pg-json-error' : undefined}
                            rows={18}
                        />
                        {jsonError && <p id="pg-json-error" role="alert" className="mt-1 text-xs text-destructive">{t.jsonErrorAt.replace('{line}', String(jsonError.line ?? 1)).replace('{col}', String(jsonError.column ?? 1))}: {jsonError.message}</p>}
                        <p className="mt-1 text-xs text-muted-foreground" data-testid="kind">{analysis.kind === 'manifest' ? t.kindManifest : analysis.kind === 'node' ? t.kindNode : analysis.kind === 'unknown' ? t.kindUnknown : ''}</p>
                    </section>

                    <section className={card} aria-label={t.validation}>
                        <h2 className="mb-2 text-sm font-semibold text-foreground">{t.validation}</h2>
                        <IssuesPanel analysis={analysis} strict={strict} onJump={(line, col) => editorRef.current?.jumpTo(line, col)} />
                    </section>
                </div>

                <section className={`${card} min-w-0 space-y-3`} aria-label={t.preview}>
                    <div className="flex flex-wrap items-end justify-between gap-2">
                        <h2 className="text-sm font-semibold text-foreground">{t.preview}</h2>
                        <div className="flex flex-wrap items-end gap-2">
                            {shown && shown.targets.length > 1 && (
                                <div className="flex flex-col gap-1">
                                    <label htmlFor="pg-target" className="text-xs font-medium text-muted-foreground">{t.mount}</label>
                                    <select id="pg-target" value={target?.key ?? ''} onChange={(e) => setTargetKey(e.target.value)} className="h-9 max-w-[16rem] rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        {shown.targets.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                                    </select>
                                </div>
                            )}
                            <button type="button" className={btn} onClick={reset}>{t.resetPreview}</button>
                        </div>
                    </div>
                    {notice && <p role="status" className="rounded-md bg-muted px-2 py-1 text-xs text-foreground">{notice}</p>}
                    {stale && <p role="status" className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-xs text-foreground">{t.showingLastValid}</p>}
                    {target?.broken && <p role="status" className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-foreground">{t.brokenMount}</p>}
                    {target ? (
                        <LivePreview
                            node={target.node}
                            context={context}
                            initialState={shown?.state}
                            themeId={themeId}
                            width={width}
                            runtime={runtime}
                            resetKey={`${resetCount}:${target.key}`}
                            label={t.previewRegion}
                        />
                    ) : (
                        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t.nothingToPreview}</p>
                    )}
                </section>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <section className={card} aria-label={t.contextTitle}>
                    <CodeEditor id="pg-context" label={t.contextTitle} value={contextText} onChange={setContextText} rows={10} invalid={!contextParse.ok} describedBy={contextParse.ok ? undefined : 'pg-context-error'} />
                    <p className="mt-1 text-xs text-muted-foreground">{t.contextHelp}</p>
                    {!contextParse.ok && <p id="pg-context-error" role="alert" className="text-xs text-destructive">{t.jsonErrorAt.replace('{line}', String(contextParse.line ?? 1)).replace('{col}', String(contextParse.column ?? 1))}: {contextParse.message}</p>}
                </section>
                <section className={card} aria-label={t.scriptTitle}>
                    <CodeEditor id="pg-script" label={t.scriptTitle} value={scriptText} onChange={setScriptText} rows={10} invalid={!scriptParse.ok} describedBy={scriptParse.ok ? undefined : 'pg-script-error'} />
                    <p className="mt-1 text-xs text-muted-foreground">{t.scriptHelp}</p>
                    {!scriptParse.ok && (
                        <ul id="pg-script-error" role="alert" className="mt-1 space-y-0.5 text-xs text-destructive">
                            {scriptParse.errors.map((e, i) => <li key={i}><code className="font-mono">{e.path}</code>: {e.message}{e.line ? ` (${e.line}:${e.column})` : ''}</li>)}
                        </ul>
                    )}
                </section>
                <section className={card} aria-label={t.eventsTitle}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold text-foreground">{t.eventsTitle} ({events.length})</h2>
                        <button type="button" className={btn} onClick={() => setEvents([])} disabled={events.length === 0}>{t.clearEvents}</button>
                    </div>
                    {events.length === 0 ? <p className="text-xs text-muted-foreground">{t.noEvents}</p> : (
                        <ol role="log" aria-live="polite" aria-label={t.eventsTitle} className="max-h-72 space-y-1 overflow-auto">
                            {[...events].reverse().map((event) => (
                                <li key={event.id} className="rounded-md bg-muted px-2 py-1 text-xs">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <time className="font-mono text-muted-foreground">{event.time}</time>
                                        <span className="rounded-full bg-chip px-1.5 text-[10px] font-medium text-chip-foreground">{event.kind === 'backend' ? t.kindBackend : t.kindComposer}</span>
                                        <code className={`font-mono font-semibold ${event.outcome === 'error' ? 'text-destructive' : 'text-foreground'}`}>{event.name}</code>
                                    </div>
                                    {event.payload !== undefined && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">{typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload)}</pre>}
                                </li>
                            ))}
                        </ol>
                    )}
                </section>
                <section className={card} aria-label={t.stateTitle}>
                    <h2 className="mb-2 text-sm font-semibold text-foreground">{t.stateTitle}</h2>
                    <JsonBlock value={stateSnapshot} />
                </section>
            </div>
        </main>
    );
}

export function Playground() {
    return (
        <ThemeChoicesProvider>
            <PlaygroundInner />
        </ThemeChoicesProvider>
    );
}
