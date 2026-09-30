import type { Block, DocPageContent } from '../types';

const exMinimal = `{
  "primaryColor": "#0b5fff",
  "accentColor": "#f59e0b"
}`;

const exFull = `{
  "defaultMode": "system",
  "radius": "lg",
  "fontFamily": "humanist",
  "allowedThemes": ["midnight", "contrast"],
  "lockBrand": false,
  "autoFixContrast": true,
  "palette": {
    "light": {
      "background": "#fafaf7",
      "foreground": "#1c1b18",
      "primary": "#0b5fff",
      "primary-foreground": "#ffffff",
      "brand-accent": "#b45309",
      "sidebar": "#f1efe8",
      "header": "#ffffff"
    },
    "dark": {
      "background": "#101418",
      "foreground": "#eef1f5",
      "primary": "#6ea8ff",
      "primary-foreground": "#0a0f1a",
      "brand-accent": "#fbbf24",
      "sidebar": "#0b0e12"
    }
  }
}`;

const exLocked = `{
  "lockBrand": true,
  "defaultMode": "light",
  "palette": {
    "light": { "primary": "#7c3aed", "background": "#faf5ff" },
    "dark":  { "primary": "#c4b5fd", "background": "#120a1f" }
  }
}`;

const localEnv = `# .env.local (solo desarrollo; se ignora en producción). Una línea, JSON válido.
NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE={"primaryColor":"#7c3aed","backgroundColor":"#faf5ff","defaultMode":"dark","radius":"lg","fontFamily":"humanist","palette":{"dark":{"background":"#120a1f","sidebar":"#0d0716"}}}`;

const localCmds = `npm run check:themes            # contraste AA de los 8 temas y de los 12 ejemplos de empresa
npm run check:themes -- --md    # tabla en Markdown
npx vitest run src/lib/__tests__/brand-theme.test.ts src/lib/__tests__/theme-config.test.ts src/lib/__tests__/theme-selection.test.ts`;

const putEx = `# Guardar el tema de la empresa (sesión de manager). El cuerpo REEMPLAZA todo el tema, incluida la landing.
curl -sS -X PUT "$BACKEND/api/admin/domain" \\
  -H 'content-type: application/json' -b 'auth_session=<cookie>' \\
  -d '{"theme": { "primaryColor": "#0b5fff", "radius": "lg", "landing": { "layout": "split-right" } } }'`;

