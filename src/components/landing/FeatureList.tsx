import { Check } from 'lucide-react';
import type { LandingFeature } from '@/lib/landing-config';
import { LANDING_ICON_MAP } from './icons';

interface Props {
    features: LandingFeature[];
    label: string;
    className?: string;
}

/** Lista de caracteristicas. Hereda el color del contenedor (tokens o color calculado de la superficie). */
export function FeatureList({ features, label, className }: Props) {
    if (!features.length) return null;
    return (
        <ul aria-label={label} className={className ?? 'grid gap-4'}>
            {features.map((f, i) => {
                const Icon = LANDING_ICON_MAP[f.icon || 'check'] || Check;
                return (
                    <li key={i} className="flex items-start gap-3">
                        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-current/30">
                            <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span>
                            <span className="block font-semibold leading-snug">{f.title}</span>
                            {f.text && <span className="block text-sm leading-snug">{f.text}</span>}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}
