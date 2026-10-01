import { CmdError, type CmdContext, type CommandDef } from '../types';
import { INPUT_HINT, bool, data, def, done, kv, L, list, multi, oneOf, parseInputJson, pos, str, table, text } from './_h';
import { validateThemeConfig, type DomainThemeConfig } from '@/lib/theme-config';
import { LANDING_LAYOUTS, sanitizeLandingConfig, sanitizeLandingConfigDetailed } from '@/lib/landing-config';
import { THEMES } from '@/lib/themes';

/**
 * Dominio, marca, tema y landing. Misma ruta que el editor de la consola (GET/PUT /api/admin/domain, que reemplaza el tema
 * completo): aqui siempre se lee el estado actual, se cambia SOLO lo pedido y se guarda el objeto completo.
 */

const landingSanitizer = (input: unknown) => sanitizeLandingConfig(input) as Record<string, unknown>;
const MODES = ['light', 'dark', 'system'] as const;

interface DomainDoc { displayName: string; logo: string; theme: DomainThemeConfig; name: string }

async function loadDomain(ctx: CmdContext): Promise<DomainDoc> {
    const d = (await ctx.callOk({ method: 'GET', path: '/domain' })).data ?? {};
    const theme = validateThemeConfig(d.theme, { sanitizeLanding: landingSanitizer }).config;
    return { displayName: typeof d.displayName === 'string' && d.displayName ? d.displayName : typeof d.name === 'string' ? d.name : '', logo: typeof d.logo === 'string' ? d.logo : '', theme, name: typeof d.name === 'string' ? d.name : '' };
}

/** Guarda el documento completo tras sanearlo (misma validacion que el editor). Devuelve los avisos. */
async function saveDomain(ctx: CmdContext, doc: { displayName: string; logo: string; theme: unknown }): Promise<{ issues: { path: string; code: string }[] }> {
    const { config, issues } = validateThemeConfig(doc.theme, { sanitizeLanding: landingSanitizer });
    if (issues.some((i) => i.code === 'too_large' || i.code === 'not_object')) throw new CmdError('invalid_theme', ctx.t(L('El tema no es válido o es demasiado grande.', 'The theme is invalid or too large.')), 2);
    if (doc.displayName.length > 120) throw new CmdError('invalid_input', 'displayName too long (max 120)', 2);
    if (doc.logo && !/^https:\/\/\S+$/i.test(doc.logo)) throw new CmdError('invalid_input', 'logo must be an https:// URL', 2);
    await ctx.callOk({ method: 'PUT', path: '/domain', body: { displayName: doc.displayName, logo: doc.logo, theme: config } });
    return { issues };
}

const issuesTable = (issues: { path: string; code: string }[]) => (issues.length ? table(['path', 'code'], issues.map((i) => ({ path: i.path || '(root)', code: i.code })), { caption: 'warnings' }) : text('no warnings', 'success'));

