/** Comparacion de versiones semver (PURA). Acepta prefijo "v", prerelease y build; lo invalido no compara. */

export interface Semver { major: number; minor: number; patch: number; pre: string[] }

const SEMVER_RE = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]{1,40}))?(?:\+[0-9A-Za-z.-]{1,40})?$/;

export function parseSemver(value: unknown): Semver | null {
    if (typeof value !== 'string') return null;
    const m = SEMVER_RE.exec(value.trim());
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

function comparePre(a: string[], b: string[]): number {
    // Una version sin prerelease es MAYOR que la misma con prerelease.
    if (a.length === 0 && b.length === 0) return 0;
    if (a.length === 0) return 1;
    if (b.length === 0) return -1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i], y = b[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
        if (nx && ny) { const d = Number(x) - Number(y); if (d !== 0) return d < 0 ? -1 : 1; }
        else if (nx !== ny) return nx ? -1 : 1; // numerico < alfanumerico
        else if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

/** -1, 0, 1; `null` si alguna de las dos no es semver valida. */
export function compareSemver(a: unknown, b: unknown): -1 | 0 | 1 | null {
    const x = parseSemver(a), y = parseSemver(b);
    if (!x || !y) return null;
    for (const key of ['major', 'minor', 'patch'] as const) {
        if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
    }
    const pre = comparePre(x.pre, y.pre);
    return pre < 0 ? -1 : pre > 0 ? 1 : 0;
}

/** true si la version del catalogo es estrictamente mayor que la instalada (ambas validas). */
export function hasUpdate(installed: unknown, catalog: unknown): boolean {
    return compareSemver(catalog, installed) === 1;
}