const tokenRows = (es: boolean): string[][] => [
    ['`background` / `foreground`', es ? 'Lienzo de la app y texto principal' : 'App canvas and main text'],
    ['`card` / `card-foreground`', es ? 'Superficies elevadas: tarjetas, paneles, modales' : 'Raised surfaces: cards, panels, modals'],
    ['`popover` / `popover-foreground`', es ? 'Menús desplegables, tooltips, selects' : 'Dropdown menus, tooltips, selects'],
    ['`primary` / `primary-foreground`', es ? 'Acción principal y texto de marca (`text-primary` ≥ 4.5:1 sobre fondo y tarjeta)' : 'Main action and brand text (`text-primary` ≥ 4.5:1 on background and card)'],
    ['`secondary` / `secondary-foreground`', es ? 'Botones secundarios' : 'Secondary buttons'],
    ['`muted` / `muted-foreground`', es ? 'Zonas apagadas y texto secundario (AA sobre fondo, tarjeta, muted, popover, sidebar, no leído y filas)' : 'Muted areas and secondary text (AA on background, card, muted, popover, sidebar, unread and rows)'],
    ['`accent` / `accent-foreground`', es ? 'Resaltado neutro de hover/selección' : 'Neutral hover/selection highlight'],
    ['`destructive`, `success`, `warning`, `info` (+ `-foreground`)', es ? 'Estados: relleno y texto (`text-success`), tintes `bg-success/10`' : 'States: fill and text (`text-success`), tints `bg-success/10`'],
    ['`border`', es ? 'Divisores y bordes decorativos' : 'Dividers and decorative borders'],
    ['`input`', es ? 'Borde de controles de formulario (≥ 3:1)' : 'Form control border (≥ 3:1)'],
    ['`ring`', es ? 'Anillo de foco (≥ 3:1)' : 'Focus ring (≥ 3:1)'],
    ['`brand-accent` / `brand-accent-foreground`', es ? 'Segundo color de marca' : 'Second brand colour'],
    ['`sidebar`, `sidebar-foreground`, `sidebar-accent`, `sidebar-accent-foreground`, `sidebar-border`', es ? 'Panel lateral (carpetas, etiquetas), su ítem activo y divisor' : 'Side panel (folders, labels), its active item and divider'],
    ['`header` / `header-foreground`', es ? 'Barra superior' : 'Top bar'],
    ['`unread` / `unread-foreground`', es ? 'Fila de correo no leída' : 'Unread mail row'],
    ['`row-hover`, `row-selected` / `row-selected-foreground`', es ? 'Fila en hover y fila seleccionada' : 'Hovered and selected row'],
    ['`link` / `link-hover`', es ? 'Enlaces en texto' : 'Links in text'],
    ['`code` / `code-foreground`', es ? 'Código en línea y bloques' : 'Inline code and blocks'],
    ['`overlay`', es ? 'Fondo translucido de modales (único token que admite alfa `#rrggbbaa`)' : 'Translucent modal backdrop (the only token accepting alpha `#rrggbbaa`)'],
    ['`chip` / `chip-foreground`', es ? 'Etiquetas y badges suaves' : 'Soft labels and badges'],
    ['`selection` / `selection-foreground`', es ? 'Selección de texto' : 'Text selection'],
    ['`scrollbar`', es ? 'Pulgar de la barra de scroll' : 'Scrollbar thumb'],
];

