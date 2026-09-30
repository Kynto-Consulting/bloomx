
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Globe } from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useLandingConfig } from '@/hooks/useLandingConfig';
import { AuthLanding } from '@/components/landing/AuthLanding';

export default function AdminRegister() {
    const router = useRouter();
    const { config } = useDomainConfig();
    const { landing, locale, t } = useLandingConfig();
    const brand = { name: config.displayName || config.name, logo: config.logo };
    const [step, setStep] = useState<'REGISTER' | 'VERIFY'>('REGISTER');
    const [data, setData] = useState({ email: '', password: '', domain: '', otp: '', resendApiKey: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev'}/api/auth/register-domain`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: data.email,
                    password: data.password,
                    domain: data.domain,
                    resendApiKey: data.resendApiKey
                })
            });

            const result = await res.json();
            if (!res.ok) {
                setError(result.error || t('admin.register.failed'));
            } else {
                setStep('VERIFY');
            }
        } catch (e) {
            setError(t('common.networkError'));
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'https://backend.bloomx.arubik.dev'}/api/auth/verify-domain`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: data.email,
                    otp: data.otp
                })
            });

            const result = await res.json();
            if (!res.ok) {
                setError(result.error || t('admin.register.verifyFailed'));
            } else {
                router.push('/admin');
            }
        } catch (e) {
            setError(t('common.networkError'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLanding
            page="admin-register"
            config={landing}
            brand={brand}
            locale={locale}
            forceLayout="center"
            marketing={false}
            icon={<Globe className="h-12 w-12 text-primary" />}
            title={step === 'REGISTER' ? t('admin.register.registerTitle') : t('admin.register.verifyTitle')}
            altLink={step === 'REGISTER' ? { href: '/admin/login', label: t('admin.register.haveAccount') } : undefined}
        >
            {step === 'REGISTER' ? (
        <form className="space-y-6" onSubmit={handleRegister}>
            <div className="space-y-4">
                <div>
                    <label htmlFor="ar-domain" className="block text-sm font-medium text-foreground">{t('admin.register.domainName')}</label>
                    <input
                        id="ar-domain"
                        type="text"
                        required
                        autoComplete="off"
                        className="mt-1 block w-full rounded-md border border-input bg-background text-foreground shadow-sm focus:border-primary focus:ring-2 focus:ring-ring sm:text-sm p-2"
                        placeholder="my-company"
                        value={data.domain}
                        onChange={(e) => setData({ ...data, domain: e.target.value })}
                    />
                </div>
                <div>
                    <label htmlFor="ar-email" className="block text-sm font-medium text-foreground">{t('admin.register.email')}</label>
                    <input
                        id="ar-email"
                        type="email"
                        required
                        autoComplete="username"
                        className="mt-1 block w-full rounded-md border border-input bg-background text-foreground shadow-sm focus:border-primary focus:ring-2 focus:ring-ring sm:text-sm p-2"
                        value={data.email}
                        onChange={(e) => setData({ ...data, email: e.target.value })}
                    />
                </div>
                <div>
                    <label htmlFor="ar-password" className="block text-sm font-medium text-foreground">{t('admin.register.password')}</label>
                    <input
                        id="ar-password"
                        type="password"
                        required
                        autoComplete="new-password"
                        className="mt-1 block w-full rounded-md border border-input bg-background text-foreground shadow-sm focus:border-primary focus:ring-2 focus:ring-ring sm:text-sm p-2"
                        value={data.password}
                        onChange={(e) => setData({ ...data, password: e.target.value })}
                    />
                </div>
                <div>
                    <label htmlFor="ar-resend" className="block text-sm font-medium text-foreground">{t('admin.register.resendKey')}</label>
                    <p id="ar-resend-help" className="text-xs text-muted-foreground">{t('admin.register.resendKeyHelp')}</p>
                    <input
                        id="ar-resend"
                        type="password"
                        required
                        autoComplete="off"
                        aria-describedby="ar-resend-help"
                        className="mt-1 block w-full rounded-md border border-input bg-background text-foreground shadow-sm focus:border-primary focus:ring-2 focus:ring-ring sm:text-sm p-2 font-mono"
                        placeholder="re_..."
                        value={data.resendApiKey}
                        onChange={(e) => setData({ ...data, resendApiKey: e.target.value })}
                    />
                </div>
            </div>

            {error && <div role="alert" className="text-destructive text-sm text-center">{error}</div>}

            <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring disabled:opacity-50"
            >
                {loading ? <Loader2 className="animate-spin h-5 w-5" aria-hidden="true" /> : t('admin.register.next')}
            </button>
        </form>
    ) : (
        <form className="space-y-6" onSubmit={handleVerify}>
            <div className="text-center text-sm text-muted-foreground">
                {t('admin.register.verifyIntro', { email: data.email })}
            </div>
            <div>
                <label htmlFor="ar-otp" className="block text-sm font-medium text-foreground">{t('admin.register.code')}</label>
                <input
                    id="ar-otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    className="mt-1 block w-full rounded-md border border-input bg-background text-foreground shadow-sm focus:border-primary focus:ring-2 focus:ring-ring text-center text-2xl tracking-widest p-2"
                    placeholder="000000"
                    value={data.otp}
                    onChange={(e) => setData({ ...data, otp: e.target.value })}
                />
            </div>

            {error && <div role="alert" className="text-destructive text-sm text-center">{error}</div>}

            <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-success-foreground bg-success hover:bg-success/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-success disabled:opacity-50"
            >
                {loading ? <Loader2 className="animate-spin h-5 w-5" aria-hidden="true" /> : t('admin.register.verify')}
            </button>
        </form>
    )}
        </AuthLanding>
    );
}
