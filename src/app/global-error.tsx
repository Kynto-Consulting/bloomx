'use client';

import { useEffect } from 'react';
import { getTheme } from '@/lib/themes';

// global-error sustituye al layout raiz: no hay <ThemeProvider>, ni tokens inyectados, ni Tailwind garantizado.
// Por eso usa estilos propios en linea con `var(--color-*, <valor de respaldo>)`: si los tokens del tema ya
// estan en la pagina (navegacion cliente) se respetan; si no, valen los de los temas base (claro/oscuro).
const light = getTheme('light')!.tokens;
const dark = getTheme('dark')!.tokens;

const css = `
:root{--ge-bg:${light.background};--ge-fg:${light.foreground};--ge-muted:${light['muted-foreground']};--ge-primary:${light.primary};--ge-primary-fg:${light['primary-foreground']};--ge-ring:${light.ring}}
@media (prefers-color-scheme: dark){:root{--ge-bg:${dark.background};--ge-fg:${dark.foreground};--ge-muted:${dark['muted-foreground']};--ge-primary:${dark.primary};--ge-primary-fg:${dark['primary-foreground']};--ge-ring:${dark.ring}}}
body{margin:0;background:var(--color-background,var(--ge-bg));color:var(--color-foreground,var(--ge-fg));font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.ge-wrap{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center}
.ge-wrap h1{margin:0;font-size:1.25rem;font-weight:600}
.ge-wrap p{margin:0;max-width:26rem;font-size:.875rem;line-height:1.5;color:var(--color-muted-foreground,var(--ge-muted))}
.ge-btn{margin-top:8px;padding:8px 16px;border:0;border-radius:6px;font:inherit;font-size:.875rem;font-weight:500;cursor:pointer;background:var(--color-primary,var(--ge-primary));color:var(--color-primary-foreground,var(--ge-primary-fg))}
.ge-btn:focus-visible{outline:2px solid var(--color-ring,var(--ge-ring));outline-offset:2px}
`;

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[global error]', error.digest || '', error.message);
    }, [error]);

    return (
        <html lang="en">
            <body>
                <style dangerouslySetInnerHTML={{ __html: css }} />
                <main className="ge-wrap" role="alert">
                    <h1>Something went wrong</h1>
                    <p>The app hit an unexpected error. Try again; if it keeps happening, reload the page.</p>
                    {error.digest ? <p>Reference: {error.digest}</p> : null}
                    <button type="button" className="ge-btn" onClick={() => reset()}>
                        Try again
                    </button>
                </main>
            </body>
        </html>
    );
}
