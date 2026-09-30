'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

// Paneles de MFA TOTP reutilizables: verificacion en el login, enrolamiento (login obligatorio para admin y pagina de seguridad).
// No usa dependencias de QR: se muestra la clave para escribirla y un enlace otpauth:// (abre la app en el movil).

const inputCls =
    'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const btnCls =
    'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2';
const linkBtnCls = 'text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground';

export interface MfaLoginResult {
    token?: string;
    user?: { id: string; email: string; name?: string | null; avatar?: string };
    recoveryCodes?: string[];
}

async function postJson(url: string, body: unknown) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}

/** Segundo paso del login: codigo de la app autenticadora o codigo de recuperacion. */
export function MfaVerifyForm({
    mfaToken,
    onSuccess,
    onCancel,
}: {
    mfaToken: string;
    onSuccess: (result: MfaLoginResult) => void;
    onCancel?: () => void;
}) {
    const [code, setCode] = useState('');
    const [useRecovery, setUseRecovery] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        const payload = useRecovery ? { mfaToken, recoveryCode: code } : { mfaToken, code };
        const { ok, status, data } = await postJson('/api/auth/mfa/verify', payload).catch(() => ({ ok: false, status: 0, data: {} as any }));
        if (ok) {
            onSuccess(data);
            return;
        }
        setLoading(false);
        setError(status === 429 ? 'Too many attempts. Try again later.' : status === 401 && data?.error?.includes('expired') ? 'The sign-in step expired. Start again.' : 'Invalid code');
    };

    return (
        <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
                <label className="text-sm font-medium leading-none" htmlFor="mfa-code">
                    {useRecovery ? 'Recovery code' : 'Authentication code'}
                </label>
                <input
                    id="mfa-code"
                    className={inputCls}
                    inputMode={useRecovery ? 'text' : 'numeric'}
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    maxLength={useRecovery ? 16 : 8}
                    placeholder={useRecovery ? 'XXXXX-XXXXX' : '123456'}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                    {useRecovery
                        ? 'Enter one of your single-use recovery codes.'
                        : 'Enter the 6-digit code from your authenticator app.'}
                </p>
            </div>
            {error && (
                <div role="alert" className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">
                    {error}
                </div>
            )}
            <button type="submit" disabled={loading} className={btnCls}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Verify'}
            </button>
            <div className="flex items-center justify-between">
                <button type="button" className={linkBtnCls} onClick={() => { setUseRecovery(!useRecovery); setCode(''); setError(''); }}>
                    {useRecovery ? 'Use authenticator app' : 'Use a recovery code'}
                </button>
                {onCancel && (
                    <button type="button" className={linkBtnCls} onClick={onCancel}>
                        Back
                    </button>
                )}
            </div>
        </form>
    );
}

function groupSecret(secret: string) {
    return secret.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Enrolamiento TOTP. Con `mfaToken` (login con MFA obligatorio) completa el inicio de sesion al confirmar;
 * sin el, actua sobre la sesion actual.
 */
export function MfaEnrollForm({
    mfaToken,
    onDone,
}: {
    mfaToken?: string;
    onDone: (result: MfaLoginResult) => void;
}) {
    const [secret, setSecret] = useState('');
    const [uri, setUri] = useState('');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [result, setResult] = useState<MfaLoginResult | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        let alive = true;
        postJson('/api/auth/mfa/setup', mfaToken ? { mfaToken } : {}).then(({ ok, status, data }) => {
            if (!alive) return;
            if (ok) {
                setSecret(data.secret);
                setUri(data.otpauthUri);
            } else {
                setError(status === 409 ? 'MFA is already enabled.' : 'Could not start MFA setup. Try again.');
            }
            setLoading(false);
        }).catch(() => { if (alive) { setError('Could not start MFA setup. Try again.'); setLoading(false); } });
        return () => { alive = false; };
    }, [mfaToken]);

    const confirm = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        const { ok, status, data } = await postJson('/api/auth/mfa/confirm', { code, ...(mfaToken ? { mfaToken } : {}) })
            .catch(() => ({ ok: false, status: 0, data: {} as any }));
        setLoading(false);
        if (ok) setResult(data);
        else setError(status === 429 ? 'Too many attempts. Try again later.' : 'Invalid code');
    };

    if (result?.recoveryCodes) {
        return (
            <div className="grid gap-4">
                <div>
                    <h2 className="text-lg font-semibold">Save your recovery codes</h2>
                    <p className="text-sm text-muted-foreground">
                        Each code works once if you lose access to your authenticator app. They are shown only now.
                    </p>
                </div>
                <pre className="rounded-md border border-input bg-muted/50 p-3 text-sm font-mono grid grid-cols-2 gap-x-4 gap-y-1">
                    {result.recoveryCodes.join('\n')}
                </pre>
                <div className="flex gap-2">
                    <button type="button" className={btnCls} onClick={() => navigator.clipboard?.writeText(result.recoveryCodes!.join('\n')).catch(() => undefined)}>
                        Copy
                    </button>
                </div>
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                    I have stored these codes in a safe place
                </label>
                <button type="button" className={btnCls} disabled={!saved} onClick={() => onDone(result)}>
                    Continue
                </button>
            </div>
        );
    }

    return (
        <form onSubmit={confirm} className="grid gap-4">
            <div>
                <h2 className="text-lg font-semibold">Set up two-factor authentication</h2>
                <p className="text-sm text-muted-foreground">
                    Add this account to an authenticator app (Google Authenticator, 1Password, Authy...) and enter the code it shows.
                </p>
            </div>
            {secret && (
                <div className="grid gap-2 rounded-md border border-input p-3">
                    <span className="text-xs text-muted-foreground">Setup key</span>
                    <code className="text-sm font-mono break-all select-all">{groupSecret(secret)}</code>
                    <a href={uri} className="text-xs underline underline-offset-2 text-primary">
                        Open in authenticator app (on this device)
                    </a>
                </div>
            )}
            <div className="grid gap-2">
                <label className="text-sm font-medium leading-none" htmlFor="mfa-enroll-code">Authentication code</label>
                <input
                    id="mfa-enroll-code"
                    className={inputCls}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    maxLength={8}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    disabled={!secret}
                />
            </div>
            {error && (
                <div role="alert" className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">
                    {error}
                </div>
            )}
            <button type="submit" disabled={loading || !secret} className={btnCls}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Activate'}
            </button>
        </form>
    );
}
