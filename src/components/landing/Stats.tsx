import type { LandingStat } from '@/lib/landing-config';

interface Props { stats: LandingStat[]; label: string; className?: string }

/** Cifras. Semantica dl (termino -> valor), pintadas valor arriba / etiqueta abajo. */
export function Stats({ stats, label, className }: Props) {
    if (!stats.length) return null;
    return (
        <dl aria-label={label} className={className ?? 'grid grid-cols-2 gap-x-6 gap-y-4'}>
            {stats.map((s, i) => (
                <div key={i} className="flex flex-col-reverse">
                    <dt className="text-sm">{s.label || ''}</dt>
                    <dd className="text-2xl font-bold leading-none">{s.value}</dd>
                </div>
            ))}
        </dl>
    );
}
