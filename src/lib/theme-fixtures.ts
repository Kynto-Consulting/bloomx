/**
 * Configuraciones de empresa de PRUEBA (variadas a proposito, incluidos casos hostiles para el contraste).
 * Las usan los tests de vitest y scripts/check-theme-contrast.ts. No se importa desde codigo de produccion.
 */
import type { DomainThemeConfig } from './theme-config';

export const BRAND_FIXTURES: Record<string, DomainThemeConfig> = {
    'oscura corporativa': {
        backgroundColor: '#0b1220', textColor: '#e6edf3', primaryColor: '#3b82f6', accentColor: '#22d3ee',
        cardColor: '#111a2e', borderColor: '#1f2a44',
    },
    'pastel': {
        primaryColor: '#f4a6c0', accentColor: '#b8c0ff', backgroundColor: '#fdf6f9', textColor: '#5a4a52', mutedColor: '#f7e9ef',
    },
    'saturada (texto malo)': {
        primaryColor: '#ff0055', accentColor: '#00e5ff', backgroundColor: '#ffffff', textColor: '#ff2a6d',
    },
    'monocroma': {
        primaryColor: '#444444', accentColor: '#888888', backgroundColor: '#fafafa', textColor: '#222222', borderColor: '#dddddd',
    },
    'marca casi blanca': {
        backgroundColor: '#fffffe', primaryColor: '#fefefe', accentColor: '#fdfdfd', textColor: '#fefefe',
    },
    'marca casi negra': {
        backgroundColor: '#050505', primaryColor: '#0a0a0a', accentColor: '#111111', textColor: '#f0f0f0',
    },
    'dorada (.env)': { primaryColor: '#bfa13a' },
    'fondo teal medio': { backgroundColor: '#2a9d8f', primaryColor: '#264653', accentColor: '#e9c46a' },
    'palette completa mixta (con tokens malos)': {
        palette: {
            light: {
                background: '#faf7f2', foreground: '#2b2118', primary: '#b45309', 'brand-accent': '#0f766e',
                sidebar: '#efe7da', header: '#b45309', 'row-hover': '#f0e8dc', link: '#c2410c',
                'muted-foreground': '#cfc3b5', overlay: '#1a100880',
            },
            dark: {
                background: '#1a1410', primary: '#f59e0b', 'muted-foreground': '#6b5d50', sidebar: '#120e0b',
                chip: '#5a3a10',
            },
        },
        radius: 'lg', fontFamily: 'humanist', defaultMode: 'dark',
    },
    'amarilla': { primaryColor: '#ffee00', accentColor: '#ffff99', backgroundColor: '#fffde7' },
    'defaults del panel admin': {
        primaryColor: '#000000', secondaryColor: '#ffffff', backgroundColor: '#f9fafb', textColor: '#111827',
        accentColor: '#4f46e5', mutedColor: '#f3f4f6', borderColor: '#e5e7eb', cardColor: '#ffffff',
    },
    'solo palette.dark': { palette: { dark: { background: '#0d1117', primary: '#58a6ff' } } },
    'fondo gris medio': { backgroundColor: '#7f7f7f', primaryColor: '#ff7700' },
};
