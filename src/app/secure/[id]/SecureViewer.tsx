'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ShieldCheck, Calendar, User, Loader2, Lock, AlertTriangle } from 'lucide-react';
import { SafeIframe } from '@/components/ui/SafeIframe';
import { SealedCryptoError, openMessage, parseKeyFragment, type SealedEnvelope } from '@/lib/sealed/crypto';

interface Meta {
    format: 'sealed' | 'legacy';
    hasPassword: boolean;
    sender: string;
    createdAt: string;
    expiresAt: string | null;
    remainingViews: number | null;
}

type ViewState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'password'; meta: Meta; error?: string }
    | { kind: 'ready'; meta: Meta; subject: string; html: string; remainingViews: number | null };

const MSG_NOT_FOUND = 'This message does not exist, has expired, or has reached its view limit.';
const MSG_NO_KEY = 'This link is incomplete: the decryption key (the part after # in the address) is missing. Open the original link from the email again.';
const MSG_UNAVAILABLE = 'Your browser cannot decrypt this message (WebCrypto is unavailable). Use a current browser over HTTPS.';
const MSG_GENERIC = 'The message could not be opened. Try again later.';

function formatDate(value: string): string {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export function SecureViewer({ id }: { id: string }) {
    const [state, setState] = useState<ViewState>({ kind: 'loading' });
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const keyRef = useRef<string | null>(null);
    const envelopeRef = useRef<{ envelope: SealedEnvelope; remainingViews: number | null } | null>(null);
    const startedRef = useRef(false);
    const passwordId = useId();
    const errorId = useId();

    const openWith = useCallback(async (meta: Meta, pwd?: string) => {
        const key = keyRef.current;
        if (!key) { setState({ kind: 'error', message: MSG_NO_KEY }); return; }
        try {
            // El sobre se pide UNA vez por carga (cuenta una vista); los reintentos de contrasena reutilizan el que ya llego.
            if (!envelopeRef.current) {
                const res = await fetch(`/api/secure-message/${encodeURIComponent(id)}`, { method: 'POST', cache: 'no-store', referrerPolicy: 'no-referrer' });
                if (res.status === 404) { setState({ kind: 'error', message: MSG_NOT_FOUND }); return; }
                if (!res.ok) { setState({ kind: 'error', message: MSG_GENERIC }); return; }
                const body = await res.json();
                if (body?.format !== 'sealed') { setState({ kind: 'error', message: MSG_GENERIC }); return; }
                envelopeRef.current = { envelope: body.envelope, remainingViews: typeof body.remainingViews === 'number' ? body.remainingViews : null };
            }
            const { subject, html } = await openMessage(envelopeRef.current.envelope, key, pwd);
            setState({ kind: 'ready', meta, subject, html, remainingViews: envelopeRef.current.remainingViews });
        } catch (e) {
            const code = e instanceof SealedCryptoError ? e.code : null;
            if (code === 'WEBCRYPTO_UNAVAILABLE') setState({ kind: 'error', message: MSG_UNAVAILABLE });
            else if (code === 'PASSWORD_REQUIRED' || (code === 'DECRYPT_FAILED' && meta.hasPassword)) {
                setState({ kind: 'password', meta, error: code === 'DECRYPT_FAILED' ? 'Wrong password, or the link was altered.' : undefined });
            } else if (code === 'DECRYPT_FAILED' || code === 'INVALID_KEY') {
                setState({ kind: 'error', message: 'The message could not be decrypted: the link is incomplete or was altered.' });
            } else setState({ kind: 'error', message: MSG_GENERIC });
        }
    }, [id]);

    useEffect(() => {
        if (startedRef.current) return; // StrictMode: una sola carga (y una sola vista)
        startedRef.current = true;

        keyRef.current = parseKeyFragment(window.location.hash);
        // La clave sale de la barra de direcciones y del historial en cuanto se lee (no se guarda en ningun almacenamiento).
        if (window.location.hash) {
            try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* noop */ }
        }

        (async () => {
            try {
                const res = await fetch(`/api/secure-message/${encodeURIComponent(id)}`, { cache: 'no-store', referrerPolicy: 'no-referrer' });
                if (res.status === 404) { setState({ kind: 'error', message: MSG_NOT_FOUND }); return; }
                if (!res.ok) { setState({ kind: 'error', message: MSG_GENERIC }); return; }
                const meta = (await res.json()) as Meta;

                if (meta.format === 'legacy') {
                    // Mensajes antiguos (sin cifrado de extremo a extremo): el servidor los entrega y SafeIframe los aisla.
                    const legacy = await fetch(`/api/secure-message/${encodeURIComponent(id)}`, { method: 'POST', cache: 'no-store', referrerPolicy: 'no-referrer' });
                    if (!legacy.ok) { setState({ kind: 'error', message: MSG_NOT_FOUND }); return; }
                    const body = await legacy.json();
                    setState({ kind: 'ready', meta, subject: String(body.subject ?? ''), html: String(body.content ?? ''), remainingViews: null });
                    return;
                }

                if (!keyRef.current) { setState({ kind: 'error', message: MSG_NO_KEY }); return; }
                if (meta.hasPassword) { setState({ kind: 'password', meta }); return; }
                await openWith(meta);
            } catch {
                setState({ kind: 'error', message: MSG_GENERIC });
            }
        })();
    }, [id, openWith]);

    const submitPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (state.kind !== 'password' || !password || busy) return;
        setBusy(true);
        await openWith(state.meta, password);
        setBusy(false);
        setPassword('');
    };

    return (
        <main className="min-h-screen bg-muted/50 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-card rounded-lg shadow-xl overflow-hidden border border-border/60">
                <div className="bg-primary text-primary-foreground p-6 flex items-center gap-3">
                    <ShieldCheck className="w-8 h-8" aria-hidden="true" />
                    <div>
                        <h1 className="text-xl font-bold">Secure Message</h1>
                        <p className="text-sm opacity-90">End-to-end encrypted in the sender&apos;s browser</p>
                    </div>
                </div>

                {state.kind === 'loading' && (
                    <div className="p-8 flex items-center gap-3 text-muted-foreground" role="status" aria-live="polite">
                        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Opening message...
                    </div>
                )}

                {state.kind === 'error' && (
                    <div className="p-8 flex items-start gap-3 text-foreground" role="alert">
                        <AlertTriangle className="w-5 h-5 mt-0.5 text-destructive shrink-0" aria-hidden="true" />
                        <p>{state.message}</p>
                    </div>
                )}

                {state.kind === 'password' && (
                    <form onSubmit={submitPassword} className="p-8 space-y-4" aria-describedby={state.error ? errorId : undefined}>
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Lock className="w-4 h-4" aria-hidden="true" /> This message is also protected with a password. Ask the sender for it.
                        </p>
                        <div className="space-y-1">
                            <label htmlFor={passwordId} className="text-sm font-medium">Password</label>
                            <input
                                id={passwordId}
                                type="password"
                                autoComplete="off"
                                autoFocus
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-invalid={state.error ? true : undefined}
                            />
                        </div>
                        {state.error && <p id={errorId} role="alert" className="text-sm text-destructive">{state.error}</p>}
                        <button
                            type="submit"
                            disabled={busy || !password}
                            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Unlock
                        </button>
                    </form>
                )}

                {state.kind === 'ready' && (
                    <>
                        <div className="bg-muted/50 px-6 py-4 border-b flex flex-wrap gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-2">
                                <User className="w-4 h-4" aria-hidden="true" />
                                <span className="font-semibold">From:</span> {state.meta.sender}
                            </div>
                            <div className="flex items-center gap-2">
                                <Calendar className="w-4 h-4" aria-hidden="true" />
                                <span className="font-semibold">Sent:</span> {formatDate(state.meta.createdAt)}
                            </div>
                        </div>
                        <div className="px-6 py-4 border-b">
                            <h2 className="text-lg font-semibold text-foreground">{state.subject}</h2>
                        </div>
                        <div className="p-8 prose max-w-none">
                            {/* Contenido no confiable (lo escribio un tercero): DOMPurify + iframe sandbox de origen opaco + CSP */}
                            <SafeIframe html={state.html} />
                        </div>
                        <div className="bg-muted/50 px-6 py-4 text-center text-xs text-muted-foreground">
                            {state.remainingViews === null
                                ? 'This message was sent securely. The link may expire.'
                                : state.remainingViews > 0
                                    ? `This link can be opened ${state.remainingViews} more time(s). Reloading this page uses a view.`
                                    : 'This was the last allowed view: the message has been deleted from the server. Reloading will not work.'}
                        </div>
                    </>
                )}
            </div>
        </main>
    );
}