export const brandCommands: CommandDef[] = [
    def({
        name: 'domain show', risk: 'read', summary: L('Dominio de la instancia y su marca pública', 'Instance domain and public brand'),
        covers: ['GET /api/admin/domain'],
        handler: async ({ ctx }) => {
            const d = await loadDomain(ctx);
            return kv([['domain', d.name], ['displayName', d.displayName], ['logo', d.logo || '-'], ['themeKeys', Object.keys(d.theme).join(', ') || '-']]);
        },
    }),
    def({
        name: 'domain set', risk: 'write', summary: L('Cambia el nombre público y/o el logo (https) del dominio', 'Change the public name and/or logo (https) of the domain'),
        flags: [str('display-name', 'Nombre público (máx. 120)', 'Public name (max 120)'), str('logo', 'URL https del logo ("" para quitar)', 'Logo https URL ("" to remove)')], covers: ['PUT /api/admin/domain'],
        handler: async ({ args, ctx }) => {
            const d = await loadDomain(ctx);
            if (args.flags['display-name'] === undefined && args.flags.logo === undefined) throw new CmdError('nothing_to_change', 'Pass --display-name and/or --logo', 2);
            await saveDomain(ctx, { displayName: (args.flags['display-name'] as string | undefined) ?? d.displayName, logo: (args.flags.logo as string | undefined) ?? d.logo, theme: d.theme });
            return done(ctx, 'Dominio actualizado.', 'Domain updated.');
        },
    }),

    def({
        name: 'theme list', risk: 'read', summary: L('Temas integrados disponibles', 'Built-in themes available'),
        handler: async () => table(['id', 'label', 'scheme', 'brandable'], THEMES.map((t) => ({ id: t.id, label: t.label, scheme: t.scheme, brandable: t.brandable }))),
    }),
    def({
        name: 'theme show', risk: 'read', summary: L('Tema actual del dominio (política, tipografía, colores de marca)', 'Current domain theme (policy, typography, brand colours)'),
        handler: async ({ ctx }) => {
            const { theme } = await loadDomain(ctx);
            const { landing: _l, palette, ...rest } = theme as Record<string, unknown>;
            return multi(kv(Object.entries(rest).map(([k, v]) => [k, Array.isArray(v) ? (v as string[]) : (v as string | number | boolean)] as [string, any]), 'theme'), kv([['paletteLight', Object.keys((palette as any)?.light ?? {}).length], ['paletteDark', Object.keys((palette as any)?.dark ?? {}).length], ['landing', _l ? 'configured' : '-']], 'palette'));
        },
    }),
    def({
        name: 'theme export', risk: 'read', summary: L('Exporta el tema (y la marca) como JSON', 'Export the theme (and brand) as JSON'),
        handler: async ({ ctx }) => { const d = await loadDomain(ctx); return data({ displayName: d.displayName, logo: d.logo, theme: d.theme }); },
    }),
    def({
        name: 'theme validate', risk: 'read', summary: L('Valida un JSON de tema sin guardar (por --stdin / --file)', 'Validate a theme JSON without saving (via --stdin / --file)'),
        acceptsInput: true,
        handler: async ({ ctx }) => {
            let input = parseInputJson(ctx, INPUT_HINT) as Record<string, unknown>;
            if (input && typeof input === 'object' && 'theme' in input && !('palette' in input)) input = input.theme as Record<string, unknown>;
            const { config, issues } = validateThemeConfig(input, { sanitizeLanding: landingSanitizer });
            return multi(kv([['valid', !issues.some((i) => i.code === 'too_large' || i.code === 'not_object')], ['keys', Object.keys(config).join(', ')]]), issuesTable(issues));
        },
    }),
    def({
        name: 'theme import', risk: 'write', summary: L('Importa un tema JSON y REEMPLAZA el actual (por --stdin / --file)', 'Import a theme JSON and REPLACE the current one (via --stdin / --file)'),
        acceptsInput: true, flags: [bool('dry-run', 'Solo validar', 'Validate only')], covers: ['PUT /api/admin/domain'],
        handler: async ({ args, ctx }) => {
            const raw = parseInputJson(ctx, INPUT_HINT) as Record<string, unknown>;
            const d = await loadDomain(ctx);
            const hasWrapper = raw && typeof raw === 'object' && ('theme' in raw) && !('palette' in raw);
            const theme = hasWrapper ? (raw.theme as unknown) : raw;
            const { config, issues } = validateThemeConfig(theme, { sanitizeLanding: landingSanitizer });
            if (args.flags['dry-run']) return multi(text(ctx.t(L('Simulacro: nada se guardó.', 'Dry run: nothing was saved.')), 'info'), issuesTable(issues));
            const r = await saveDomain(ctx, {
                displayName: hasWrapper && typeof raw.displayName === 'string' ? raw.displayName : d.displayName,
                logo: hasWrapper && typeof raw.logo === 'string' ? raw.logo : d.logo, theme: config,
            });
            return multi(done(ctx, 'Tema importado.', 'Theme imported.'), issuesTable(r.issues));
        },
    }),
    def({
        name: 'theme apply', risk: 'write', summary: L('Aplica colores de marca (hex) manteniendo el resto del tema', 'Apply brand colours (hex) keeping the rest of the theme'),
        flags: [str('primary', 'Color primario #rrggbb', 'Primary colour #rrggbb'), str('secondary', 'Secundario', 'Secondary'), str('accent', 'Acento', 'Accent'), str('background', 'Fondo', 'Background'), str('text', 'Texto', 'Text')],
        covers: [],
        handler: async ({ args, ctx }) => {
            const f = args.flags;
            const map: Record<string, string> = { primary: 'primaryColor', secondary: 'secondaryColor', accent: 'accentColor', background: 'backgroundColor', text: 'textColor' };
            const d = await loadDomain(ctx);
            const theme: Record<string, unknown> = { ...d.theme };
            let n = 0;
            for (const [flag, key] of Object.entries(map)) if (f[flag] !== undefined) { theme[key] = f[flag]; n++; }
            if (!n) throw new CmdError('nothing_to_change', 'Pass --primary, --secondary, --accent, --background or --text', 2);
            const r = await saveDomain(ctx, { ...d, theme });
            return multi(done(ctx, 'Colores aplicados.', 'Colours applied.'), issuesTable(r.issues));
        },
    }),
    def({
        name: 'theme policy', risk: 'write', summary: L('Política de temas: modo por defecto, bloqueo a la marca y temas permitidos', 'Theme policy: default mode, brand lock and allowed themes'),
        flags: [oneOf('default-mode', MODES, 'Modo inicial', 'Default mode'), bool('lock-brand', 'Solo temas de la empresa', 'Company themes only'), bool('auto-fix-contrast', 'Corregir contraste AA automáticamente', 'Auto-fix AA contrast'),
            list('allowed', 'Ids de temas permitidos (coma); vacío = todos', 'Allowed theme ids (comma); empty = all'), oneOf('radius', ['none', 'sm', 'md', 'lg', 'xl'], 'Radio', 'Radius'), str('font', 'Familia tipográfica (id)', 'Font family id')],
        covers: [],
        handler: async ({ args, ctx }) => {
            const f = args.flags;
            const d = await loadDomain(ctx);
            const theme: Record<string, unknown> = { ...d.theme };
            let n = 0;
            const set = (k: string, v: unknown) => { theme[k] = v; n++; };
            if (f['default-mode'] !== undefined) set('defaultMode', f['default-mode']);
            if (f['lock-brand'] !== undefined) set('lockBrand', f['lock-brand']);
            if (f['auto-fix-contrast'] !== undefined) set('autoFixContrast', f['auto-fix-contrast']);
            if (f.allowed !== undefined) set('allowedThemes', f.allowed);
            if (f.radius !== undefined) set('radius', f.radius);
            if (f.font !== undefined) set('fontFamily', f.font);
            if (!n) {
                return kv([['defaultMode', (d.theme.defaultMode as string) ?? 'system'], ['lockBrand', d.theme.lockBrand === true], ['autoFixContrast', d.theme.autoFixContrast !== false], ['allowedThemes', (d.theme.allowedThemes as string[] | undefined) ?? 'all'], ['radius', String(d.theme.radius ?? 'md')], ['fontFamily', d.theme.fontFamily ?? '-']]);
            }
            const r = await saveDomain(ctx, { ...d, theme });
            return multi(done(ctx, 'Política actualizada.', 'Policy updated.'), issuesTable(r.issues));
        },
    }),

    def({
        name: 'landing show', risk: 'read', summary: L('Resumen de la landing / login configurada', 'Summary of the configured landing / login page'),
        handler: async ({ ctx }) => {
            const l = (await loadDomain(ctx)).theme.landing as Record<string, any> | undefined;
            if (!l || !Object.keys(l).length) return text(ctx.t(L('Sin landing personalizada.', 'No custom landing.')), 'muted');
            return kv([['layout', l.layout ?? '-'], ['hero.title', l.hero?.title ?? '-'], ['features', l.features?.length ?? 0], ['testimonials', l.testimonials?.items?.length ?? 0], ['registration', l.registration?.enabled ?? '-'], ['sections', Object.keys(l).join(', ')]]);
        },
    }),
    def({
        name: 'landing export', risk: 'read', summary: L('Exporta la landing como JSON', 'Export the landing as JSON'),
        handler: async ({ ctx }) => data((await loadDomain(ctx)).theme.landing ?? {}),
    }),
    def({
        name: 'landing validate', risk: 'read', summary: L('Valida un JSON de landing sin guardar (por --stdin / --file)', 'Validate a landing JSON without saving (via --stdin / --file)'),
        acceptsInput: true,
        handler: async ({ ctx }) => {
            const r = sanitizeLandingConfigDetailed(parseInputJson(ctx, INPUT_HINT));
            return multi(kv([['keys', Object.keys(r.config).join(', ')], ['bytes', r.bytes]]), issuesTable(r.issues));
        },
    }),
    def({
        name: 'landing import', risk: 'write', summary: L('Importa una landing JSON y REEMPLAZA la actual (por --stdin / --file)', 'Import a landing JSON and REPLACE the current one (via --stdin / --file)'),
        acceptsInput: true, flags: [bool('dry-run', 'Solo validar', 'Validate only')], covers: [],
        handler: async ({ args, ctx }) => {
            const r = sanitizeLandingConfigDetailed(parseInputJson(ctx, INPUT_HINT));
            if (args.flags['dry-run']) return multi(text(ctx.t(L('Simulacro: nada se guardó.', 'Dry run: nothing was saved.')), 'info'), issuesTable(r.issues));
            const d = await loadDomain(ctx);
            const s = await saveDomain(ctx, { ...d, theme: { ...d.theme, landing: r.config as Record<string, unknown> } });
            return multi(done(ctx, 'Landing importada.', 'Landing imported.'), issuesTable([...r.issues, ...s.issues]));
        },
    }),
    def({
        name: 'landing set', risk: 'write', summary: L('Cambia el diseño de la landing', 'Change the landing layout'),
        flags: [oneOf('layout', LANDING_LAYOUTS, 'Diseño', 'Layout'), str('hero-title', 'Título del hero', 'Hero title'), bool('registration', 'Permitir registro', 'Allow registration')], covers: [],
        handler: async ({ args, ctx }) => {
            const f = args.flags;
            const d = await loadDomain(ctx);
            const landing: Record<string, any> = { ...((d.theme.landing as Record<string, any>) ?? {}) };
            let n = 0;
            if (f.layout !== undefined) { landing.layout = f.layout; n++; }
            if (f['hero-title'] !== undefined) { landing.hero = { ...landing.hero, title: f['hero-title'] }; n++; }
            if (f.registration !== undefined) { landing.registration = { ...landing.registration, enabled: f.registration }; n++; }
            if (!n) throw new CmdError('nothing_to_change', 'Pass --layout, --hero-title or --registration', 2);
            await saveDomain(ctx, { ...d, theme: { ...d.theme, landing } });
            return done(ctx, 'Landing actualizada.', 'Landing updated.');
        },
    }),
    def({
        name: 'landing reset', risk: 'destructive', summary: L('Quita la landing personalizada (vuelve a la de fábrica)', 'Remove the custom landing (back to the default)'),
        covers: [],
        handler: async ({ ctx }) => {
            const d = await loadDomain(ctx);
            const { landing: _drop, ...theme } = d.theme as Record<string, unknown>;
            await saveDomain(ctx, { ...d, theme });
            return done(ctx, 'Landing restablecida.', 'Landing reset.');
        },
    }),
];

void pos;
