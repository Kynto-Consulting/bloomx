import Link from 'next/link';
import { SearchX } from 'lucide-react';

export const metadata = { title: 'Page not found' };

export default function NotFound() {
    return (
        <main className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
                <SearchX className="h-7 w-7" />
            </div>
            <div className="max-w-md space-y-1">
                <p className="text-sm font-medium text-muted-foreground">404</p>
                <h1 className="text-xl font-semibold">Page not found</h1>
                <p className="text-sm text-muted-foreground">The page you are looking for does not exist or was moved.</p>
            </div>
            <Link
                href="/"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
                Back to inbox
            </Link>
        </main>
    );
}
