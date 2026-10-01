'use client';

import * as React from 'react';
import { Copy, Eraser, HelpCircle, KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { notifySessionEnded, useConsole } from '@/components/admin/console';
import { quoteArg, tokenize } from '@/lib/admin-cli/parser';
import { renderText } from '@/lib/admin-cli/render';
import type { CmdOutput, ExecResponse, Tone } from '@/lib/admin-cli/types';
import { OutputView, toneClass } from './TerminalOutput';

/**
 * Terminal de administracion en el navegador (ligera, sin dependencias: un <input> + una region role="log").
 * Habla con POST /api/admin/cli/exec y GET /api/admin/cli/complete usando la cookie de la consola y la cabecera
 * X-Requested-With (defensa CSRF). Todo el trabajo (permisos, riesgo, auditoria) lo hace el servidor; aqui solo UI:
 * historial (flechas), Tab, Ctrl+C / Ctrl+L, confirmacion interactiva, step-up con contrasena/MFA sin eco y modo pegado (--stdin).
 */

type Kind = 'cmd' | 'out' | 'err' | 'info' | 'warn';
interface Block { id: number; kind: Kind; prompt?: string; line?: string; output?: CmdOutput; text?: string; tone?: Tone }

type Pending = { argv: string[]; input?: string; json: boolean; confirm?: boolean };
type Mode =
    | { type: 'normal' }
    | { type: 'confirm'; req: Pending; command: string; risk: string }
    | { type: 'password'; req: Pending }
    | { type: 'paste'; argv: string[] };

const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'bloomx-console' } as const;
const MAX_BLOCKS = 400;
const SECRET_FLAG = /^(--(?:password|value|public-key|secret|token|code|recovery-code))(=|$)/i;

/** Enmascara en pantalla el valor de las banderas secretas (el servidor ya las redacta en la auditoria). */
export function maskForDisplay(line: string): string {
    try {
        const parts = tokenize(line);
        const out: string[] = [];
        for (let i = 0; i < parts.length; i++) {
            const m = SECRET_FLAG.exec(parts[i]);
            if (m && m[2] === '=') out.push(`${m[1]}=***`);
            else if (m) { out.push(parts[i], '***'); i++; } else out.push(parts[i]);
        }
        return out.map(quoteArg).join(' ');
    } catch { return line.replace(/(--(?:password|value|public-key|secret|token)[= ])\S+/gi, '$1***'); }
}

/** Indice donde empieza el token en curso (respeta comillas). */
export function tokenStart(line: string): number {
    let start = 0;
    let quote: string | null = null;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) { if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '\\') { i++; continue; }
        if (c === ' ' || c === '\t') start = i + 1;
    }
    return start;
}

function commonPrefix(list: string[]): string {
    if (list.length === 0) return '';
    let p = list[0];
    for (const s of list) { while (!s.toLowerCase().startsWith(p.toLowerCase())) p = p.slice(0, -1); }
    return p;
}

