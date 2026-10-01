import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Next.js falla el build ("The "use client" directive must be placed before other expressions") si hay un import encima
// de la directiva. tsc y vitest no lo detectan: solo `next build`. Esta prueba lo atrapa antes de desplegar.
function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!['node_modules', '.next', '.git', '__tests__'].includes(e.name)) walk(p, out); }
        else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
    }
    return out;
}

describe('directivas "use client" / "use server"', () => {
    it('siempre son la primera sentencia del archivo', () => {
        const bad: string[] = [];
        for (const file of walk(path.resolve(__dirname, '../..'))) {
            const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
            const idx = lines.findIndex((l) => /^\s*['"]use (client|server)['"];?\s*$/.test(l));
            if (idx <= 0) continue;
            const before = lines.slice(0, idx).filter((l) => l.trim() && !/^\s*(\/\/|\/\*|\*)/.test(l));
            if (before.length) bad.push(`${path.relative(process.cwd(), file)}:${idx + 1}`);
        }
        expect(bad, `Mueve la directiva a la primera linea en: ${bad.join(', ')}`).toEqual([]);
    });
});
