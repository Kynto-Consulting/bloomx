'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, ShieldCheck } from 'lucide-react';
import { MfaEnrollForm } from '@/components/MfaPanels';

interface MfaStatus {
    available: boolean;
    enabled: boolean;
    pendingEnrollment: boolean;
    recoveryCodesLeft: number;
    required: boolean;
}

const inputCls =
    'flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const btnCls =
    'inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2 disabled:opacity-50';
const btnDangerCls =
    'inline-flex items-center justify-center rounded-md text-sm font-medium border border-destructive text-destructive hover:bg-destructive/10 h-9 px-4 py-2 disabled:opacity-50';

async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

/** Seguridad de la cuenta: MFA TOTP (estado, activar, codigos de recuperacion, desactivar) y cerrar todas las sesiones. */
export default function SecurityPage() {
    const [status, setStatus] = useState<MfaStatus | null>(null);
    const [enrolling, setEnrolling] = useState(false);
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [msg, setMsg] = useState('');
    const [newCodes, setNewCodes] = useState<string[] | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const res = await fetch('/api/auth/mfa/status', { cache: 'no-store' });
        if (res.status === 401) { window.location.href = '/login'; return; }
        setStatus(await res.json());
    }, []);

    useEffect(() => { void load(); }, [load]);

    const regenerate = async () => {
        setBusy(true); setMsg('');
        const { ok, data } = await post('/api/auth/mfa/recovery-codes', { code });
        setBusy(false);
        if (ok) { setNewCodes(data.recoveryCodes); setCode(''); await load(); } else setMsg('Invalid code');
    };

    const disable = async () => {
        setBusy(true); setMsg('');
        const { ok } = await post('/api/auth/mfa/disable', { password, code });
        setBusy(false);
        if (ok) { setPassword(''); setCode(''); await load(); setMsg('Two-factor authentication disabled.'); }
        else setMsg('Invalid password or code');
    };

    const logoutEverywhere = async () => {
        await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) });
        window.location.href = '/login';
    };

    if (!status) {
        return <div role="status" className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
    }

    return (
        <main className="mx-auto max-w-lg p-6 grid gap-6">
            <div className="flex items-center gap-2">
                <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
                <h1 className="text-2xl font-semibold tracking-tight">Account security</h1>
            </div>
            <Link href="/" className="text-sm underline underline-offset-4 text-muted-foreground">Back to mail</Link>

            <section className="grid gap-3 rounded-lg border border-border p-4" aria-labelledby="mfa-h">
                <h2 id="mfa-h" className="text-lg font-semibold">Two-factor authentication (TOTP)</h2>

                {!status.available && <p className="text-sm text-destructive">Two-factor authentication is not available yet (database migration pending).</p>}

                {status.available && !status.enabled && !enrolling && (
                    <>
                        <p className="text-sm text-muted-foreground">
                            {status.required ? 'Required for your account. ' : 'Adds a second step at sign-in. '}
                            Recommended for every account.
                        </p>
                        <button className={btnCls} onClick={() => setEnrolling(true)}>Set up</button>
                    </>
                )}

                {enrolling && (
                    <MfaEnrollForm onDone={() => { setEnrolling(false); void load(); }} />
                )}

                {status.enabled && (
                    <>
                        <p className="text-sm">
                            Enabled. Recovery codes left: <strong>{status.recoveryCodesLeft}</strong>
                        </p>
                        <label className="text-sm font-medium" htmlFor="sec-code">Current authentication code</label>
                        <input id="sec-code" className={inputCls} inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} />
                        <div className="flex flex-wrap gap-2">
                            <button className={btnCls} disabled={busy || code.length < 6} onClick={regenerate}>New recovery codes</button>
                        </div>
                        {newCodes && (
                            <pre className="rounded-md border border-input bg-muted/50 p-3 text-sm font-mono grid grid-cols-2 gap-x-4">{newCodes.join('\n')}</pre>
                        )}
                        {!status.required && (
                            <>
                                <label className="text-sm font-medium" htmlFor="sec-pass">Password (to disable)</label>
                                <input id="sec-pass" type="password" autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
                                <button className={btnDangerCls} disabled={busy || !password || code.length < 6} onClick={disable}>Disable two-factor</button>
                            </>
                        )}
                    </>
                )}
                {msg && <p role="status" className="text-sm text-muted-foreground">{msg}</p>}
            </section>

            <section className="grid gap-3 rounded-lg border border-border p-4" aria-labelledby="sess-h">
                <h2 id="sess-h" className="text-lg font-semibold">Sessions</h2>
                <p className="text-sm text-muted-foreground">Sign out on every device (revokes all active sessions).</p>
                <button className={btnDangerCls} onClick={logoutEverywhere}>Sign out everywhere</button>
            </section>
        </main>
    );
}