const es: Block[] = [
    { t: 'p', text: 'Cada empresa (dominio) puede definir **toda su paleta** y toda la aplicación se adapta a ella: modo claro y oscuro, radio de esquinas, tipografía y qué temas genéricos puede elegir el usuario. El motor garantiza contraste **WCAG 2.1 AA** por defecto. El tema se guarda en `Domain.theme` (backend) y se sirve por `GET /api/config`.' },
    { t: 'h2', id: 'model', text: 'Modelo de configuración' },
    { t: 'table', head: ['Campo', 'Tipo', 'Significado'], rows: [
        ['`palette.light` / `palette.dark`', 'objeto `{token: "#rrggbb"}`', 'Cualquiera de los 49 tokens, por modo. **Un valor explícito gana** sobre los campos antiguos y sobre la derivación. Solo `overlay` admite alfa'],
        ['`primaryColor`, `accentColor`, `backgroundColor`, `textColor`, `cardColor`, `mutedColor`, `borderColor`, `secondaryColor`, `inputColor`, `ringColor` y sus `*Foreground`', 'hex `#rgb`/`#rrggbb`', 'Campos **antiguos** (siguen funcionando). Primario y acento valen para ambos modos; los neutros van al modo que corresponda al fondo (claro u oscuro)'],
        ['`defaultMode`', '`light` · `dark` · `system`', 'Modo inicial **solo** cuando el usuario aún no ha elegido tema. `system` sigue `prefers-color-scheme`'],
        ['`radius`', '`none` · `sm` · `md` · `lg` · `xl` (o número de rem 0–3)', 'Escala de esquinas: 0, 0.25, 0.5 (por defecto), 0.75 y 1 rem'],
        ['`fontFamily`', '`inter` · `system` · `humanist` · `geometric` · `rounded` · `serif` · `mono`', 'Familia de la lista blanca (cuerpo y títulos). `titleFont`/`bodyFont` (nombre alfanumérico) la refinan solo si no hay `fontFamily`'],
        ['`allowedThemes`', 'lista de ids', 'Temas **genéricos** elegibles: `light`, `dark`, `midnight`, `amoled`, `ocean`, `forest`, `rose`, `contrast`. Vacío u omitido = todos'],
        ['`lockBrand`', 'booleano', '`true`: el usuario solo ve los temas de la empresa (`brand-light`/`brand-dark`). Solo tiene efecto si hay colores de empresa'],
        ['`autoFixContrast`', 'booleano (por defecto `true`)', '`false`: los tokens explícitos que incumplan AA **no** se corrigen (solo se avisa)'],
        ['`landing`', 'objeto', 'Landing y login: ver [Landing y login](/docs/landing)'],
    ] },
    { t: 'h3', id: 'derive', text: 'Cómo se interpreta' },
    { t: 'ul', items: [
        'Con **algún color** (campo antiguo o `palette`) se generan dos temas completos, `brand-light` y `brand-dark`. Radio, fuente o modo solos **no** crean temas de empresa.',
        'Si defines un solo modo, el otro se **deriva** del fondo del primero (conserva el matiz; luminosidad 8 % en oscuro y 97.5 % en claro).',
        'Un fondo de esquema contrario (oscuro en `palette.light` o claro en `palette.dark`) se **descarta** con aviso: nunca se pinta un lienzo oscuro con tokens claros.',
        'Un muted, borde o secundario casi idéntico al fondo (por ejemplo `#ffffff` sobre `#ffffff`) se descarta y se deriva uno visible (solo con `autoFixContrast` distinto de `false`).',
        'Con `autoFixContrast: true`, un color que no cumple AA se ajusta al más cercano que sí cumple. El editor del panel muestra el color elegido, el aplicado y su ratio.',
        'Las claves desconocidas se descartan al guardar (el backend y el frontend usan el **mismo** saneador, con hex normalizado a `#rrggbb`).',
    ] },
    { t: 'h2', id: 'tokens', text: 'Tokens y su función' },
    { t: 'p', text: 'Hay **49 tokens** (`--color-<token>` y utilidades Tailwind `bg-<token>`, `text-<token>`, `border-<token>`, `ring-<token>`, con opacidad como `bg-primary/10`). Los componentes de BloomX solo usan estos tokens, nunca hex ni paletas crudas.' },
    { t: 'table', head: ['Token', 'Función'], rows: tokenRows(true), caption: 'Tokens semánticos' },
    { t: 'p', text: 'Además del color: `--radius` (todas las clases `rounded-*` derivan de él; `rounded-full` no cambia) y las variables de fuente `--font-body` y `--font-title`.' },
    { t: 'h2', id: 'designers', text: 'Guía para diseñadores' },
    { t: 'ol', items: [
        '**Empieza con 2–3 colores**: `primary` (marca), `brand-accent` (segundo color) y `background`. El motor deriva los otros 40+ tokens y garantiza AA. Define `foreground`, `card`, `muted`, `border` solo si la marca los exige.',
        '**Elige `primary` pensando en dos usos**: relleno de botón (con `primary-foreground` encima) y **texto/enlace sobre el fondo** (`text-primary` debe llegar a 4.5:1 sobre `background` y `card`). Un primario muy claro suele fallar como texto en modo claro; usa uno más oscuro en `palette.light` y uno más claro en `palette.dark`.',
        '**Define el modo oscuro por separado** cuando tengas una versión de marca oscura: los tonos que funcionan sobre blanco casi nunca funcionan sobre `#101418`.',
        '**Fondos oscuros**: evita negros puros (`#000000`) salvo intención AMOLED; un fondo muy oscuro y otro `card` apenas más claro mantienen la jerarquía.',
        '**Estados** (`destructive`, `success`, `warning`, `info`): conservan su matiz semántico y solo se corrige el contraste. No los cambies a menos que la marca lo exija.',
        '**Radio y fuente** cambian la personalidad sin tocar contraste: `radius: "none"` para un estilo corporativo recto, `"xl"` para uno amable; `fontFamily` solo admite la lista blanca (sin fuentes web propias).',
        '**Verifica** con `npm run check:themes` añadiendo tu paleta a `BRAND_FIXTURES` (`src/lib/theme-fixtures.ts`) y con el editor del panel, que avisa en vivo de cada par que incumple.',
    ] },
    { t: 'h3', id: 'aa', text: 'Contraste AA: qué se exige' },
    { t: 'table', head: ['Par', 'Mínimo'], rows: [
        ['Texto (`foreground`, `card-foreground`, `popover-foreground`, `sidebar-foreground`, `header-foreground`…) sobre su superficie', '4.5:1'],
        ['`muted-foreground` sobre background, card, muted, popover, sidebar, no leído y filas hover/seleccionada', '4.5:1'],
        ['`primary`, `destructive`, `success`, `warning`, `info`, `brand-accent`, `link` y `link-hover` como texto sobre background/card', '4.5:1'],
        ['Botones: `primary-foreground` sobre `primary` (y las demás parejas relleno/texto)', '4.5:1'],
        ['`input` (borde de controles) y `ring` (foco) sobre background y card', '3:1'],
        ['`scrollbar` sobre background', '1.5:1'],
    ] },
    { t: 'callout', kind: 'note', text: '`text-muted-foreground` **no** está garantizado sobre `secondary`, `header`, `code`, `chip`, `primary`, imágenes ni degradados. Los avisos de `autoFixContrast: false` solo cubren los pares de la tabla anterior.' },
    { t: 'h2', id: 'examples', text: 'Ejemplos JSON' },
    { t: 'code', lang: 'json', title: 'Mínimo: dos colores (se derivan ambos modos)', code: exMinimal },
    { t: 'code', lang: 'json', title: 'Completo: paleta por modo, radio, fuente y temas permitidos', code: exFull },
    { t: 'code', lang: 'json', title: 'Marca bloqueada: el usuario solo ve los temas de la empresa', code: exLocked },
    { t: 'code', lang: 'bash', title: 'Guardarlo en el backend', code: putEx },
    { t: 'callout', kind: 'warn', title: 'PUT reemplaza el tema completo', text: '`PUT /api/admin/domain` guarda el `theme` **entero** que envíes (incluida `landing`). Envía siempre el objeto completo. Si guardas desde una pantalla del panel que solo conoce los campos de color y fuentes, revisa que no descarte `palette` ni `landing`.' },
    { t: 'h3', id: 'selection', text: 'Qué ve el usuario' },
    { t: 'ul', items: [
        'Con colores de empresa, el selector muestra primero `"<Empresa> · Claro"` y `"<Empresa> · Oscuro"` y luego los genéricos permitidos (`light` y `dark` se ocultan porque los sustituyen, salvo que estén en `allowedThemes`).',
        '`defaultMode` solo aplica si el usuario no ha elegido (sin cookie, `localStorage` ni BD). Una elección explícita, incluido "Sistema", gana siempre.',
        'Una preferencia guardada que ya no es elegible se remapea al tema por defecto de su mismo esquema, sin borrar lo guardado. Con `lockBrand`, todas.',
        'Sin configuración de empresa: los 8 temas genéricos y `system`, como siempre. El tema se inyecta en el servidor (`<style id="bx-brand">`) y hay un script anti-parpadeo.',
    ] },
    { t: 'h2', id: 'local', text: 'Probar en local' },
    { t: 'ol', items: [
        '**Sin backend**: define `NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE` en `.env.local` y reinicia `next dev`. Sustituye el tema de `/api/config` (servidor y cliente) y se ignora en producción. Borra la cookie `bloomx-theme` y `localStorage["bloomx:theme:v1"]` para ver `defaultMode`.',
        '**Contraste**: `npm run check:themes`.',
        '**Tests**: los de tema y selección.',
        '**Avisos por token**: `buildBrandThemes(cfg)?.warnings` (o `analyzeBrandTheme(cfg)`) devuelve, por token, el valor elegido, el aplicado, los ratios y si se corrigió.',
    ] },
    { t: 'code', lang: 'bash', title: 'Override en desarrollo', code: localEnv },
    { t: 'code', lang: 'bash', title: 'Verificación', code: localCmds },
    { t: 'h2', id: 'catalogue', text: 'Temas genéricos' },
    { t: 'p', text: 'Sin configuración de empresa hay 8 temas: `light`, `dark`, `midnight`, `amoled`, `ocean`, `forest`, `rose` y `contrast` (alto contraste), más **Sistema**. La preferencia se guarda en cookie, `localStorage` y en la cuenta. El correo entrante tiene además su propia opción de modo (oscurecer, por defecto, o papel claro; `mailDarkMode`).' },
    { t: 'h2', id: 'limits', text: 'Límites conocidos' },
    { t: 'ul', items: [
        'Solo `overlay` admite alfa; el resto de colores se rechaza si trae alfa distinto de `ff`.',
        'La red de seguridad que remapea las escalas crudas de Tailwind en temas oscuros existe para código antiguo; el código nuevo no debe contar con ella.',
        'Las fuentes son solo las de la lista blanca (sin cargar fuentes propias).',
        'Los colores de agenda, calendarios y etiquetas de usuario los elige cada usuario; el texto encima se calcula por contraste.',
    ] },
];

