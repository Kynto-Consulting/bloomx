import type { Config } from "tailwindcss";

/**
 * NOTA: el proyecto usa Tailwind v4 (configuracion CSS-first). Este archivo NO se carga
 * (globals.css no declara @config) y se conserva solo por compatibilidad de herramientas.
 *
 * Donde vive cada cosa del sistema de temas:
 *   - Colores / paletas ........ src/lib/themes.ts   (registro unico, fuente de verdad)
 *   - Tokens -> utilidades ..... src/app/globals.css (@theme, respaldo = tema "light")
 *   - Variante dark: ........... src/app/globals.css (@custom-variant dark, via [data-scheme])
 *   - Aplicacion sin FOUC ...... src/app/layout.tsx  (<style> generado + script bloqueante)
 *   - Estado / persistencia .... src/components/ThemeProvider.tsx
 *   - Selector ................. src/components/settings/AppearanceSettings.tsx
 *   - Verificacion de AA ....... npm run check:themes
 */
const config: Config = {
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {},
    },
    plugins: [
        require("tailwindcss-animate"),
    ],
};

export default config;
