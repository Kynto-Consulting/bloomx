import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DOC_NAV, DOC_PAGES, docHref, neighbours } from '../nav';
import { DOC_CONTENT } from '../registry';
import { ENV_GROUPS, ENV_VARS } from '../env';
import { buildIndex, search } from '../search';
import { resolveDocsVisibility } from '@/lib/landing-config';
import type { Block, Locale } from '../types';

/**
 * Evita documentacion falsa: enlaces internos validos (pagina y ancla), paridad es/en, variables de entorno reales
 * y ausencia de clases de paleta cruda en las paginas de /docs.
 */

const FRONTEND = process.cwd();
const DOCS_DIR = path.join(FRONTEND, 'src', 'app', 'docs');
const BACKEND = path.resolve(FRONTEND, '..', 'bloomx-backend');
const LOCALES: Locale[] = ['es', 'en'];

const INLINE_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;

function blockStrings(b: Block): string[] {
    switch (b.t) {
        case 'p': return [b.text];
        case 'ul':
        case 'ol': return b.items;
        case 'callout': return [b.text, b.title ?? ''];
        case 'table': return [...b.rows.flat(), ...b.head, b.caption ?? ''];
        case 'h2':
        case 'h3': return [b.text];
        default: return [];
    }
}

function anchorsOf(slug: string): Set<string> {
    const set = new Set<string>();
    for (const l of LOCALES) for (const b of DOC_CONTENT[slug]?.[l] ?? []) if (b.t === 'h2' || b.t === 'h3') set.add(b.id);
    return set;
}

function walk(dir: string, exts: string[], skip: (p: string) => boolean = () => false, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git' || skip(p)) continue;
        if (e.isDirectory()) walk(p, exts, skip, out);
        else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
    }
    return out;
}

describe('navegacion de docs', () => {
    it('cada pagina de la navegacion tiene ruta y contenido en es y en', () => {
        const slugs = new Set<string>();
        for (const p of DOC_PAGES) {
            expect(slugs.has(p.slug), `slug duplicado ${p.slug}`).toBe(false);
            slugs.add(p.slug);
            const file = p.slug ? path.join(DOCS_DIR, p.slug, 'page.tsx') : path.join(DOCS_DIR, 'page.tsx');
            expect(fs.existsSync(file), `falta ${file}`).toBe(true);
            expect(DOC_CONTENT[p.slug], `sin contenido para "${p.slug}"`).toBeTruthy();
            for (const l of LOCALES) {
                expect(DOC_CONTENT[p.slug][l].length, `${p.slug}/${l} vacio`).toBeGreaterThan(0);
                expect(p.title[l].length).toBeGreaterThan(0);
                expect(p.description[l].length).toBeGreaterThan(0);
            }
        }
        for (const k of Object.keys(DOC_CONTENT)) expect(slugs.has(k), `contenido huerfano "${k}"`).toBe(true);
    });

    it('no hay carpetas de pagina sin entrada en la navegacion', () => {
        const dirs = fs.readdirSync(DOCS_DIR, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith('_') && fs.existsSync(path.join(DOCS_DIR, e.name, 'page.tsx')))
            .map((e) => e.name);
        for (const d of dirs) expect(DOC_PAGES.some((p) => p.slug === d), `/docs/${d} no esta en la navegacion`).toBe(true);
    });

    it('anterior/siguiente recorren todas las paginas una vez', () => {
        const seen: string[] = [];
        let cur = DOC_PAGES[0];
        while (cur) {
            seen.push(cur.slug);
            cur = neighbours(cur.slug).next as typeof cur;
        }
        expect(seen).toEqual(DOC_PAGES.map((p) => p.slug));
        expect(neighbours(DOC_PAGES[0].slug).prev).toBeUndefined();
    });

    it('el titulo de cada seccion existe en ambos idiomas', () => {
        for (const s of DOC_NAV) for (const l of LOCALES) expect(s.title[l]).toBeTruthy();
    });
});

