'use client';

import { useState, Suspense } from 'react';
// import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { MfaEnrollForm, MfaVerifyForm, type MfaLoginResult } from '@/components/MfaPanels';
import { useLandingConfig } from '@/hooks/useLandingConfig';
import { AuthLanding } from '@/components/landing/AuthLanding';
import { LandingFormExtras } from '@/components/landing/FormExtras';

function LoginForm() {
    const { config } = useDomainConfig();
    const { landing, locale, t, text } = useLandingConfig();
    const brand = { name: config.displayName || config.name, logo: config.logo };

    const router = useRouter();
    const searchParams = useSearchParams();
    const registered = searchParams.get('registered');

    const [data, setData] = useState({ email: '', password: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // Segundo factor: 'mfa' = pedir codigo; 'enroll' = MFA obligatorio y aun no configurado
    const [mfaStep, setMfaStep] = useState<null | { kind: 'mfa' | 'enroll'; token: string }>(null);

    // Guarda la cuenta en la boveda multicuenta y entra (login normal o tras verificar MFA)
    const finishLogin = async (result: MfaLoginResult) => {
        if (result.token && result.user) {
            try {
                const { AccountManager } = await import('@/lib/account-manager');
                AccountManager.addAccount({
                    id: result.user.id,
                    email: result.user.email,
                    name: result.user.name || '',
                    avatar: result.user.avatar,
                    token: result.token
                });
            } catch (err) {
                console.error('Failed to save account locally', err);
            }
        }
        // Force a hard reload to pick up the HttpOnly cookie and update state
        window.location.href = '/';
    };

    const loginUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await res.json();

            if (!res.ok) {
                console.error('[LOGIN-CLIENT] Login failed');
                setError(result.error || t('auth.login.invalidCredentials'));
                setLoading(false);
            } else if (result.mfaRequired && result.mfaToken) {
                setMfaStep({ kind: 'mfa', token: result.mfaToken });
                setLoading(false);
            } else if (result.mfaEnrollRequired && result.mfaToken) {
                setMfaStep({ kind: 'enroll', token: result.mfaToken });
                setLoading(false);
            } else {
                await finishLogin(result);
            }
        } catch (e) {
            console.error('[LOGIN-CLIENT] Login exception');
            setError(t('auth.login.unexpected'));
            setLoading(false);
        }
    };

    const fieldClass = 'flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

    return (
        <AuthLanding
            page="login"
            config={landing}
            brand={brand}
            locale={locale}
            title={t('auth.login.title')}
            subtitle={t('auth.login.subtitle')}
            tagline={t('auth.login.tagline')}
            altLink={{ href: '/register', label: t('auth.login.noAccount') }}
            notice={registered ? (
                <div role="status" className="p-3 rounded-md bg-success/10 border border-success text-success text-sm text-center">
                    {t('auth.login.registered')}
                </div>
            ) : null}
        >
            {mfaStep?.kind === 'mfa' && (
                <MfaVerifyForm
                    mfaToken={mfaStep.token}
                    onSuccess={finishLogin}
                    onCancel={() => { setMfaStep(null); setData({ ...data, password: '' }); }}
                />
            )}
            {mfaStep?.kind === 'enroll' && (
                <MfaEnrollForm mfaToken={mfaStep.token} onDone={finishLogin} />
            )}

            {!mfaStep && <form onSubmit={loginUser} className="grid gap-4">
                <div className="grid gap-2">
                    <label htmlFor="login-email" className="text-sm font-medium leading-none">{t('auth.login.email')}</label>
                    <input
                        id="login-email"
                        name="email"
                        type="email"
                        autoComplete="username"
                        required
                        className={fieldClass}
                        placeholder={t('auth.login.emailPlaceholder')}
                        value={data.email}
                        onChange={(e) => setData({ ...data, email: e.target.value })}
                    />
                </div>
                <div className="grid gap-2">
                    <label htmlFor="login-password" className="text-sm font-medium leading-none">{t('auth.login.password')}</label>
                    <input
                        id="login-password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        className={fieldClass}
                        placeholder="••••••••"
                        value={data.password}
                        onChange={(e) => setData({ ...data, password: e.target.value })}
                    />
                </div>

                <LandingFormExtras />

                {error && (
                    <div role="alert" className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2"
                >
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : (text('submitLabel') ?? t('auth.login.submit'))}
                </button>
            </form>}
        </AuthLanding>
    );
}

export default function Login() {
    return (
        <Suspense fallback={<div role="status" aria-label="Loading" className="flex h-screen w-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
            <LoginForm />
        </Suspense>
    );
}
