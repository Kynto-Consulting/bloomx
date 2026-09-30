'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { Loader2, ShieldCheck } from 'lucide-react';
import { MfaEnrollForm } from '@/components/MfaPanels';
import { useI18n } from '@/components/I18nProvider';

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

const MIN_PASSWORD = 12;

async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

/**
 * Seguridad de la cuenta: cambiar contrasena, MFA TOTP (estado, activar, codigos de recuperacion, desactivar) y cerrar
 * todas las sesiones. Con `?force=1` un administrador pidio cambiar la contrasena: se avisa y, al cambiarla, se vuelve a `/`.
 */
export default function SecurityPage() {
    const { t } = useI18n();
    const s = (k: string) => t(`admin.console.profile.securityPage.${k}`);
    const uid = useId();
    const [status, setStatus] = useState<MfaStatus | null>(null);
    const [enrolling, setEnrolling] = useState(false);
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [msg, setMsg] = useState('');
    const [newCodes, setNewCodes] = useState<string[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [force, setForce] = useState(false);

    // Cambio de contrasena
    const [curPass, setCurPass] = useState('');
    const [newPass, setNewPass] = useState('');
    const [confPass, setConfPass] = useState('');
    const [passError, setPassError] = useState('');
    const [passOk, setPassOk] = useState('');
    const [passBusy, setPassBusy] = useState(false);

    useEffect(() => {
        try { setForce(new URLSearchParams(window.location.search).get('force') === '1'); } catch { /* sin window */ }
    }, []);

    const load = useCallback(async () => {
        const res = await fetch('/api/auth/mfa/status', { cache: 'no-store' });
        if (res.status === 401) { window.location.href = '/login'; return; }
        setStatus(await res.json());
    }, []);

    useEffect(() => { void load(); }, [load]);

    const changePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setPassError(''); setPassOk('');
        if (newPass.length < MIN_PASSWORD) return setPassError(s('password.tooShort'));
        if (newPass !== confPass) return setPassError(s('password.mismatch'));
        setPassBusy(true);
        try {
            const res = await fetch('/api/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword: curPass, newPassword: newPass }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setCurPass(''); setNewPass(''); setConfPass('');
                setPassOk(s('password.success'));
                if (force) window.location.assign('/');
            } else if (typeof data?.error === 'string' && /incorrect current password/i.test(data.error)) {
                setPassError(s('password.incorrectCurrent'));
            } else if (typeof data?.error === 'string' && /at least 12/i.test(data.error)) {
                setPassError(s('password.tooShort'));
            } else {
                setPassError(`${s('password.failed')}${typeof data?.error === 'string' && res.status === 400 ? ` ${data.error}` : ''}`);
            }
        } catch {
            setPassError(s('password.failed'));
        } finally {
            setPassBusy(false);
        }
    };

    const regenerate = async () => {
        setBusy(true); setMsg('');
        const { ok, data } = await post('/api/auth/mfa/recovery-codes', { code });
        setBusy(false);
        if (ok) { setNewCodes(data.recoveryCodes); setCode(''); await load(); } else setMsg(s('mfa.invalidCode'));
    };

    const disable = async () => {
        setBusy(true); setMsg('');
        const { ok } = await post('/api/auth/mfa/disable', { password, code });
        setBusy(false);
        if (ok) { setPassword(''); setCode(''); await load(); setMsg(s('mfa.disabledOk')); }
        else setMsg(s('mfa.invalidCredentials'));
    };

    const logoutEverywhere = async () => {
        await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) });
        window.location.href = '/login';
    };

    if (!status) {
        return <div role="status" aria-label={s('loading')} className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" /></div>;
    }

    return (
        <main className="mx-auto max-w-lg p-6 grid gap-6">
            <div className="flex items-center gap-2">
                <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
                <h1 className="text-2xl font-semibold tracking-tight">{s('title')}</h1>
            </div>
            <Link href="/" className="text-sm underline underline-offset-4 text-muted-foreground">{s('back')}</Link>

            {force && (
                <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">{s('force')}</p>
            )}

            <section className="grid gap-3 rounded-lg border border-border p-4" aria-labelledby="pass-h">
                <h2 id="pass-h" className="text-lg font-semibold">{s('password.title')}</h2>
                <p className="text-sm text-muted-foreground">{s('password.help')}</p>
                <form onSubmit={changePassword} className="grid gap-3" noValidate>
                    <label className="text-sm font-medium" htmlFor={`${uid}-cur`}>{s('password.current')}</label>
                    <input id={`${uid}-cur`} type="password" autoComplete="current-password" className={inputCls} value={curPass} onChange={(e) => setCurPass(e.target.value)} required />
                    <label className="text-sm font-medium" htmlFor={`${uid}-new`}>{s('password.new')}</label>
                    <input id={`${uid}-new`} type="password" autoComplete="new-password" minLength={MIN_PASSWORD} className={inputCls} value={newPass} onChange={(e) => setNewPass(e.target.value)} required />
                    <label className="text-sm font-medium" htmlFor={`${uid}-conf`}>{s('password.confirm')}</label>
                    <input id={`${uid}-conf`} type="password" autoComplete="new-password" className={inputCls} value={confPass} onChange={(e) => setConfPass(e.target.value)} required />
                    {passError && <p role="alert" className="text-sm text-destructive">{passError}</p>}
                    {passOk && <p role="status" className="text-sm text-success">{passOk}</p>}
                    <div>
                        <button type="submit" className={btnCls} disabled={passBusy || !curPass || !newPass}>
                            {passBusy ? s('password.submitting') : s('password.submit')}
                        </button>
                    </div>
                </form>
            </section>

            <section className="grid gap-3 rounded-lg border border-border p-4" aria-labelledby="mfa-h">
                <h2 id="mfa-h" className="text-lg font-semibold">{s('mfa.title')}</h2>

                {!status.available && <p className="text-sm text-destructive">{s('mfa.unavailable')}</p>}

                {status.available && !status.enabled && !enrolling && (
                    <>
                        <p className="text-sm text-muted-foreground">
                            {status.required ? s('mfa.required') : s('mfa.optional')}
                            {s('mfa.recommended')}
                        </p>
                        <button className={btnCls} onClick={() => setEnrolling(true)}>{s('mfa.setup')}</button>
                    </>
                )}

                {enrolling && (
                    <MfaEnrollForm onDone={() => { setEnrolling(false); void load(); }} />
                )}

                {status.enabled && (
                    <>
                        <p className="text-sm">
                            {s('mfa.enabledLeft')} <strong>{status.recoveryCodesLeft}</strong>
                        </p>
                        <label className="text-sm font-medium" htmlFor="sec-code">{s('mfa.codeLabel')}</label>
                        <input id="sec-code" className={inputCls} inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} />
                        <div className="flex flex-wrap gap-2">
                            <button className={btnCls} disabled={busy || code.length < 6} onClick={regenerate}>{s('mfa.newCodes')}</button>
                        </div>
                        {newCodes && (
                            <pre className="rounded-md border border-input bg-muted/50 p-3 text-sm font-mono grid grid-cols-2 gap-x-4">{newCodes.join('\n')}</pre>
                        )}
                        {!status.required && (
                            <>
                                <label className="text-sm font-medium" htmlFor="sec-pass">{s('mfa.passwordToDisable')}</label>
                                <input id="sec-pass" type="password" autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
                                <button className={btnDangerCls} disabled={busy || !password || code.length < 6} onClick={disable}>{s('mfa.disable')}</button>
                            </>
                        )}
                    </>
                )}
                {msg && <p role="status" className="text-sm text-muted-foreground">{msg}</p>}
            </section>

            <section className="grid gap-3 rounded-lg border border-border p-4" aria-labelledby="sess-h">
                <h2 id="sess-h" className="text-lg font-semibold">{s('sessions.title')}</h2>
                <p className="text-sm text-muted-foreground">{s('sessions.help')}</p>
                <button className={btnDangerCls} onClick={logoutEverywhere}>{s('sessions.signOutAll')}</button>
            </section>
        </main>
    );
}
