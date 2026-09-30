'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useLandingConfig } from '@/hooks/useLandingConfig';
import { AuthLanding } from '@/components/landing/AuthLanding';

const fieldClass = 'flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export default function Register() {
    const { config } = useDomainConfig();
    const { landing, locale, t, text } = useLandingConfig();
    const brand = { name: config.displayName || config.name, logo: config.logo };
    // registration.requireKey = false oculta el campo. La clave de registro la exige el SERVIDOR (/api/register);
    // esta opcion solo debe desactivarse si la instancia no la requiere.
    const requireKey = landing.registration?.requireKey !== false;

    const router = useRouter();
    const [data, setData] = useState({ name: '', email: '', password: '', key: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const registerUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requireKey ? data : { ...data, key: '' }),
            });

            const json = await res.json();

            if (!res.ok) {
                throw new Error(json.error || t('auth.register.genericError'));
            }

            router.push('/login?registered=true');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLanding
            page="register"
            config={landing}
            brand={brand}
            locale={locale}
            title={t('auth.register.title')}
            subtitle={t('auth.register.subtitle')}
            tagline={t('auth.register.tagline')}
            altLink={{ href: '/login', label: t('auth.register.haveAccount') }}
        >
            <form onSubmit={registerUser} className="grid gap-4">
                <div className="grid gap-2">
                    <label htmlFor="reg-name" className="text-sm font-medium leading-none">{t('auth.register.name')}</label>
                    <input
                        id="reg-name"
                        name="name"
                        type="text"
                        autoComplete="name"
                        required
                        className={fieldClass}
                        placeholder={t('auth.register.namePlaceholder')}
                        value={data.name}
                        onChange={(e) => setData({ ...data, name: e.target.value })}
                    />
                </div>
                <div className="grid gap-2">
                    <label htmlFor="reg-email" className="text-sm font-medium leading-none">{t('auth.register.email')}</label>
                    <input
                        id="reg-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        className={fieldClass}
                        placeholder={t('auth.register.emailPlaceholder')}
                        value={data.email}
                        onChange={(e) => setData({ ...data, email: e.target.value })}
                    />
                </div>
                <div className="grid gap-2">
                    <label htmlFor="reg-password" className="text-sm font-medium leading-none">{t('auth.register.password')}</label>
                    <input
                        id="reg-password"
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        required
                        className={fieldClass}
                        placeholder="••••••••"
                        value={data.password}
                        onChange={(e) => setData({ ...data, password: e.target.value })}
                    />
                </div>
                {requireKey && (
                    <div className="grid gap-2">
                        <label htmlFor="reg-key" className="text-sm font-medium leading-none text-primary">{t('auth.register.registrationKey')}</label>
                        <input
                            id="reg-key"
                            name="registrationKey"
                            type="password"
                            autoComplete="off"
                            required
                            className="flex h-9 w-full rounded-md border border-primary/50 bg-background text-foreground px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder={t('auth.register.registrationKeyPlaceholder')}
                            value={data.key}
                            onChange={(e) => setData({ ...data, key: e.target.value })}
                        />
                    </div>
                )}

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
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : (text('registerSubmitLabel') ?? t('auth.register.submit'))}
                </button>
            </form>
        </AuthLanding>
    );
}
