
'use client';

import { useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Shield } from 'lucide-react';


function AdminLoginForm() {
    const router = useRouter();
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
                setError(result.error || 'Invalid credentials');
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
            setError('An unexpected error occurred');
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-muted/50">
            <div className="w-full max-w-md space-y-8">
                <div className="flex flex-col items-center">
                    <Shield className="h-12 w-12 text-primary" />
                    <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-foreground">
                        Domain Manager
                    </h2>
                    <p className="mt-2 text-center text-sm text-muted-foreground">
                        Log in to manage your BloomX instance
                    </p>
                </div>
                <form className="mt-8 space-y-6" onSubmit={loginUser}>
                    <div className="-space-y-px rounded-md shadow-sm">
                        <div>
                            <input
                                type="email"
                                required
                                className="relative block w-full rounded-t-md border-0 py-1.5 text-foreground ring-1 ring-inset ring-input placeholder:text-muted-foreground focus:z-10 focus:ring-2 focus:ring-inset focus:ring-ring sm:text-sm sm:leading-6 px-3"
                                placeholder="Email address"
                                value={data.email}
                                onChange={(e) => setData({ ...data, email: e.target.value })}
                            />
                        </div>
                        <div>
                            <input
                                type="password"
                                required
                                className="relative block w-full rounded-b-md border-0 py-1.5 text-foreground ring-1 ring-inset ring-input placeholder:text-muted-foreground focus:z-10 focus:ring-2 focus:ring-inset focus:ring-ring sm:text-sm sm:leading-6 px-3"
                                placeholder="Password"
                                value={data.password}
                                onChange={(e) => setData({ ...data, password: e.target.value })}
                            />
                        </div>
                    </div>

                    {error && <div className="text-destructive text-sm text-center">{error}</div>}

                    <div>
                        <button
                            type="submit"
                            disabled={loading}
                            className="group relative flex w-full justify-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Sign in'}
                        </button>
                    </div>

                    <div className="text-center text-sm">
                        <Link href="/admin/register" className="font-medium text-primary hover:text-primary">
                            Register new Domain
                        </Link>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function AdminLogin() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <AdminLoginForm />
        </Suspense>
    );
}
