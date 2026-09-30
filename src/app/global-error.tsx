'use client';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <html>
            <body>
                <div className="flex h-screen w-full flex-col items-center justify-center gap-4">
                    <h2 className="text-xl font-bold">Something went wrong!</h2>
                    <button
                        className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
                        onClick={() => reset()}
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}
