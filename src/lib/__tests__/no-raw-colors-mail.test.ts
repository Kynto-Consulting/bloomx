/**
 * Guardia de la app de correo: los archivos de la bandeja/lectura/composer/ajustes no pueden usar
 * clases de paleta cruda de Tailwind ni colores hex/rgb/hsl fuera de la allowlist justificada.
 * Todo color de UI sale de tokens semanticos (bg-card, text-muted-foreground, bg-unread...).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

function walk(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
        return /\.tsx?$/.test(e.name) ? [p] : [];
    });
}

const MAIL_FILES = [
    ...['Sidebar', 'EmailList', 'MailView', 'ComposeModal', 'ComposeWindows', 'Editor', 'SettingsModal', 'ReAuthBanner', 'RealTimeListener', 'PwaManager', 'VirtualMailRows', 'MfaPanels', 'SlashMenu']
        .map((n) => path.join(SRC, 'components', `${n}.tsx`)),
    path.join(SRC, 'components/ui/SafeIframe.tsx'),
    path.join(SRC, 'app/page.tsx'),
    ...walk(path.join(SRC, 'components/settings')),
    ...walk(path.join(SRC, 'components/mail')),
    ...walk(path.join(SRC, 'app/security')),
];

const SHADES = 'gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
// Cualquier utilidad de Tailwind con color crudo: bg-blue-500, border-l-blue-500, hover:text-gray-700, ring-offset-white, from-pink-500/50...
const RAW_CLASS = new RegExp(`(?<![\\w])(?:[a-z0-9]+:)*(?:[a-z]+-)+(?:(?:(?<!font-)(?:white|black))(?![\\w-])|(?:${SHADES})-\\d{2,3}(?![\\w]))`, 'g');
const RAW_COLOR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])|\brgba?\(|\bhsla?\(/g;

/**
 * Allowlist justificada: archivo -> patrones (subcadena de la linea) permitidos.
 *  - Logos de marca de terceros (Google, Zoom, Slack): colores oficiales, no son tema.
 *  - Colores de USUARIO: paleta de texto del editor y color por defecto de etiquetas.
 *  - QR: fondo/primer plano fijos (un QR con colores de tema puede no escanearse).
 *  - HTML SALIENTE: la cita que se envia al destinatario lleva su propio estilo inline (no es UI).
 */
const ALLOW: Record<string, string[]> = {
    'components/ReAuthBanner.tsx': ['<path fill="#', 'fill="#2D8CFF"'],
    'components/Editor.tsx': ["'#"],
    'components/settings/LabelsSettings.tsx': ["'#6366f1'"],
    'components/MfaPanels.tsx': ["dark: '#000000'", 'bg-white p-1'],
    'components/MailView.tsx': ['border-left:1px #999 solid'],
};

function offenders(): string[] {
    const out: string[] = [];
    for (const file of MAIL_FILES) {
        if (!fs.existsSync(file)) continue;
        const rel = path.relative(SRC, file).replace(/\\/g, '/');
        const allow = ALLOW[rel] ?? [];
        fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
            if (allow.some((a) => line.includes(a))) return;
            const hits = [...(line.match(RAW_CLASS) ?? []), ...(line.match(RAW_COLOR) ?? [])];
            hits.forEach((h) => out.push(`${rel}:${i + 1} ${h}`));
        });
    }
    return out;
}

describe('app de correo: sin colores fijos', () => {
    it('cubre los archivos esperados', () => {
        expect(MAIL_FILES.filter((f) => fs.existsSync(f)).length).toBeGreaterThanOrEqual(18);
    });
    it('no hay clases de paleta cruda ni hex/rgb/hsl fuera de la allowlist', () => {
        expect(offenders()).toEqual([]);
    });
    it('el detector detecta lo que debe', () => {
        expect('bg-white text-gray-500 border-slate-200/50 hover:bg-blue-600 from-pink-500 border-l-blue-500 dark:text-emerald-400'.match(RAW_CLASS)?.length).toBe(7);
        expect('bg-card text-muted-foreground bg-unread border-sidebar-border font-black text-row-selected-foreground'.match(RAW_CLASS)).toBeNull();
        expect('color: #fff; fill="#4285F4"; rgba(0,0,0,.5)'.match(RAW_COLOR)?.length).toBe(3);
    });
    it('cada entrada de la allowlist sigue haciendo falta', () => {
        for (const [rel, pats] of Object.entries(ALLOW)) {
            const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
            for (const p of pats) expect(text.includes(p), `${rel} ya no contiene ${p}`).toBe(true);
        }
    });
});
