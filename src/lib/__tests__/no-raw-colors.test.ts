/**
 * GUARDIA DE REGRESION: ninguna UI puede usar colores fijos.
 *
 * Toda la app se adapta a la paleta de cada empresa (reports/theme-contract.md), asi que los componentes solo
 * pueden usar tokens semanticos (bg-background, text-muted-foreground, bg-overlay, ...). Este test escanea src/**
 * y falla ante:
 *   1. clases de paleta cruda de Tailwind (bg-gray-100, text-blue-600, border-red-200, bg-white, text-black, bg-black/50...),
 *   2. colores literales (#hex, rgb(), rgba(), hsl(), hsla()) en componentes y paginas (.tsx/.css de UI).
 *
 * Como anadir una excepcion: ALLOWLIST (por fichero, con motivo) o, para una sola linea, el comentario
 * `theme-lint-ignore: <motivo>` en esa linea o en la anterior. Las excepciones legitimas son colores de USUARIO,
 * logos de marca de terceros, el registro de temas y HTML/CSS que no se renderiza con los tokens de la app.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RAW_CLASS, RAW_LITERAL } from './helpers/raw-colors';

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');

/**
 * RUTAS AUN NO MIGRADAS (relativas a la raiz del repo, con /). Pertenecen a otros frentes de trabajo en curso
 * (editor de paleta del admin, app de correo, documentacion). Se excluyen SOLO mientras no terminen:
 * quien migre una ruta DEBE quitarla de esta lista en el mismo cambio. El objetivo es que quede vacia.
 * Un prefijo que termina en "/" cubre todo el directorio; sin "/" final es un fichero exacto.
 */
export const PENDING_DIRS: readonly string[] = [];

/** Excepciones justificadas por fichero (prefijo si termina en "/"). */
export const ALLOWLIST: ReadonlyArray<{ path: string; reason: string }> = [
    { path: 'src/components/Editor.tsx', reason: 'Paleta de colores de texto que el USUARIO elige para su contenido (datos, no estilo de la app).' },
    { path: 'src/components/admin/LandingEditor.tsx', reason: 'Valor inicial de <input type="color"> y degradado de ejemplo que se ofrece al activar la opcion (datos de configuracion).' },
    { path: 'src/components/admin/theme-editor/AdvancedTab.tsx', reason: 'Placeholder de ejemplo de un JSON de tema (texto, no estilo).' },
    { path: 'src/components/admin/theme-editor/ColorField.tsx', reason: 'Respaldo del parser cuando el valor no es hex valido (dato, no estilo).' },
    { path: 'src/components/settings/LabelsSettings.tsx', reason: 'Color por defecto de una etiqueta nueva: color de USUARIO.' },
    { path: 'src/components/MailView.tsx', reason: 'Estilo de la cita en el HTML SALIENTE del correo (el destinatario no tiene nuestros tokens).' },
    { path: 'src/lib/themes.ts', reason: 'Registro de temas: es la fuente de los valores hex y del remapeo de la paleta cruda heredada.' },
    { path: 'src/lib/theme-config.ts', reason: 'Validacion de colores de empresa (regex hex).' },
    { path: 'src/lib/brand-theme.ts', reason: 'Motor de paleta: opera con hex.' },
    { path: 'src/lib/color.ts', reason: 'Utilidades de color: parsean y producen hex.' },
    { path: 'src/lib/theme-fixtures.ts', reason: 'Fixtures de paletas de empresa de prueba.' },
    { path: 'src/lib/manifest-colors.ts', reason: 'Respaldo del manifest PWA (theme_color/background_color exigen un color literal).' },
    { path: 'src/lib/agenda-color.ts', reason: 'Colores de USUARIO (agenda): respaldo por defecto y negro/blanco para calcular contraste.' },
    { path: 'src/lib/mail-theme.ts', reason: 'Colores para el iframe del correo (contenido ajeno, no usa los tokens de la app).' },
    { path: 'src/lib/landing-surface.ts', reason: 'Valida/sanea colores de la landing configurada por el admin.' },
    { path: 'src/lib/calendar/', reason: 'Colores por defecto de calendarios y HTML de correos de invitacion (clientes de correo sin variables CSS).' },
    { path: 'src/lib/elixir-send.ts', reason: 'HTML de correo saliente (sin variables CSS).' },
    { path: 'src/lib/paste-utils.ts', reason: 'Normaliza colores del HTML pegado (contenido de usuario).' },
    { path: 'src/lib/organizer/', reason: 'Esquemas de validacion de colores de usuario (etiquetas/calendarios).' },
    { path: 'src/lib/db/schema.ts', reason: 'Valores por defecto de colores de usuario en la BD.' },
    { path: 'src/lib/sealed/', reason: 'HTML del visor seguro: documento aislado.' },
    { path: 'src/lib/i18n/messages/', reason: 'Textos de ayuda que mencionan ejemplos de color (#RRGGBB).' },
    { path: 'src/app/api/', reason: 'Rutas de servidor: colores de usuario y HTML de correos.' },
    { path: 'src/components/ReAuthBanner.tsx', reason: 'Logos de marca de terceros (Google, Slack, Zoom): colores de marca fijos por norma del proveedor.' },
    { path: 'src/app/globals.css', reason: 'Valores de respaldo de @theme (= tema light); check:themes verifica que no se desincronicen.' },
    { path: 'src/app/elixir/page.tsx', reason: 'Plantilla de EJEMPLO de correo saliente (HTML de contenido para clientes de correo, no UI).' },
    { path: 'src/components/MfaPanels.tsx', reason: 'Codigo QR: debe ser negro sobre blanco para escanearse.' },
    { path: 'src/contexts/ExpansionUIContext.tsx', reason: 'Colores de usuario/manifest de extensiones.' },
    { path: 'src/hooks/useDomainConfig.ts', reason: 'Tipos/ejemplos de configuracion de empresa.' },
];

