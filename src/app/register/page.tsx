'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Mail, Book } from 'lucide-react';
import { useDomainConfig } from '@/hooks/useDomainConfig';

export default function Register() {
    const { config } = useDomainConfig();
    const brand = {
        name: config.displayName || config.name,
        logo: config.logo,
        color: config.theme?.primaryColor
    };

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
                body: JSON.stringify(data),
            });

            const json = await res.json();

            if (!res.ok) {
                throw new Error(json.error || 'Something went wrong');
            }

            router.push('/login?registered=true');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container relative h-screen flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
            {/* Left Side - Hero */}
            <div className="relative hidden h-full flex-col bg-muted p-10 text-primary-foreground lg:flex">
                <div
                    className="absolute inset-0 bg-primary/95"
                />
                <div className="relative z-20 flex items-center gap-2 text-lg font-medium">
                    {brand.logo ? <img src={brand.logo} className="h-6 w-6 object-contain" alt={brand.name} /> : <Mail className="h-6 w-6" />}
                    {brand.name}
                    <Link href="/docs" className="ml-6 text-sm font-normal text-primary-foreground/70 hover:text-primary-foreground transition-colors flex items-center gap-1 border-l border-primary-foreground/40 pl-6">
                        <Book className="h-4 w-4" />
                        Docs
                    </Link>
                </div>
                <div className="relative z-20 mt-auto">
                    <blockquote className="space-y-2">
                        <p className="text-lg">
                            &ldquo;Bloomx completely reinvented our workflow. The inbox zero philosophy is baked into every pixel.&rdquo;
                        </p>
                        <footer className="text-sm">Alex Chen</footer>
                    </blockquote>
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
                        <Book className="h-4 w-4" />
                        Docs
                    </Link>
                </div>
                <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
                    <div className="flex flex-col space-y-2 text-center">
                        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
                        <p className="text-sm text-muted-foreground">
                            Enter your details below to create your account
                        </p>
                    </div>

                    <form onSubmit={registerUser} className="grid gap-4">
                        <div className="grid gap-2">
                            <label className="text-sm font-medium leading-none">Full Name</label>
                            <input
                                type="text"
                                required
                                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder="John Doe"
                                value={data.name}
                                onChange={(e) => setData({ ...data, name: e.target.value })}
                            />
                        </div>
                        <div className="grid gap-2">
                            <label className="text-sm font-medium leading-none">Email</label>
                            <input
                                type="email"
                                required
                                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder="name@example.com"
                                value={data.email}
                                onChange={(e) => setData({ ...data, email: e.target.value })}
                            />
                        </div>
                        <div className="grid gap-2">
                            <label className="text-sm font-medium leading-none">Password</label>
                            <input
                                type="password"
                                required
                                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder="••••••••"
                                value={data.password}
                                onChange={(e) => setData({ ...data, password: e.target.value })}
                            />
                        </div>
                        <div className="grid gap-2">
                            <label className="text-sm font-medium leading-none text-primary">Registration Key</label>
                            <input
                                type="text"
                                required
                                className="flex h-9 w-full rounded-md border border-primary/50 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder="Enter secret key..."
                                value={data.key}
                                onChange={(e) => setData({ ...data, key: e.target.value })}
                            />
                        </div>

                        {error && (
                            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2"
                        >
                            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Create Account'}
                        </button>
                    </form>

                    <p className="px-8 text-center text-sm text-muted-foreground">
                        <Link href="/login" className="hover:text-brand underline underline-offset-4">
                            Already have an account? Sign In
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
