'use client';

import { useState, Suspense } from 'react';
// import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Mail, Book } from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { MfaEnrollForm, MfaVerifyForm, type MfaLoginResult } from '@/components/MfaPanels';
import { useI18n } from '@/components/I18nProvider';

function LoginForm() {
    const { config } = useDomainConfig();
    const { t } = useI18n();
    const brand = {
        name: config.displayName || config.name,
        logo: config.logo,
        color: config.theme?.primaryColor
    };

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

    return (
        <div className="container relative min-h-dvh flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
            {/* Left Side - Hero */}
            <div className="relative hidden h-full flex-col bg-muted p-10 text-primary-foreground lg:flex">
                <div
                    className="absolute inset-0 bg-primary/95"
                />
                <div className="relative z-20 flex items-center gap-2 text-lg font-medium">
                    {brand.logo ? <img src={brand.logo} className="h-6 w-6 object-contain" alt={brand.name} /> : <Mail className="h-6 w-6" />}
                    {brand.name}
                    <Link href="/docs" className="ml-6 text-sm font-normal text-primary-foreground underline-offset-4 hover:underline transition-colors flex items-center gap-1 border-l border-primary-foreground/40 pl-6">
                        <Book className="h-4 w-4" aria-hidden="true" />
                        {t('auth.login.docs')}
                    </Link>
                </div>
                <div className="relative z-20 mt-auto">
                    <p className="text-lg">{t('auth.login.tagline')}</p>
                </div>
            </div>

            {/* Right Side - Form */}
            <div className="relative flex h-full flex-col justify-center p-8 lg:p-8">
                {/* Mobile Brand Header */}
                <div className="mb-10 flex flex-col items-center space-y-2 lg:hidden">
                    <div className="flex items-center gap-2 text-xl font-bold text-primary">
                        {brand.logo ? <img src={brand.logo} className="h-8 w-8 object-contain" alt={brand.name} /> : <Mail className="h-8 w-8" />}
                        {brand.name}
                    </div>
                    <Link href="/docs" className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                        <Book className="h-4 w-4" aria-hidden="true" />
                        {t('auth.login.docs')}
                    </Link>
                </div>
                <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
                    <div className="flex flex-col space-y-2 text-center">
                        <h1 className="text-2xl font-semibold tracking-tight">{t('auth.login.title')}</h1>
                        <p className="text-sm text-muted-foreground">
                            {t('auth.login.subtitle')}
                        </p>
                    </div>

                    {registered && (
                        <div role="status" className="p-3 rounded-md bg-success/10 border border-success text-success text-sm text-center">
                            {t('auth.login.registered')}
                        </div>
                    )}

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
                                className="flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
                                className="flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder="••••••••"
                                value={data.password}
                                onChange={(e) => setData({ ...data, password: e.target.value })}
                            />
                        </div>

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
                            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : t('auth.login.submit')}
                        </button>
                    </form>}

                    <p className="text-center text-sm text-muted-foreground">
                        <Link href="/register" className="underline underline-offset-4 hover:text-foreground">
                            {t('auth.login.noAccount')}
                        </Link>
                    </p>

                </div>
            </div>
        </div>
    );
}

export default function Login() {
    return (
        <Suspense fallback={<div role="status" aria-label="Loading" className="flex h-screen w-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
            <LoginForm />
        </Suspense>
    );
}