const en: Block[] = [
    { t: 'p', text: 'Each company (domain) can define **its whole palette** and the entire application adapts: light and dark mode, corner radius, typography and which generic themes the user may pick. The engine guarantees **WCAG 2.1 AA** contrast by default. The theme is stored in `Domain.theme` (backend) and served by `GET /api/config`.' },
    { t: 'h2', id: 'model', text: 'Configuration model' },
    { t: 'table', head: ['Field', 'Type', 'Meaning'], rows: [
        ['`palette.light` / `palette.dark`', 'object `{token: "#rrggbb"}`', 'Any of the 49 tokens, per mode. **An explicit value wins** over legacy fields and over derivation. Only `overlay` accepts alpha'],
        ['`primaryColor`, `accentColor`, `backgroundColor`, `textColor`, `cardColor`, `mutedColor`, `borderColor`, `secondaryColor`, `inputColor`, `ringColor` and their `*Foreground`', 'hex `#rgb`/`#rrggbb`', '**Legacy** fields (still work). Primary and accent apply to both modes; neutrals go to the mode matching the background (light or dark)'],
        ['`defaultMode`', '`light` · `dark` · `system`', 'Initial mode **only** when the user has not picked a theme yet. `system` follows `prefers-color-scheme`'],
        ['`radius`', '`none` · `sm` · `md` · `lg` · `xl` (or a rem number 0–3)', 'Corner scale: 0, 0.25, 0.5 (default), 0.75 and 1 rem'],
        ['`fontFamily`', '`inter` · `system` · `humanist` · `geometric` · `rounded` · `serif` · `mono`', 'Allow-listed family (body and headings). `titleFont`/`bodyFont` (alphanumeric name) refine it only if there is no `fontFamily`'],
        ['`allowedThemes`', 'list of ids', 'Selectable **generic** themes: `light`, `dark`, `midnight`, `amoled`, `ocean`, `forest`, `rose`, `contrast`. Empty or omitted = all'],
        ['`lockBrand`', 'boolean', '`true`: the user only sees the company themes (`brand-light`/`brand-dark`). Only effective when company colours exist'],
        ['`autoFixContrast`', 'boolean (default `true`)', '`false`: explicit tokens that fail AA are **not** corrected (warning only)'],
        ['`landing`', 'object', 'Landing and login: see [Landing and login](/docs/landing)'],
    ] },
    { t: 'h3', id: 'derive', text: 'How it is interpreted' },
    { t: 'ul', items: [
        'With **any colour** (legacy field or `palette`) two full themes are generated, `brand-light` and `brand-dark`. Radius, font or mode alone do **not** create company themes.',
        'If you define a single mode, the other is **derived** from the first one\'s background (keeps the hue; 8 % lightness for dark and 97.5 % for light).',
        'A background of the opposite scheme (dark in `palette.light` or light in `palette.dark`) is **discarded** with a warning: a dark canvas is never painted with light tokens.',
        'A muted, border or secondary almost identical to the background (for example `#ffffff` on `#ffffff`) is discarded and a visible one is derived (only when `autoFixContrast` is not `false`).',
        'With `autoFixContrast: true`, a colour that fails AA is moved to the nearest one that passes. The panel editor shows the chosen colour, the applied one and its ratio.',
        'Unknown keys are dropped on save (backend and frontend use the **same** sanitiser, with hex normalised to `#rrggbb`).',
    ] },
    { t: 'h2', id: 'tokens', text: 'Tokens and their role' },
    { t: 'p', text: 'There are **49 tokens** (`--color-<token>` and Tailwind utilities `bg-<token>`, `text-<token>`, `border-<token>`, `ring-<token>`, with opacity such as `bg-primary/10`). BloomX components only use these tokens, never hex or raw palettes.' },
    { t: 'table', head: ['Token', 'Role'], rows: tokenRows(false), caption: 'Semantic tokens' },
    { t: 'p', text: 'Besides colour: `--radius` (all `rounded-*` classes derive from it; `rounded-full` does not change) and the font variables `--font-body` and `--font-title`.' },
    { t: 'h2', id: 'designers', text: 'Guide for designers' },
    { t: 'ol', items: [
        '**Start with 2–3 colours**: `primary` (brand), `brand-accent` (second colour) and `background`. The engine derives the other 40+ tokens and guarantees AA. Define `foreground`, `card`, `muted`, `border` only if the brand demands them.',
        '**Pick `primary` for two uses**: button fill (with `primary-foreground` on top) and **text/link on the background** (`text-primary` must reach 4.5:1 on `background` and `card`). A very light primary usually fails as text in light mode; use a darker one in `palette.light` and a lighter one in `palette.dark`.',
        '**Define dark mode separately** when you have a dark brand version: tones that work on white almost never work on `#101418`.',
        '**Dark backgrounds**: avoid pure black (`#000000`) unless you want AMOLED; a very dark background and a `card` slightly lighter keep hierarchy.',
        '**States** (`destructive`, `success`, `warning`, `info`): keep their semantic hue and only contrast is corrected. Do not change them unless the brand demands it.',
        '**Radius and font** change personality without touching contrast: `radius: "none"` for a straight corporate look, `"xl"` for a friendly one; `fontFamily` only accepts the allow-list (no custom web fonts).',
        '**Verify** with `npm run check:themes` by adding your palette to `BRAND_FIXTURES` (`src/lib/theme-fixtures.ts`) and with the panel editor, which warns live about every failing pair.',
    ] },
    { t: 'h3', id: 'aa', text: 'AA contrast: what is required' },
    { t: 'table', head: ['Pair', 'Minimum'], rows: [
        ['Text (`foreground`, `card-foreground`, `popover-foreground`, `sidebar-foreground`, `header-foreground`…) on its surface', '4.5:1'],
        ['`muted-foreground` on background, card, muted, popover, sidebar, unread and hover/selected rows', '4.5:1'],
        ['`primary`, `destructive`, `success`, `warning`, `info`, `brand-accent`, `link` and `link-hover` as text on background/card', '4.5:1'],
        ['Buttons: `primary-foreground` on `primary` (and the other fill/text pairs)', '4.5:1'],
        ['`input` (control border) and `ring` (focus) on background and card', '3:1'],
        ['`scrollbar` on background', '1.5:1'],
    ] },
    { t: 'callout', kind: 'note', text: '`text-muted-foreground` is **not** guaranteed on `secondary`, `header`, `code`, `chip`, `primary`, images or gradients. `autoFixContrast: false` warnings only cover the pairs in the table above.' },
    { t: 'h2', id: 'examples', text: 'JSON examples' },
    { t: 'code', lang: 'json', title: 'Minimal: two colours (both modes derived)', code: exMinimal },
    { t: 'code', lang: 'json', title: 'Full: per-mode palette, radius, font and allowed themes', code: exFull },
    { t: 'code', lang: 'json', title: 'Locked brand: the user only sees the company themes', code: exLocked },
    { t: 'code', lang: 'bash', title: 'Saving it on the backend', code: putEx.replace('# Guardar el tema de la empresa (sesión de manager). El cuerpo REEMPLAZA todo el tema, incluida la landing.', '# Save the company theme (manager session). The body REPLACES the whole theme, landing included.') },
    { t: 'callout', kind: 'warn', title: 'PUT replaces the whole theme', text: '`PUT /api/admin/domain` stores the **entire** `theme` you send (`landing` included). Always send the full object. If you save from a panel screen that only knows colour and font fields, check that it does not drop `palette` or `landing`.' },
    { t: 'h3', id: 'selection', text: 'What the user sees' },
    { t: 'ul', items: [
        'With company colours, the picker shows `"<Company> · Light"` and `"<Company> · Dark"` first, then the allowed generic themes (`light` and `dark` are hidden because they are replaced, unless listed in `allowedThemes`).',
        '`defaultMode` only applies if the user has not chosen (no cookie, `localStorage` or DB value). An explicit choice, including "System", always wins.',
        'A stored preference that is no longer selectable is remapped to the default theme of the same scheme, without deleting what was stored. With `lockBrand`, all of them.',
        'Without company configuration: the 8 generic themes and `system`, as always. The theme is injected on the server (`<style id="bx-brand">`) and an anti-flash script is included.',
    ] },
    { t: 'h2', id: 'local', text: 'Test locally' },
    { t: 'ol', items: [
        '**Without a backend**: set `NEXT_PUBLIC_BLOOMX_THEME_OVERRIDE` in `.env.local` and restart `next dev`. It replaces the `/api/config` theme (server and client) and is ignored in production. Delete the `bloomx-theme` cookie and `localStorage["bloomx:theme:v1"]` to see `defaultMode`.',
        '**Contrast**: `npm run check:themes`.',
        '**Tests**: the theme and selection ones.',
        '**Per-token warnings**: `buildBrandThemes(cfg)?.warnings` (or `analyzeBrandTheme(cfg)`) returns, per token, the chosen value, the applied one, the ratios and whether it was corrected.',
    ] },
    { t: 'code', lang: 'bash', title: 'Override in development', code: localEnv.replace('# .env.local (solo desarrollo; se ignora en producción). Una línea, JSON válido.', '# .env.local (development only; ignored in production). One line, valid JSON.') },
    { t: 'code', lang: 'bash', title: 'Verification', code: localCmds.replace('# contraste AA de los 8 temas y de los 12 ejemplos de empresa', '# AA contrast of the 8 themes and the 12 company examples').replace('# tabla en Markdown', '# Markdown table') },
    { t: 'h2', id: 'catalogue', text: 'Generic themes' },
    { t: 'p', text: 'Without company configuration there are 8 themes: `light`, `dark`, `midnight`, `amoled`, `ocean`, `forest`, `rose` and `contrast` (high contrast), plus **System**. The preference is stored in a cookie, `localStorage` and the account. Inbound mail also has its own mode option (darken, the default, or paper light; `mailDarkMode`).' },
    { t: 'h2', id: 'limits', text: 'Known limits' },
    { t: 'ul', items: [
        'Only `overlay` accepts alpha; other colours are rejected if they carry an alpha other than `ff`.',
        'The safety net that remaps raw Tailwind scales in dark themes exists for old code; new code must not rely on it.',
        'Fonts are only the allow-listed ones (no custom fonts are loaded).',
        'Calendar colours, calendars and user labels are chosen by each user; text on top is computed by contrast.',
    ] },
];

const page: DocPageContent = { es, en };
export default page;
