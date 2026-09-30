/** Detectores compartidos por la guardia de colores crudos y los tests de ui/*. */
const PALETTES = 'gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const PREFIXES = 'bg|text|border|border-[trblxy]|ring|ring-offset|divide|from|to|via|fill|stroke|outline|placeholder|accent|caret|shadow|decoration';
/** bg-gray-100, text-blue-600/50, bg-white, text-black, bg-black/50, con o sin variantes (hover:, dark:...). */
export const RAW_CLASS = new RegExp(String.raw`(?<![\w-])(?:${PREFIXES})-(?:(?:${PALETTES})-\d{2,3}|white|black)(?![\w-])`, 'g');
/** #rgb, #rrggbb, #rrggbbaa, rgb(...), rgba(...), hsl(...), hsla(...) */
export const RAW_LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\b(?:rgba?|hsla?)\(/g;
