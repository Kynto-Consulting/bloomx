import { Mail } from 'lucide-react';
import type { LandingView } from './types';

interface Props {
    view: LandingView;
    size?: 'sm' | 'lg';
    /** Sobre que fondo va: tokens de tema (segun claro/oscuro) o una superficie personalizada. */
    on?: 'theme' | 'dark-surface' | 'light-surface';
    className?: string;
}

/** Logo + nombre. `logo.light` = para modo claro, `logo.dark` = para modo oscuro; el logo del dominio es el respaldo. */
export function BrandMark({ view, size = 'sm', on = 'theme', className }: Props) {
    const { cfg, brand } = view;
    const showName = cfg.logo?.showName !== false;
    const base = size === 'lg' ? 32 : 24;
    const height = cfg.logo?.height ?? base;
    const light = cfg.logo?.light || brand.logo || undefined;
    const dark = cfg.logo?.dark || cfg.logo?.light || brand.logo || undefined;
    // Con nombre visible el nombre ya describe la marca (alt vacio); sin nombre, el logo lleva alt.
    const alt = showName ? '' : brand.name;
    const imgProps = {
        alt,
        height,
        style: { height, width: 'auto', maxWidth: 240 },
        className: 'object-contain',
        referrerPolicy: 'no-referrer' as const,
        decoding: 'async' as const,
    };

    let logo: React.ReactNode;
    if (!light && !dark) {
        logo = <Mail style={{ height, width: height }} aria-hidden="true" />;
    } else if (on === 'dark-surface') {
        logo = <img src={dark || light} {...imgProps} />;
    } else if (on === 'light-surface') {
        logo = <img src={light || dark} {...imgProps} />;
    } else if (light === dark) {
        logo = <img src={light} {...imgProps} />;
    } else {
        logo = (
            <>
                <img src={light} {...imgProps} className="object-contain dark:hidden" />
                <img src={dark} {...imgProps} className="hidden object-contain dark:block" />
            </>
        );
    }

    return (
        <div className={className ?? 'flex items-center gap-2'}>
            {logo}
            {showName && <span className={size === 'lg' ? 'text-xl font-bold' : 'text-lg font-medium'}>{brand.name}</span>}
        </div>
    );
}
