
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Globe, ArrowRight } from 'lucide-react';

export default function AdminRegister() {
    const router = useRouter();
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
                setError(result.error || 'Registration failed');
            } else {
                setStep('VERIFY');
            }
        } catch (e) {
            setError('Network error');
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
                setError(result.error || 'Verification failed');
            } else {
                router.push('/admin/dashboard');
            }
        } catch (e) {
            setError('Network error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-muted/50">
            <div className="w-full max-w-md space-y-8 bg-card p-8 rounded-lg shadow">
                <div className="flex flex-col items-center">
                    <Globe className="h-12 w-12 text-primary" />
                    <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-foreground">
                        {step === 'REGISTER' ? 'Register Domain' : 'Verify Email'}
                    </h2>
                </div>

                {step === 'REGISTER' ? (
                    <form className="mt-8 space-y-6" onSubmit={handleRegister}>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-foreground/80">Domain Name</label>
                                <input
                                    type="text"
                                    required
                                    className="mt-1 block w-full rounded-md border-input shadow-sm focus:border-primary focus:ring-ring sm:text-sm border p-2"
                                    placeholder="my-company"
                                    value={data.domain}
                                    onChange={(e) => setData({ ...data, domain: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-foreground/80">Email address</label>
                                <input
                                    type="email"
                                    required
                                    className="mt-1 block w-full rounded-md border-input shadow-sm focus:border-primary focus:ring-ring sm:text-sm border p-2"
                                    value={data.email}
                                    onChange={(e) => setData({ ...data, email: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-foreground/80">Password</label>
                                <input
                                    type="password"
                                    required
                                    className="mt-1 block w-full rounded-md border-input shadow-sm focus:border-primary focus:ring-ring sm:text-sm border p-2"
                                    value={data.password}
                                    onChange={(e) => setData({ ...data, password: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-foreground/80">Resend API Key</label>
                                <p className="text-xs text-muted-foreground">Used to verify domain ownership and send emails.</p>
                                <input
                                    type="text"
                                    required
                                    className="mt-1 block w-full rounded-md border-input shadow-sm focus:border-primary focus:ring-ring sm:text-sm border p-2 font-mono"
                                    placeholder="re_..."
                                    value={data.resendApiKey}
                                    onChange={(e) => setData({ ...data, resendApiKey: e.target.value })}
                                />
                            </div>
                        </div>

                        {error && <div className="text-destructive text-sm text-center">{error}</div>}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Next'}
                        </button>

                        <div className="text-center text-sm">
                            <Link href="/admin/login" className="font-medium text-primary hover:text-primary">
                                Already have an account? Log in
                            </Link>
                        </div>
                    </form>
                ) : (
                    <form className="mt-8 space-y-6" onSubmit={handleVerify}>
                        <div className="text-center text-sm text-muted-foreground">
                            We sent a verification code to <strong>{data.email}</strong>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-foreground/80">Verification Code</label>
                            <input
                                type="text"
                                required
                                className="mt-1 block w-full rounded-md border-input shadow-sm focus:border-primary focus:ring-ring text-center text-2xl tracking-widest border p-2"
                                placeholder="000000"
                                value={data.otp}
                                onChange={(e) => setData({ ...data, otp: e.target.value })}
                            />
                        </div>

                        {error && <div className="text-destructive text-sm text-center">{error}</div>}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-success-foreground bg-success hover:bg-success/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-success disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Verify & Create Domain'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