export function AdminTerminal() {
    const { t, locale } = useI18n();
    const { domain, me } = useConsole();
    const host = domain?.name || 'instance';
    const prompt = `${(me?.email || 'admin').split('@')[0]}@${host} $`;

    const [blocks, setBlocks] = React.useState<Block[]>([]);
    const [value, setValue] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [mode, setMode] = React.useState<Mode>({ type: 'normal' });
    const [copied, setCopied] = React.useState(false);

    const idRef = React.useRef(1);
    const histRef = React.useRef<string[]>([]);
    const histPos = React.useRef(-1);
    const draftRef = React.useRef('');
    const stepUpRef = React.useRef<{ proof: string; until: number } | null>(null);
    const abortRef = React.useRef<AbortController | null>(null);
    const completeAbort = React.useRef<AbortController | null>(null);
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const areaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const logRef = React.useRef<HTMLDivElement | null>(null);
    const closedRef = React.useRef(false);
    const [closed, setClosed] = React.useState(false);

    const push = React.useCallback((b: Omit<Block, 'id'>) => {
        setBlocks((prev) => [...prev, { ...b, id: idRef.current++ }].slice(-MAX_BLOCKS));
    }, []);
    const info = React.useCallback((text: string, tone?: Tone, kind: Kind = 'info') => push({ kind, text, tone }), [push]);

    React.useEffect(() => {
        push({ kind: 'info', text: t('admin.console.cli.welcome', { domain: host }), tone: 'accent' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    React.useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [blocks, busy, mode]);
    React.useEffect(() => { (mode.type === 'paste' ? areaRef.current : inputRef.current)?.focus(); }, [mode, busy]);

    // ---- red -----------------------------------------------------------------------------------------------------
    const post = React.useCallback(async (path: string, body: unknown, signal?: AbortSignal) => {
        const res = await fetch(path, { method: 'POST', headers: H, body: JSON.stringify(body), signal, cache: 'no-store' });
        let data: any = null;
        try { data = await res.json(); } catch { /* sin cuerpo */ }
        if (res.status === 401 || res.status === 403) notifySessionEnded(data); // sesion reemplazada / caducada / bloqueada: aviso claro + redireccion
        return { status: res.status, data };
    }, []);

    const showResult = React.useCallback((res: ExecResponse, wantJson: boolean) => {
        if (wantJson && res.json !== undefined) push({ kind: 'out', output: { type: 'json', data: res.json } });
        else if (res.output) push({ kind: 'out', output: res.output });
    }, [push]);

    const execute = React.useCallback(async (req: Pending, signal: AbortSignal): Promise<'done' | 'needs'> => {
        const su = stepUpRef.current && stepUpRef.current.until > Date.now() ? stepUpRef.current.proof : undefined;
        const { status, data } = await post('/api/admin/cli/exec', { argv: req.argv, input: req.input, confirm: req.confirm, stepUp: su, locale }, signal);
        if (status === 401) { info(t('admin.console.cli.unauthorized'), 'danger', 'err'); return 'done'; }
        if (status === 403 && !data?.exitCode && data?.code !== undefined) { info(t('admin.console.cli.forbidden'), 'danger', 'err'); return 'done'; }
        if (status === 429) { info(t('admin.console.cli.rateLimited'), 'warning', 'warn'); return 'done'; }
        const res = data as ExecResponse | null;
        if (!res) { info(t('admin.console.cli.networkError'), 'danger', 'err'); return 'done'; }

        if (res.needs === 'confirm') {
            setMode({ type: 'confirm', req, command: res.command ?? req.argv.slice(0, 2).join(' '), risk: res.risk ?? 'security' });
            return 'needs';
        }
        if (res.needs === 'stepup') {
            stepUpRef.current = null;
            setMode({ type: 'password', req: { ...req, confirm: true } });
            return 'needs';
        }
        if (res.ok) {
            showResult(res, req.json);
            // jobs watch: sigue el trabajo hasta que termine (o Ctrl+C)
            const w = res.output?.type === 'json' ? (res.output.data as { watch?: boolean; terminal?: boolean; job?: { status?: string; progress?: number } }) : null;
            if (w?.watch && !w.terminal) {
                info(t('admin.console.cli.watching'), 'muted');
                while (!signal.aborted) {
                    await new Promise((r) => setTimeout(r, 2000));
                    if (signal.aborted) break;
                    const again = await post('/api/admin/cli/exec', { argv: req.argv, stepUp: su, locale }, signal);
                    const o = (again.data as ExecResponse | null)?.output;
                    const d = o?.type === 'json' ? (o.data as { terminal?: boolean; job?: { status?: string; progress?: number } }) : null;
                    if (!d) break;
                    info(`${d.job?.status ?? '?'}${d.job?.progress !== undefined ? ` ${d.job.progress}%` : ''}`, 'muted');
                    if (d.terminal) { push({ kind: 'out', output: o! }); break; }
                }
            }
            return 'done';
        }
        const msg = res.error?.message ?? t('admin.console.cli.failed', { code: res.error?.code ?? 'error' });
        push({ kind: 'err', text: `${msg}  [exit ${res.exitCode}]`, tone: 'danger' });
        return 'done';
    }, [info, locale, post, push, showResult, t]);

    const runPending = React.useCallback(async (req: Pending) => {
        const ac = new AbortController();
        abortRef.current = ac;
        setBusy(true);
        try { await execute(req, ac.signal); } catch (e) {
            if ((e as Error)?.name === 'AbortError') info(t('admin.console.cli.cancelled'), 'muted');
            else info(t('admin.console.cli.networkError'), 'danger', 'err');
        } finally { setBusy(false); abortRef.current = null; }
    }, [execute, info, t]);

    // ---- entrada ---------------------------------------------------------------------------------------------------
    const submitLine = React.useCallback(async (raw: string) => {
        const line = raw.trim();
        if (!line) return;
        push({ kind: 'cmd', prompt, line: maskForDisplay(line) });
        histRef.current = [...histRef.current.filter((h) => h !== line), line].slice(-200);
        histPos.current = -1;
        let argv: string[];
        try { argv = tokenize(line); } catch (e) { info((e as Error).message, 'danger', 'err'); return; }
        if (argv.length === 0) return;
        if (argv[0] === 'clear' && argv.length === 1) { setBlocks([]); return; }
        if (argv[0] === 'exit' && argv.length === 1) { closedRef.current = true; setClosed(true); info(t('admin.console.cli.exited'), 'muted'); return; }
        if (argv.includes('--file')) { info(t('admin.console.cli.fileNotInWeb'), 'warning', 'warn'); return; }
        const json = argv.includes('--json');
        if (argv.includes('--stdin')) {
            info(t('admin.console.cli.pasteHint'), 'muted');
            setMode({ type: 'paste', argv: argv.filter((a) => a !== '--stdin') });
            return;
        }
        if (argv[0] === 'transfer' && argv[1] === 'import') { info(t('admin.console.cli.importNote'), 'warning', 'warn'); return; }
        await runPending({ argv, json });
    }, [info, prompt, push, runPending, t]);

    const finishPaste = React.useCallback(async (text: string, argv: string[]) => {
        setValue('');
        setMode({ type: 'normal' });
        const body = text.replace(/(^|\r?\n)EOF\s*$/, '').replace(/\r\n/g, '\n');
        push({ kind: 'info', text: `<${body.length} chars>`, tone: 'muted' });
        await runPending({ argv, input: body, json: argv.includes('--json') });
    }, [push, runPending]);

    const answerConfirm = React.useCallback(async (answer: string, m: Extract<Mode, { type: 'confirm' }>) => {
        setMode({ type: 'normal' });
        const yes = answer.trim().toLowerCase();
        push({ kind: 'cmd', prompt: '?', line: yes || 'n' });
        if (yes === t('admin.console.cli.confirmYes') || yes === 'y' || yes === 'yes' || yes === 'si' || yes === 'sí') await runPending({ ...m.req, confirm: true });
        else info(t('admin.console.cli.confirmAborted'), 'muted');
    }, [info, push, runPending, t]);

    const answerPassword = React.useCallback(async (secret: string, m: Extract<Mode, { type: 'password' }>) => {
        setMode({ type: 'normal' });
        const s = secret.trim();
        if (!s) { info(t('admin.console.cli.confirmAborted'), 'muted'); return; }
        const body = /^\d{6}$/.test(s) ? { code: s } : /^[A-Za-z0-9]{4,}-[A-Za-z0-9-]{4,}$/.test(s) && s.length >= 10 ? { recoveryCode: s } : { password: s };
        setBusy(true);
        try {
            const { status, data } = await post('/api/admin/cli/reauth', body);
            if (status === 200 && data?.stepUp) {
                stepUpRef.current = { proof: data.stepUp, until: Math.min(Number(data.expiresAt) || Date.now() + 9 * 60_000, Date.now() + 9 * 60_000) };
                info(t('admin.console.cli.stepUpOk'), 'success');
                setBusy(false);
                await runPending(m.req);
                return;
            }
            info(status === 429 ? t('admin.console.cli.rateLimited') : t('admin.console.cli.stepUpFailed'), 'danger', 'err');
        } catch { info(t('admin.console.cli.networkError'), 'danger', 'err'); }
        setBusy(false);
    }, [info, post, runPending, t]);

    const complete = React.useCallback(async () => {
        const el = inputRef.current;
        if (!el || mode.type !== 'normal') return;
        const upto = value.slice(0, el.selectionStart ?? value.length);
        completeAbort.current?.abort();
        const ac = new AbortController();
        completeAbort.current = ac;
        try {
            const res = await fetch(`/api/admin/cli/complete?${new URLSearchParams({ line: upto, locale })}`, { headers: { 'X-Requested-With': 'bloomx-console' }, signal: ac.signal, cache: 'no-store' });
            if (!res.ok) return;
            const data = (await res.json()) as { prefix: string; candidates: { value: string; hint?: string }[] };
            const c = data.candidates;
            if (c.length === 0) return;
            const start = tokenStart(upto);
            const apply = (word: string, space: boolean) => { setValue(`${upto.slice(0, start)}${/[\s"'\\]/.test(word) ? quoteArg(word) : word}${space ? ' ' : ''}${value.slice(upto.length)}`); };
            if (c.length === 1) { apply(c[0].value, true); return; }
            const common = commonPrefix(c.map((x) => x.value));
            if (common.length > data.prefix.length) apply(common, false);
            else push({ kind: 'info', text: `${t('admin.console.cli.completions')} ${c.map((x) => x.value).join('  ')}`, tone: 'muted' });
        } catch { /* cancelado o sin red */ }
    }, [locale, mode.type, push, t, value]);

    const cancel = React.useCallback(() => {
        if (busy) { abortRef.current?.abort(); return; }
        push({ kind: 'cmd', prompt, line: `${maskForDisplay(value)}^C` });
        setValue('');
        setMode({ type: 'normal' });
        histPos.current = -1;
    }, [busy, prompt, push, value]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
        if (ctrl && e.key.toLowerCase() === 'c') {
            const sel = (e.target as HTMLInputElement).selectionStart !== (e.target as HTMLInputElement).selectionEnd;
            if (sel) return; // copiar texto seleccionado
            e.preventDefault();
            cancel();
            return;
        }
        if (ctrl && e.key.toLowerCase() === 'l') { e.preventDefault(); setBlocks([]); return; }
        if (ctrl && e.key.toLowerCase() === 'u') { e.preventDefault(); setValue(''); return; }
        if (mode.type === 'paste') {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void finishPaste(value, mode.argv); }
            return;
        }
        if (busy || closed) { if (e.key === 'Enter') e.preventDefault(); return; }
        if (e.key === 'Enter') {
            e.preventDefault();
            const v = value;
            setValue('');
            if (mode.type === 'confirm') void answerConfirm(v, mode);
            else if (mode.type === 'password') void answerPassword(v, mode);
            else void submitLine(v);
            return;
        }
        if (mode.type !== 'normal') return;
        if (e.key === 'Tab') { e.preventDefault(); void complete(); return; }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const h = histRef.current;
            if (h.length === 0) return;
            if (histPos.current === -1) draftRef.current = value;
            histPos.current = Math.min(h.length - 1, histPos.current + 1);
            setValue(h[h.length - 1 - histPos.current]);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (histPos.current === -1) return;
            histPos.current -= 1;
            setValue(histPos.current === -1 ? draftRef.current : histRef.current[histRef.current.length - 1 - histPos.current]);
        }
    };

    const copyAll = async () => {
        const text = blocks.map((b) => (b.kind === 'cmd' ? `${b.prompt} ${b.line}` : b.output ? renderText(b.output) : b.text ?? '')).join('\n');
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* sin portapapeles */ }
    };
    const copyBlock = async (b: Block) => {
        try { await navigator.clipboard.writeText(b.output ? renderText(b.output) : b.text ?? ''); } catch { /* sin portapapeles */ }
    };

    const quick = (line: string, run: boolean) => {
        if (busy || closed) return;
        if (run) void submitLine(line); else { setValue(line); inputRef.current?.focus(); }
    };

    const inputType = mode.type === 'password' ? 'password' : 'text';
    const promptLabel = mode.type === 'confirm' ? t('admin.console.cli.confirmPrompt', { command: mode.command, risk: t(`admin.console.cli.risk.${mode.risk === 'destructive' ? 'destructive' : mode.risk === 'write' ? 'write' : mode.risk === 'read' ? 'read' : 'security'}`) })
        : mode.type === 'password' ? t('admin.console.cli.stepUpPrompt') : null;

    const btn = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

    return (
        <section aria-label={t('admin.console.cli.terminalLabel')} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={btn} onClick={() => quick('help', true)} disabled={busy || closed}><HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />{t('admin.console.cli.toolbar.help')}</button>
                <button type="button" className={btn} onClick={() => setBlocks([])}><Eraser className="h-3.5 w-3.5" aria-hidden="true" />{t('admin.console.cli.toolbar.clear')}</button>
                <button type="button" className={btn} onClick={() => void copyAll()}><Copy className="h-3.5 w-3.5" aria-hidden="true" />{copied ? t('admin.console.cli.toolbar.copied') : t('admin.console.cli.toolbar.copy')}</button>
                <button type="button" className={btn} onClick={() => quick('tokens create --name ', false)} disabled={busy || closed} title={t('admin.console.cli.toolbar.tokenHint')}><KeyRound className="h-3.5 w-3.5" aria-hidden="true" />{t('admin.console.cli.toolbar.token')}</button>
                <span className="ml-auto hidden text-xs text-muted-foreground md:inline">{t('admin.console.cli.keys')}</span>
            </div>

            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <div
                className="flex h-[calc(100dvh-20rem)] min-h-[22rem] flex-col rounded-xl border border-border bg-code font-mono text-xs leading-relaxed text-code-foreground shadow-sm sm:text-sm"
                onClick={() => { if (!window.getSelection()?.toString()) (mode.type === 'paste' ? areaRef.current : inputRef.current)?.focus(); }}
            >
                <div ref={logRef} role="log" aria-live="polite" aria-relevant="additions" aria-label={t('admin.console.cli.logLabel')} tabIndex={0} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {blocks.map((b) => (
                        <div key={b.id} className="group relative">
                            {b.kind === 'cmd' ? (
                                <p className="break-all"><span className="text-primary">{b.prompt}</span> <span>{b.line}</span></p>
                            ) : b.output ? (
                                <>
                                    <OutputView out={b.output} />
                                    <button type="button" onClick={() => void copyBlock(b)} aria-label={t('admin.console.cli.toolbar.copy')} className="absolute right-0 top-0 hidden rounded border border-border bg-background p-1 text-muted-foreground hover:text-foreground focus-visible:block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:block">
                                        <Copy className="h-3 w-3" aria-hidden="true" />
                                    </button>
                                </>
                            ) : (
                                <p className={cn('whitespace-pre-wrap break-words', toneClass(b.kind === 'err' ? 'danger' : b.kind === 'warn' ? 'warning' : b.tone))}>{b.text}</p>
                            )}
                        </div>
                    ))}
                    {busy && <p className="text-muted-foreground" role="status">{t('admin.console.cli.running')}</p>}
                </div>

                <div className="border-t border-border/60 p-2">
                    {promptLabel && <p className="px-1 pb-1 text-warning">{promptLabel}</p>}
                    {mode.type === 'paste' ? (
                        <div className="flex flex-col gap-2">
                            <textarea
                                ref={areaRef} rows={8} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown}
                                aria-label={t('admin.console.cli.pasteHint')} spellCheck={false} autoComplete="off"
                                className="w-full resize-y rounded-md border border-input bg-background p-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                            <div className="flex gap-2">
                                <button type="button" className={btn} onClick={() => void finishPaste(value, mode.argv)}>Ctrl+Enter / EOF</button>
                                <button type="button" className={btn} onClick={cancel}>Ctrl+C</button>
                            </div>
                        </div>
                    ) : (
                        <label className="flex items-center gap-2">
                            <span className="shrink-0 text-primary" aria-hidden="true">{mode.type === 'normal' ? prompt : '>'}</span>
                            <span className="sr-only">{t('admin.console.cli.inputLabel')}</span>
                            <input
                                ref={inputRef} type={inputType} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown}
                                disabled={closed} placeholder={mode.type === 'normal' ? t('admin.console.cli.placeholder') : ''}
                                autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="send"
                                className="min-w-0 flex-1 bg-transparent text-code-foreground caret-primary placeholder:text-muted-foreground focus-visible:outline-none disabled:opacity-60"
                            />
                        </label>
                    )}
                </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('admin.console.cli.historyNote')}</p>
        </section>
    );
}

export default AdminTerminal;
