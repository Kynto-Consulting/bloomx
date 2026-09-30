import { Loader2 } from 'lucide-react';

// Fallback de Suspense a nivel raiz: sin texto grande para no parpadear en cargas rapidas.
export default function Loading() {
    return (
        <div className="flex min-h-[40vh] w-full items-center justify-center bg-background text-muted-foreground" role="status" aria-live="polite">
            <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <span className="sr-only">Loading</span>
        </div>
    );
}
