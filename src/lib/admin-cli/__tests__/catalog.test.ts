import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES, COMMANDS, categoryOf, publicCatalog } from '../catalog';
import { ROUTE_TABLE, reachableRoutes } from '../bridge';
import { EXIT, executeCommand, requiresStepUp, type ExecAuth } from '../exec';
import { SCOPES, type Risk, type Scope } from '../types';
import { EXCLUDED } from '../coverage';

/** Calidad del catalogo (descripciones es/en, riesgos, unicidad) + cobertura de rutas del admin + permisos por ambito. */

const RISKS: Risk[] = ['read', 'write', 'destructive', 'security'];
const SENSITIVE = /pass|secret|token|key|code|otp|credential|cookie|recovery|private|value/i;

describe('catalogo de comandos', () => {
    it('hay comandos y los nombres son unicos y en minusculas', () => {
        expect(COMMANDS.length).toBeGreaterThan(80);
        const names = COMMANDS.map((c) => c.name);
        expect(new Set(names).size).toBe(names.length);
        for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/);
    });

    it.each(COMMANDS.map((c) => [c.name, c] as const))('%s: descripcion es/en, riesgo valido y categoria', (_n, c) => {
        expect(c.summary.es.trim().length, 'summary.es').toBeGreaterThan(5);
        expect(c.summary.en.trim().length, 'summary.en').toBeGreaterThan(5);
        expect(RISKS).toContain(c.risk);
        expect(CATEGORIES[c.name.split(' ')[0]], `categoria de "${c.name}"`).toBeTruthy();
        expect(categoryOf(c).es && categoryOf(c).en).toBeTruthy();
        for (const f of c.flags ?? []) {
            expect(f.description.es.trim(), `--${f.name} es`).not.toBe('');
            expect(f.description.en.trim(), `--${f.name} en`).not.toBe('');
            if (f.type === 'enum') expect(f.values?.length, `--${f.name} valores`).toBeGreaterThan(0);
            if (SENSITIVE.test(f.name) && f.type === 'string' && /pass|secret|token|credential|private|recovery|value|public-key/i.test(f.name)) expect(f.secret, `--${f.name} debe ser secret`).toBe(true);
        }
        const flagNames = (c.flags ?? []).map((f) => f.name);
        expect(new Set(flagNames).size, 'banderas unicas').toBe(flagNames.length);
        for (const reserved of ['json', 'yes', 'help', 'domain']) expect(flagNames, `--${reserved} reservada / prohibida`).not.toContain(reserved);
        const pos = c.positionals ?? [];
        pos.forEach((p, i) => {
            expect(p.description.es && p.description.en).toBeTruthy();
            if (p.variadic) expect(i, 'variadico al final').toBe(pos.length - 1);
            if (i > 0 && p.required !== false) expect(pos[i - 1].required !== false, 'obligatorios antes que opcionales').toBe(true);
        });
    });

    it('las acciones de riesgo exigen confirmacion + step-up; las de lectura no', () => {
        expect(requiresStepUp('read')).toBe(false);
        expect(requiresStepUp('write')).toBe(false);
        expect(requiresStepUp('destructive')).toBe(true);
        expect(requiresStepUp('security')).toBe(true);
        for (const n of ['users disable', 'users sessions revoke', 'extensions uninstall', 'retention run', 'tokens revoke', 'spam config reset', 'accounts unlink']) expect(COMMANDS.find((c) => c.name === n)?.risk, n).toBe('destructive');
        for (const n of ['users create', 'users mfa-reset', 'users password-reset', 'tokens create', 'security keys register', 'extensions credentials set', 'transfer export']) expect(COMMANDS.find((c) => c.name === n)?.risk, n).toBe('security');
    });

    it('el catalogo publico no expone handlers y es serializable', () => {
        const pub = publicCatalog();
        expect(JSON.parse(JSON.stringify(pub)).length).toBe(pub.length);
        expect(JSON.stringify(pub)).not.toMatch(/handler/);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// Cobertura: cada ruta /api/admin/** esta cubierta por un comando o excluida con motivo.
// ---------------------------------------------------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name === 'route.ts') out.push(p);
    }
    return out;
}

function routeKeys(): string[] {
    const base = path.resolve(__dirname, '../../../app/api/admin');
    const keys: string[] = [];
    for (const file of walk(base)) {
        const rel = path.relative(base, path.dirname(file)).split(path.sep).filter(Boolean);
        if (rel[0] === 'cli') continue; // la propia API de la CLI
        const pattern = '/' + rel.map((s) => (s.startsWith('[[...') ? '**' : s)).join('/');
        const src = fs.readFileSync(file, 'utf8');
        const methods = new Set<string>();
        for (const m of src.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) methods.add(m[1]);
        for (const m of src.matchAll(/export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE)\b[^}]*\}/g)) methods.add(m[1]);
        if (pattern.endsWith('**')) keys.push(`ALL /api/admin${pattern}`);
        else for (const m of methods) keys.push(`${m} /api/admin${pattern === '/' ? '' : pattern}`);
    }
    return keys.sort();
}

