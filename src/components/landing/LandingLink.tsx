import Link from 'next/link';

interface Props {
    href: string;
    preview?: boolean;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}

/**
 * Enlace de la landing. Las URLs ya vienen saneadas (https o ruta relativa).
 * - Relativa: next/link. - https: nueva pestana con noopener/noreferrer. - Vista previa: inerte.
 */
export function LandingLink({ href, preview, className, style, children }: Props) {
    if (preview) {
        return (
            <a href="#" onClick={(e) => e.preventDefault()} tabIndex={-1} className={className} style={style}>
                {children}
            </a>
        );
    }
    if (href.startsWith('/')) {
        return <Link href={href} className={className} style={style}>{children}</Link>;
    }
    return <a href={href} target="_blank" rel="noopener noreferrer" className={className} style={style}>{children}</a>;
}