describe('contenido bilingue', () => {
    it('es y en tienen la misma estructura de bloques y los mismos ids de encabezado', () => {
        for (const p of DOC_PAGES) {
            const es = DOC_CONTENT[p.slug].es;
            const en = DOC_CONTENT[p.slug].en;
            expect(en.map((b) => b.t), `estructura distinta en ${p.slug}`).toEqual(es.map((b) => b.t));
            const ids = (bs: Block[]) => bs.filter((b): b is Extract<Block, { t: 'h2' | 'h3' }> => b.t === 'h2' || b.t === 'h3').map((b) => b.id);
            expect(ids(en), `ids distintos en ${p.slug}`).toEqual(ids(es));
        }
    });

    it('los ids de encabezado son unicos por pagina y las tablas son rectangulares', () => {
        for (const p of DOC_PAGES) {
            for (const l of LOCALES) {
                const seen = new Set<string>();
                for (const b of DOC_CONTENT[p.slug][l]) {
                    if (b.t === 'h2' || b.t === 'h3') {
                        expect(/^[a-z0-9-]+$/.test(b.id), `id invalido ${p.slug}#${b.id}`).toBe(true);
                        expect(seen.has(b.id), `id duplicado ${p.slug}/${l}#${b.id}`).toBe(false);
                        seen.add(b.id);
                    }
                    if (b.t === 'table') {
                        for (const r of b.rows) expect(r.length, `fila con distinto numero de columnas en ${p.slug}/${l}: ${r[0]}`).toBe(b.head.length);
                    }
                    if (b.t === 'code') expect(b.code.trim().length).toBeGreaterThan(0);
                }
            }
        }
    });

    it('no hay secretos reales en los ejemplos de codigo (solo marcadores)', () => {
        const suspicious = [/re_[A-Za-z0-9]{20,}/, /sk-[A-Za-z0-9]{20,}/, /whsec_[A-Za-z0-9+/]{16,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----\n[A-Za-z0-9+/=\n]{40,}/];
        for (const p of DOC_PAGES) for (const l of LOCALES) for (const b of DOC_CONTENT[p.slug][l]) {
            if (b.t !== 'code') continue;
            for (const re of suspicious) expect(re.test(b.code), `posible secreto en ${p.slug}/${l}`).toBe(false);
        }
    });
});

describe('enlaces internos', () => {
    const checkLink = (href: string, where: string) => {
        if (!href.startsWith('/')) return;
        const [pathPart, anchor] = href.split('#');
        expect(pathPart === '/docs' || pathPart.startsWith('/docs/'), `enlace interno fuera de /docs (${href}) en ${where}`).toBe(true);
        const slug = pathPart === '/docs' ? '' : pathPart.slice('/docs/'.length);
        const page = DOC_PAGES.find((p) => p.slug === slug);
        expect(page, `enlace roto ${href} en ${where}`).toBeTruthy();
        if (anchor && slug !== '') expect(anchorsOf(slug).has(anchor), `ancla inexistente ${href} en ${where}`).toBe(true);
    };

    it('todos los enlaces de las paginas y de la navegacion apuntan a paginas y anclas que existen', () => {
        for (const p of DOC_PAGES) {
            checkLink(docHref(p.slug), 'nav');
            for (const l of LOCALES) {
                for (const b of DOC_CONTENT[p.slug][l]) {
                    for (const s of blockStrings(b)) {
                        for (const m of s.matchAll(INLINE_LINK_RE)) checkLink(m[2], `${p.slug}/${l}`);
                    }
                }
            }
        }
    });

    it('los enlaces a anclas de la propia pagina (`#id`) existen', () => {
        for (const p of DOC_PAGES) for (const l of LOCALES) {
            const ids = anchorsOf(p.slug);
            for (const b of DOC_CONTENT[p.slug][l]) for (const s of blockStrings(b)) for (const m of s.matchAll(INLINE_LINK_RE)) {
                if (m[2].startsWith('#')) expect(ids.has(m[2].slice(1)), `ancla local rota ${m[2]} en ${p.slug}/${l}`).toBe(true);
            }
        }
    });

    it('las descripciones de variables tambien tienen enlaces validos', () => {
        for (const v of ENV_VARS) for (const l of LOCALES) for (const m of v.desc[l].matchAll(INLINE_LINK_RE)) checkLink(m[2], `env ${v.name}`);
    });
});

describe('variables de entorno documentadas', () => {
    const feExample = fs.readFileSync(path.join(FRONTEND, '.env.example'), 'utf8');
    const beExamplePath = path.join(BACKEND, '.env.example');
    const beExample = fs.existsSync(beExamplePath) ? fs.readFileSync(beExamplePath, 'utf8') : '';

    const skipDocs = (p: string) => p.split(path.sep).join('/').includes('/src/app/docs/');
    const feFiles = [
        ...walk(path.join(FRONTEND, 'src'), ['.ts', '.tsx', '.mjs', '.js'], skipDocs),
        ...walk(path.join(FRONTEND, 'scripts'), ['.ts', '.mjs', '.js']),
        path.join(FRONTEND, 'next.config.js'),
    ].filter((f) => fs.existsSync(f));
    const beFiles = [
        ...walk(path.join(BACKEND, 'src'), ['.ts', '.tsx', '.mjs', '.js']),
        ...walk(path.join(BACKEND, 'scripts'), ['.ts', '.mjs', '.js']),
        path.join(BACKEND, 'sync-extensions.mjs'),
    ].filter((f) => fs.existsSync(f));

    const feCode = feFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n') + '\n' + feExample;
    const beCode = beFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n') + '\n' + beExample;
    const has = (text: string, name: string) => new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`).test(text);

    it('cada variable listada existe en un .env.example o en el codigo (sin contar /docs)', () => {
        const missing: string[] = [];
        for (const v of ENV_VARS) {
            const inFe = has(feCode, v.name);
            const inBe = beFiles.length > 0 && has(beCode, v.name);
            const ok = v.scope === 'frontend' ? inFe : v.scope === 'backend' ? (beFiles.length === 0 ? true : inBe) : (inFe || inBe);
            if (!ok) missing.push(`${v.name} (${v.scope})`);
        }
        expect(missing, `variables documentadas que no existen: ${missing.join(', ')}`).toEqual([]);
    });

    it('las variables de un solo repositorio no se leen solo en el otro', () => {
        if (beFiles.length === 0) return;
        for (const v of ENV_VARS) {
            if (v.scope === 'frontend') expect(has(feCode, v.name), `${v.name} no esta en el frontend`).toBe(true);
            if (v.scope === 'backend') expect(has(beCode, v.name), `${v.name} no esta en el backend`).toBe(true);
        }
    });

    it('no se documentan variables retiradas', () => {
        const removed = ['COOKIE_SECRET', 'EXPANSION_SECRET', 'AI_OPENAI_API_KEY', 'AI_GEMINI_API_KEY', 'AI_ANTHROPIC_API_KEY', 'AI_COHERE_API_KEY', 'SLACK_SIGNING_SECRET',
            'EXPANSION_CRM_URL', 'EXPANSION_CRM_API_KEY', 'EXPANSION_WEBHOOK_URL', 'TRELLO_SECRET', 'EXTENSION_HOOKS_SECRET', 'FRONTEND_INTERNAL_URL'];
        const names = new Set(ENV_VARS.map((e) => e.name));
        for (const r of removed) expect(names.has(r), `${r} ya no existe`).toBe(false);
    });

    it('WEBHOOK_SECRET y RESEND_WEBHOOK_SECRET son opcionales', () => {
        for (const n of ['WEBHOOK_SECRET', 'RESEND_WEBHOOK_SECRET']) {
            const v = ENV_VARS.find((e) => e.name === n);
            expect(v?.required).toBe('optional');
        }
    });

    it('los defaults documentados coinciden con el codigo (se extraen del fuente)', () => {
        const grab = (file: string, re: RegExp): number | undefined => {
            const p = path.join(FRONTEND, file);
            if (!fs.existsSync(p)) return undefined;
            const m = re.exec(fs.readFileSync(p, 'utf8'));
            if (!m || !/^[0-9 *_]+$/.test(m[1])) return undefined;
            return Function('return (' + m[1].replace(/_/g, '') + ')')() as number;
        };
        const doc = (n: string) => Number(ENV_VARS.find((e) => e.name === n && e.scope !== 'backend')?.default);
        const cases: Array<[string, string, RegExp]> = [
            ['SESSION_TTL_SECONDS', 'src/lib/jwt.ts', /intEnv\("SESSION_TTL_SECONDS",\s*([0-9 *]+),/],
            ['SESSION_ABSOLUTE_MAX_SECONDS', 'src/lib/jwt.ts', /intEnv\("SESSION_ABSOLUTE_MAX_SECONDS",\s*([0-9 *]+),/],
            ['MAX_SENDS_PER_HOUR', 'src/app/api/emails/route.ts', /process\.env\.MAX_SENDS_PER_HOUR \|\| '(\d+)'/],
            ['ELIXIR_MAX_ROWS_PER_HOUR', 'src/lib/elixir-worker.ts', /MAX_BULK_ROWS \|\| '', 10\) \|\| ([0-9_]+)/],
            ['ELIXIR_MAX_CAMPAIGN_ROWS', 'src/lib/elixir-campaigns.ts', /ELIXIR_MAX_CAMPAIGN_ROWS \|\| '', 10\) \|\| ([0-9_]+)/],
            ['RETENTION_SPAM_DAYS', 'src/lib/retention.ts', /intEnv\('RETENTION_SPAM_DAYS', (\d+)\)/],
            ['AUDIT_RETENTION_DAYS', 'src/lib/retention.ts', /intEnv\('AUDIT_RETENTION_DAYS', (\d+)\)/],
            ['SECURE_MESSAGE_TTL_DAYS', 'src/lib/sealed/schema.ts', /SECURE_MESSAGE_TTL_DAYS \|\| '(\d+)'/],
            ['ASSET_UPLOAD_URL_TTL_SECONDS', 'src/lib/asset-url.ts', /intEnv\("ASSET_UPLOAD_URL_TTL_SECONDS", ([0-9 *]+)\)/],
            ['ASSET_URL_TTL_SECONDS', 'src/lib/asset-url.ts', /intEnv\("ASSET_URL_TTL_SECONDS", (\d+)\)/],
            ['AV_SCAN_TIMEOUT_MS', 'src/lib/av-hook.ts', /AV_SCAN_TIMEOUT_MS\) \|\| (\d+)/],
            ['RATE_LIMIT_REDIS_TIMEOUT_MS', 'src/lib/security.ts', /RATE_LIMIT_REDIS_TIMEOUT_MS\) \|\| (\d+)/],
        ];
        for (const [name, file, re] of cases) {
            const fromCode = grab(file, re);
            expect(fromCode, 'no se pudo leer el default de ' + name + ' en ' + file).toBeDefined();
            expect(doc(name), 'default documentado de ' + name).toBe(fromCode);
        }
    });

    it('todos los grupos de variables usados existen y cada grupo tiene variables', () => {
        const groups = new Set(ENV_GROUPS.map((g) => g.id));
        for (const v of ENV_VARS) expect(groups.has(v.group), `grupo desconocido ${v.group}`).toBe(true);
        for (const g of ENV_GROUPS) expect(ENV_VARS.some((v) => v.group === g.id), `grupo vacio ${g.id}`).toBe(true);
    });

    it('los bloques env de las paginas referencian grupos existentes', () => {
        const groups = new Set(ENV_GROUPS.map((g) => g.id));
        for (const p of DOC_PAGES) for (const l of LOCALES) for (const b of DOC_CONTENT[p.slug][l]) {
            if (b.t === 'env' && b.group) expect(groups.has(b.group), `${p.slug}: grupo ${b.group}`).toBe(true);
        }
    });
});

describe('buscador', () => {
    it('indexa todas las paginas en ambos idiomas', () => {
        for (const l of LOCALES) {
            const idx = buildIndex(l);
            for (const p of DOC_PAGES) expect(idx.some((e) => e.href.startsWith(docHref(p.slug))), `${p.slug}/${l} sin indexar`).toBe(true);
        }
    });

    it('encuentra variables y terminos, sin acentos y sin distinguir mayusculas', () => {
        expect(search('es', 'CRON_SECRET').length).toBeGreaterThan(0);
        expect(search('es', 'cifrado en reposo').length).toBeGreaterThan(0);
        expect(search('en', 'signing protocol').some((r) => r.href.startsWith('/docs/api-backend'))).toBe(true);
        expect(search('es', 'busqueda operadores').length).toBeGreaterThan(0);
        expect(search('es', 'x')).toEqual([]);
        expect(search('es', 'zzzzqqqqxx')).toEqual([]);
    });
});

describe('accesibilidad y temas de las paginas de docs', () => {
    const files = walk(DOCS_DIR, ['.tsx'], (p) => p.split(path.sep).join('/').includes('/__tests__/'));
    const RAW_PALETTE = /\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|decoration|shadow|accent|caret)-(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d+)?\b/;

    it('las paginas y componentes de /docs no usan clases de paleta cruda', () => {
        expect(files.length).toBeGreaterThan(5);
        for (const f of files) {
            const src = fs.readFileSync(f, 'utf8');
            const m = RAW_PALETTE.exec(src);
            expect(m, `${path.relative(FRONTEND, f)} usa "${m?.[0]}"`).toBeNull();
        }
    });

    it('no hay colores hexadecimales en el JSX de /docs', () => {
        for (const f of files) {
            const src = fs.readFileSync(f, 'utf8');
            expect(/['"`]#[0-9a-fA-F]{3,8}['"`]/.test(src), `${path.relative(FRONTEND, f)} contiene un hex`).toBe(false);
        }
    });
});

describe('visibilidad de la documentacion (landing.docs)', () => {
    it('sin configuracion se conserva el comportamiento historico', () => {
        expect(resolveDocsVisibility({})).toEqual({ visible: true, landingLink: true, footer: false, sidebar: true });
    });

    it('docs.visible=false oculta todo y showInFooter es opt-in', () => {
        expect(resolveDocsVisibility({ docs: { visible: false, showInFooter: true } })).toEqual({ visible: false, landingLink: false, footer: false, sidebar: false });
        expect(resolveDocsVisibility({ docs: { showInFooter: true, landingLink: false } })).toMatchObject({ visible: true, landingLink: false, footer: true });
    });

    it('el layout de /docs sigue respetando DocsHidden y useLandingConfig', () => {
        const layout = fs.readFileSync(path.join(DOCS_DIR, 'layout.tsx'), 'utf8');
        expect(layout).toMatch(/useLandingConfig/);
        expect(layout).toMatch(/DocsHidden/);
        expect(layout).toMatch(/!docs\.visible/);
    });
});