describe('cobertura de rutas /api/admin/** por comandos', () => {
    const covered = new Set(COMMANDS.flatMap((c) => c.covers ?? []));
    const keys = routeKeys();

    it('se encontraron las rutas del admin', () => {
        expect(keys.length).toBeGreaterThan(50);
        expect(keys).toContain('GET /api/admin/users');
        expect(keys).toContain('ALL /api/admin/mail-transfer/**');
    });

    it('cada ruta esta cubierta por un comando o excluida con motivo', () => {
        const missing = keys.filter((k) => !covered.has(k) && !EXCLUDED[k]);
        expect(missing, `Rutas sin comando ni exclusion:\n${missing.join('\n')}`).toEqual([]);
    });

    it('las exclusiones tienen motivo real y siguen existiendo', () => {
        for (const [k, why] of Object.entries(EXCLUDED)) {
            expect(why.es.length, k).toBeGreaterThan(40);
            expect(why.en.length, k).toBeGreaterThan(40);
            expect(keys, `exclusion obsoleta: ${k}`).toContain(k);
        }
    });

    it('todo lo que declara un comando existe como ruta real y es alcanzable por el puente', async () => {
        const real = new Set(keys);
        for (const k of covered) expect(real.has(k), `covers inexistente: ${k}`).toBe(true);
        const reach = new Set(await reachableRoutes());
        for (const k of keys) {
            if (EXCLUDED[k] || k.startsWith('ALL ')) continue;
            expect(reach.has(k), `el puente no alcanza ${k}`).toBe(true);
        }
        expect(ROUTE_TABLE.length).toBeGreaterThan(40);
    }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------------
// Permisos por ambito: un token sin el scope adecuado recibe "insufficient_scope" (exit 3) ANTES de ejecutar nada.
// ---------------------------------------------------------------------------------------------------------------------

const auth = (scopes: Scope[]): ExecAuth => ({
    actor: { kind: 'user', id: 'u1', email: 'admin@example.test', level: 4, levelSource: 'env' },
    session: { source: 'token', scopes, tokenId: 'tok-1', tokenName: 't' },
    ip: '203.0.113.9',
    userAgent: 'vitest',
});

describe('permisos por ambito (token sin scope)', () => {
    const needed: Record<Risk, Scope> = { read: 'read', write: 'write', destructive: 'write', security: 'security' };

    it.each(COMMANDS.filter((c) => c.risk !== 'read').map((c) => [c.name, c] as const))('%s: un token solo-lectura es rechazado', async (_n, c) => {
        const res = await executeCommand({ argv: c.name.split(' ') }, auth(['read']));
        expect(res.ok).toBe(false);
        expect(res.error?.code).toBe('insufficient_scope');
        expect(res.exitCode).toBe(EXIT.denied);
    });

    it.each(COMMANDS.filter((c) => c.risk === 'security').map((c) => [c.name, c] as const))('%s: write no basta para security', async (_n, c) => {
        const res = await executeCommand({ argv: c.name.split(' ') }, auth(['read', 'write']));
        expect(res.error?.code).toBe('insufficient_scope');
    });

    it('un token sin ningun ambito no puede ni leer', async () => {
        const res = await executeCommand({ argv: ['users', 'list'] }, auth([]));
        expect(res.error?.code).toBe('insufficient_scope');
    });

    it('destructive/security con ambito suficiente piden confirmacion y luego step-up (sin ejecutar)', async () => {
        const full = auth([...SCOPES]);
        const a = await executeCommand({ argv: ['users', 'disable', 'x'] }, full);
        expect(a).toMatchObject({ ok: false, exitCode: EXIT.needs, needs: 'confirm' });
        const b = await executeCommand({ argv: ['users', 'disable', 'x', '--yes'] }, full);
        expect(b).toMatchObject({ ok: false, exitCode: EXIT.needs, needs: 'stepup' });
        const c = await executeCommand({ argv: ['users', 'disable', 'x'], confirm: true, stepUp: 'garbage.garbage' }, full);
        expect(c).toMatchObject({ needs: 'stepup' });
        expect(needed.security).toBe('security');
    });

    it('comando desconocido 127, uso incorrecto 2, linea demasiado larga 2', async () => {
        const full = auth([...SCOPES]);
        expect((await executeCommand({ line: 'rm -rf /' }, full)).exitCode).toBe(EXIT.unknown);
        expect((await executeCommand({ line: 'users list --nope' }, full)).exitCode).toBe(EXIT.usage);
        expect((await executeCommand({ line: `users list ${'a'.repeat(9000)}` }, full)).exitCode).toBe(EXIT.usage);
        expect((await executeCommand({ line: 'users list "x' }, full)).exitCode).toBe(EXIT.usage);
        expect((await executeCommand({}, full)).exitCode).toBe(EXIT.usage);
    });
});