const SKIP_DIRS = new Set(['node_modules', '__tests__', '__mocks__', 'fixtures', '.next']);
const EXTS = new Set(['.ts', '.tsx', '.css']);

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
        } else if (EXTS.has(path.extname(entry.name)) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
            out.push(path.join(dir, entry.name));
        }
    }
    return out;
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const matchesEntry = (file: string, entry: string) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry);
const isExempt = (file: string) =>
    PENDING_DIRS.some((e) => matchesEntry(file, e)) || ALLOWLIST.some((e) => matchesEntry(file, e.path));

/** Los literales solo se vigilan en codigo de UI; lib/ es dato y motor de color. */
const isUiFile = (file: string) =>
    /^src\/(app|components|contexts|hooks)\//.test(file) && (file.endsWith('.tsx') || file.endsWith('.css'));

export interface Violation { file: string; line: number; kind: 'class' | 'literal'; match: string }

export function scanSource(file: string, source: string, checkLiterals: boolean): Violation[] {
    const violations: Violation[] = [];
    const lines = source.split(/\r?\n/);
    let inBlockComment = false;
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        let line = raw;
        // Comentarios: no cuentan (documentan lo que se migro).
        if (inBlockComment) {
            const end = line.indexOf('*/');
            if (end === -1) continue;
            line = line.slice(end + 2);
            inBlockComment = false;
        }
        line = line.replace(/\/\*.*?\*\//g, '');
        const start = line.indexOf('/*');
        if (start !== -1) { line = line.slice(0, start); inBlockComment = true; }
        line = line.replace(/(^|[^:])\/\/.*$/, '$1');
        if (/theme-lint-ignore/.test(raw) || (i > 0 && /theme-lint-ignore/.test(lines[i - 1]))) continue;
        if (/^\s*import\s/.test(line)) continue;
        for (const m of line.matchAll(RAW_CLASS)) violations.push({ file, line: i + 1, kind: 'class', match: m[0] });
        if (checkLiterals) for (const m of line.matchAll(RAW_LITERAL)) violations.push({ file, line: i + 1, kind: 'literal', match: m[0] });
    }
    return violations;
}

describe('guardia de colores crudos', () => {
    const files = walk(SRC).map((f) => ({ abs: f, rel: rel(f) }));

    it('encuentra codigo que escanear', () => {
        expect(files.length).toBeGreaterThan(100);
    });

    it('las rutas de PENDING_DIRS y ALLOWLIST existen (sin entradas huerfanas)', () => {
        const all = files.map((f) => f.rel);
        for (const e of [...PENDING_DIRS, ...ALLOWLIST.map((a) => a.path)]) {
            expect(all.some((f) => matchesEntry(f, e)), `ruta inexistente en la lista: ${e}`).toBe(true);
        }
        for (const a of ALLOWLIST) expect(a.reason.length, `motivo vacio: ${a.path}`).toBeGreaterThan(10);
    });

    it('ninguna clase de paleta cruda ni color literal fuera de la allowlist', () => {
        const found: Violation[] = [];
        for (const f of files) {
            if (isExempt(f.rel)) continue;
            found.push(...scanSource(f.rel, fs.readFileSync(f.abs, 'utf8'), isUiFile(f.rel)));
        }
        const report = found.map((v) => `${v.file}:${v.line} [${v.kind}] ${v.match}`);
        expect(report, `Usa tokens semanticos (ver reports/theme-contract.md seccion 6):\n${report.join('\n')}`).toEqual([]);
    });

    it('el detector reconoce lo que debe (autotest)', () => {
        const bad = scanSource('x.tsx', [
            '<div className="bg-gray-100 hover:bg-blue-600/50 text-white border-red-200 ring-black" />',
            '<div style={{ color: "#fff" }} />',
            'const a = "rgba(0,0,0,.5)";',
        ].join('\n'), true);
        expect(bad.map((v) => v.match)).toEqual(['bg-gray-100', 'bg-blue-600', 'text-white', 'border-red-200', 'ring-black', '#fff', 'rgba(']);
        const ok = scanSource('x.tsx', [
            '<div className="bg-background text-muted-foreground border-border bg-overlay bg-primary/10 ring-ring" />',
            '// bg-white en un comentario',
            '/* text-black */ const b = 1;',
            '<div className="text-foreground" /> // theme-lint-ignore: motivo',
            '// theme-lint-ignore: color de usuario',
            'const c = "#00897B";',
            '<a href="#main-content">skip</a>',
        ].join('\n'), true);
        expect(ok).toEqual([]);
    });
});
