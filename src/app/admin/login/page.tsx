
'use client';

import { useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Shield } from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useLandingConfig } from '@/hooks/useLandingConfig';
import { AuthLanding } from '@/components/landing/AuthLanding';


function AdminLoginForm() {
    const router = useRouter();
    const { config } = useDomainConfig();
    const { landing, locale, t } = useLandingConfig();
    const brand = { name: config.displayName || config.name, logo: config.logo };
    const [data, setData] = useState({ email: '', password: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const loginUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            // Point to Local Proxy API for Domain Manager Login
            // This ensures cookies are set on the frontend domain
            const res = await fetch(`/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await res.json();

            if (!res.ok) {
                setError(result.error || t('admin.login.invalid'));
                setLoading(false);
            } else {
                // We likely need to store the session token in a way BloomX specific
                // However, since we are using cookies on the backend domain, 
                // and if we are on localhost ports (3000 vs 3001), 
                // we might need to handle cross-origin cookies or just store token in localStorage for API calls.
                // But lucia sets cookies.
                // If Frontend is on localhost:3000 and Backend on localhost:3001,
                // cookies set by backend won't be sent automatically unless we use credentials: 'include'.

                // For now, let's assume simple token return or rely on proxy?
                // Actually the backend endpoint returns a session cookie.
                // We should probably proxy the auth requests via Next.js API in bloomx if cross-domain is an issue.
                // But for "Reskinning to Domber" / SaaS, bloomx might BE the domain.
                // Let's assume we proceed.

                router.push('/admin/dashboard');
            }
        } catch (e) {
            setError(t('common.unexpectedError'));
            setLoading(false);
        }
    };

    return (
        <AuthLanding
            page="admin-login"
            config={landing}
            brand={brand}
            locale={locale}
            forceLayout="center"
            marketing={false}
            icon={<Shield className="h-12 w-12 text-primary" />}
            title={t('admin.login.title')}
            subtitle={t('admin.login.subtitle')}
            altLink={{ href: '/admin/register', label: t('admin.login.register') }}
        >
            <form className="space-y-6" onSubmit={loginUser}>
            <div className="-space-y-px rounded-md shadow-sm">
                <div>
                    <label htmlFor="admin-email" className="sr-only">{t('admin.login.emailLabel')}</label>
                    <input
                        id="admin-email"
                        name="email"
                        type="email"
                        autoComplete="username"
                        required
                        className="relative block w-full rounded-t-md border-0 bg-background py-2 text-foreground ring-1 ring-inset ring-input placeholder:text-muted-foreground focus:z-10 focus:ring-2 focus:ring-inset focus:ring-ring sm:text-sm sm:leading-6 px-3"
                        placeholder={t('admin.login.emailLabel')}
                        value={data.email}
                        onChange={(e) => setData({ ...data, email: e.target.value })}
                    />
                </div>
                <div>
                    <label htmlFor="admin-password" className="sr-only">{t('admin.login.passwordLabel')}</label>
                    <input
                        id="admin-password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        className="relative block w-full rounded-b-md border-0 bg-background py-2 text-foreground ring-1 ring-inset ring-input placeholder:text-muted-foreground focus:z-10 focus:ring-2 focus:ring-inset focus:ring-ring sm:text-sm sm:leading-6 px-3"
                        placeholder={t('admin.login.passwordLabel')}
                        value={data.password}
                        onChange={(e) => setData({ ...data, password: e.target.value })}
                    />
                </div>
            </div>

            {error && <div role="alert" className="text-destructive text-sm text-center">{error}</div>}

            <div>
                <button
                    type="submit"
                    disabled={loading}
                    className="group relative flex w-full justify-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
                >
                    {loading ? <Loader2 className="animate-spin h-5 w-5" aria-hidden="true" /> : t('admin.login.submit')}
                </button>
            </div>
        </form>
        </AuthLanding>
    );
}

export default function AdminLogin() {
    return (
        <Suspense fallback={<div role="status" className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" /></div>}>
            <AdminLoginForm />
        </Suspense>
    );
}
