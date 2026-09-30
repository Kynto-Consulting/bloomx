import type { Block, DocPageContent } from '../types';

const exSplit = `{
  "landing": {
    "layout": "split-right",
    "hero": {
      "badge": "Correo corporativo",
      "title": "Tu correo, bajo tu marca",
      "subtitle": "Seguro, rápido y con tus reglas.",
      "gradient": { "from": "#0b5fff", "to": "#1e1b4b", "angle": 135 },
      "pattern": "dots",
      "mobile": "banner"
    },
    "logo": { "light": "https://cdn.mi-empresa.com/logo.svg", "dark": "https://cdn.mi-empresa.com/logo-dark.svg", "height": 32, "position": "panel", "showName": true },
    "features": [
      { "icon": "shield", "title": "Seguridad de nivel empresarial", "text": "MFA y cifrado en reposo." },
      { "icon": "zap", "title": "Rápido", "text": "Búsqueda instantánea y atajos de teclado." },
      { "icon": "calendar", "title": "Calendario integrado" }
    ],
    "footer": { "text": "© Mi Empresa", "links": [ { "label": "Soporte", "url": "https://mi-empresa.com/soporte" } ], "showPoweredBy": false }
  }
}`;

const exMinimal = `{
  "landing": {
    "layout": "minimal",
    "form": { "showRegisterLink": false, "showGoogle": false, "showRememberMe": true },
    "registration": { "enabled": false, "message": "El alta es solo por invitación." },
    "legal": { "termsUrl": "https://mi-empresa.com/terminos", "privacyUrl": "https://mi-empresa.com/privacidad" }
  }
}`;

const exFull = `{
  "landing": {
    "layout": "fullscreen-bg",
    "locale": "es",
    "panelWidth": 440,
    "background": { "type": "image", "imageUrl": "https://cdn.mi-empresa.com/fondo.jpg", "overlay": 0.55 },
    "hero": { "title": "Bienvenido", "subtitle": "Accede a tu correo corporativo", "imageAlt": "Oficina" },
    "form": { "title": "Inicia sesión", "submitLabel": "Entrar", "alignment": "left", "showForgotLink": true },
    "testimonials": {
      "enabled": true,
      "style": "carousel",
      "items": [
        { "quote": "Migramos en un fin de semana.", "author": "Ana Ruiz", "role": "CTO", "avatarUrl": "https://cdn.mi-empresa.com/ana.jpg" },
        { "quote": "Por fin un correo que respeta nuestra marca.", "author": "Luis Peña", "role": "Operaciones" }
      ]
    },
    "stats": [ { "value": "99.9%", "label": "Disponibilidad" }, { "value": "24/7", "label": "Soporte" } ],
    "docs": { "visible": true, "landingLink": true, "showInFooter": true },
    "i18n": {
      "es": { "heroTitle": "Bienvenido", "submitLabel": "Entrar" },
      "en": { "heroTitle": "Welcome", "heroSubtitle": "Sign in to your company mail", "submitLabel": "Sign in", "formTitle": "Sign in" }
    }
  }
}`;

const putEx = `# Guardar (sesión de manager). El cuerpo reemplaza TODO el tema: incluye también palette/colores si los tienes.
curl -sS -X PUT "$BACKEND/api/admin/domain" \\
  -H 'content-type: application/json' -b 'auth_session=<cookie>' \\
  -d @tema-completo.json     # {"theme": { ...colores..., "landing": { ... } }}`;

const es: Block[] = [
    { t: 'p', text: 'La pantalla de **login y registro** de cada empresa es configurable sin código. La configuración vive en `Domain.theme.landing` (JSON) y es **dato, nunca código**: solo claves de una lista blanca, longitudes máximas, enums, colores hex, números acotados y URLs https (o rutas relativas en los enlaces). Sin HTML, CSS libre, JavaScript, `data:` ni `http:`. Un saneador **idéntico** en frontend y backend (con test de paridad) la valida al guardar y al servir.' },
    { t: 'callout', kind: 'note', text: 'Sin `landing` se usa el diseño histórico (hero a la izquierda y formulario a la derecha). Cualquier valor inválido se descarta o se recorta sin romper la pantalla; el tamaño total máximo es 32 KB.' },
    { t: 'h2', id: 'layouts', text: 'Layouts' },
    { t: 'table', head: ['`layout`', 'Descripción'], rows: [
        ['`split-right` (por defecto)', 'Hero a un lado y panel de login a la derecha'],
        ['`split-left`', 'Panel de login a la izquierda'],
        ['`center`', 'Formulario centrado sobre el fondo'],
        ['`fullscreen-bg`', 'Fondo a pantalla completa (color, degradado o imagen) con el panel encima'],
        ['`minimal`', 'Solo el formulario, sin hero'],
    ] },
    { t: 'p', text: 'Las páginas de administración (`/admin/login`, `/admin/register`) fuerzan `center` y ocultan hero, funciones, estadísticas y testimonios. En móvil, `hero.mobile` es `banner` (hero compacto arriba) u `hidden` (solo la cabecera de marca).' },
    { t: 'h2', id: 'reference', text: 'Referencia de campos' },
    { t: 'table', head: ['Sección', 'Campos y límites'], rows: [
        ['raíz', '`layout`, `panelWidth` (320–560 px), `locale` (`es` | `en`: fuerza el idioma de la landing)'],
        ['`hero`', '`title` (80), `subtitle` (240), `badge` (40), `imageUrl` (https), `imageAlt` (120), `imagePosition` (`center|top|bottom|left|right`), `overlay` (0–1; el render sube el mínimo necesario para garantizar AA del texto), `gradient {from, to, angle 0–360}`, `pattern` (`none|dots|grid|diagonal`), `mobile`'],
        ['`logo`', '`light` y `dark` (https), `height` (16–96), `position` (`panel|hero|header`), `showName`'],
        ['`background`', '`type` (`color|gradient|image`), `color`, `gradient`, `imageUrl`, `overlay`'],
        ['`form`', '`title` (80), `subtitle` (200), `submitLabel` (40), `registerTitle`, `registerSubtitle`, `registerSubmitLabel`, `showRegisterLink`, `showForgotLink`, `showGoogle`, `showRememberMe`, `alignment` (`left|center`)'],
        ['`testimonials`', '`enabled`, `style` (`cards|carousel|quote`), `items` (hasta **8**): `quote` (280, obligatorio), `author` (60), `role` (80), `avatarUrl` (https)'],
        ['`features`', 'Hasta **6**: `title` (60, obligatorio), `text` (160), `icon` (`shield lock zap globe mail users sparkles check star heart clock cloud key inbox send calendar bell file headphones rocket chart building`)'],
        ['`stats`', 'Hasta **4**: `value` (16, obligatorio), `label` (40)'],
        ['`footer`', '`text` (200), `links` (hasta **6**: `label` 40 y `url` https o ruta que empiece por una sola `/`), `showPoweredBy`'],
        ['`legal`', '`termsUrl`, `privacyUrl` (https o ruta relativa)'],
        ['`docs`', '`visible`, `showInFooter`, `showInSidebar`, `landingLink`: ver [Ocultar o mostrar docs](/docs/hide-docs)'],
        ['`registration`', '`enabled`, `requireKey`, `message` (200): ver abajo'],
        ['`i18n`', '`{es: {...}, en: {...}}` con los textos traducibles'],
    ] },
    { t: 'h3', id: 'i18n', text: 'Textos por idioma' },
    { t: 'p', text: 'Los textos de la empresa se pueden dar por idioma en `i18n.es` / `i18n.en`. Claves admitidas: `heroTitle`, `heroSubtitle`, `heroBadge`, `imageAlt`, `formTitle`, `formSubtitle`, `submitLabel`, `registerTitle`, `registerSubtitle`, `registerSubmitLabel`, `footerText`, `registrationMessage`. Prioridad de un texto: `i18n[idioma]` > valor base (`hero.title`, …) > diccionario global de BloomX. El idioma efectivo es `landing.locale` si la empresa lo fuerza; si no, el del visitante (cookie `bloomx-lang` → `Accept-Language` → español).' },
    { t: 'h3', id: 'registration', text: 'Registro' },
    { t: 'ul', items: [
        '`registration.enabled: false` oculta el enlace "crear cuenta" del login y muestra en `/register` un aviso (`registration.message`). **Es solo interfaz**: el servidor sigue aceptando `POST /api/register` con la clave correcta.',
        '`registration.enabled: false` hace que el servidor (`/api/register`) responda 403 (el formulario también se oculta). `registration.requireKey: false` hace que el servidor **no pida** la clave de registro, y `true` (por defecto) exige `REGISTRATION_KEY`; en producción, si falta o vale `dev-secret`, el registro con clave responde 403. La política la aplica el servidor aunque el formulario se manipule.',
        '`form.showRegisterLink: false` oculta el enlace de registro del login. `showForgotLink`, `showGoogle` y `showRememberMe` controlan esos elementos del formulario.',
        'El acceso con Google solo funciona si configuraste `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` y `NEXTAUTH_URL` ([Variables](/docs/env-variables#g-oauth)).',
    ] },
    { t: 'h2', id: 'examples', text: 'Ejemplos JSON copiables' },
    { t: 'p', text: 'Cada ejemplo va dentro de `theme` (el mismo objeto de [Temas empresariales](/docs/themes)). Las URL de imágenes deben ser https y servidas por ti.' },
    { t: 'code', lang: 'json', title: 'Corporativo: split con degradado, logo, funciones y pie', code: exSplit },
    { t: 'code', lang: 'json', title: 'Minimal: solo invitación', code: exMinimal },
    { t: 'code', lang: 'json', title: 'Completo: fondo de imagen, testimonios, estadísticas y textos es/en', code: exFull },
    { t: 'code', lang: 'bash', title: 'Guardar', code: putEx },
    { t: 'callout', kind: 'warn', title: 'PUT reemplaza el tema completo', text: 'El backend guarda exactamente el `theme` que recibe: si envías solo `landing`, pierdes la paleta. Envía el objeto completo (colores + `landing`). El editor de landing del panel (`LandingEditor`) puede no estar montado en el panel de administración de tu versión: en ese caso usa `PUT /api/admin/domain`, y comprueba que el guardado desde el panel no descarte `landing`.' },
    { t: 'h2', id: 'security', text: 'Seguridad y límites' },
    { t: 'ul', items: [
        'Todo texto pasa por una limpieza (sin HTML ni caracteres de control o de dirección bidi); el texto que exceda el máximo se recorta.',
        'Las imágenes solo pueden ser https y se pintan con `<img referrerPolicy="no-referrer">`; nunca con `url(...)` en CSS, para evitar inyección por URL. La CSP ya permite `https:` en `img-src`.',
        'Un elemento sin campo obligatorio (testimonio sin `quote`, función sin `title`, enlace sin `label` o `url`) se descarta.',
        'Límites: 8 testimonios, 6 funciones, 4 estadísticas, 6 enlaces de pie, 32 KB en total. Más elementos se recortan.',
        'El contraste del texto sobre imagen o degradado se calcula en el render para cumplir AA (sube el `overlay` mínimo si hace falta).',
    ] },
];

const en: Block[] = [
    { t: 'p', text: 'Each company\'s **login and sign-up** screen is configurable without code. The configuration lives in `Domain.theme.landing` (JSON) and is **data, never code**: only allow-listed keys, maximum lengths, enums, hex colours, bounded numbers and https URLs (or relative paths in links). No HTML, free CSS, JavaScript, `data:` or `http:`. An **identical** sanitiser on frontend and backend (with a parity test) validates it on save and on serve.' },
    { t: 'callout', kind: 'note', text: 'Without `landing` the historical design is used (hero on the left and form on the right). Any invalid value is dropped or trimmed without breaking the screen; the maximum total size is 32 KB.' },
    { t: 'h2', id: 'layouts', text: 'Layouts' },
    { t: 'table', head: ['`layout`', 'Description'], rows: [
        ['`split-right` (default)', 'Hero on one side and the login panel on the right'],
        ['`split-left`', 'Login panel on the left'],
        ['`center`', 'Form centred over the background'],
        ['`fullscreen-bg`', 'Full-screen background (colour, gradient or image) with the panel on top'],
        ['`minimal`', 'Only the form, no hero'],
    ] },
    { t: 'p', text: 'The admin pages (`/admin/login`, `/admin/register`) force `center` and hide hero, features, stats and testimonials. On mobile, `hero.mobile` is `banner` (compact hero on top) or `hidden` (brand header only).' },
    { t: 'h2', id: 'reference', text: 'Field reference' },
    { t: 'table', head: ['Section', 'Fields and limits'], rows: [
        ['root', '`layout`, `panelWidth` (320–560 px), `locale` (`es` | `en`: forces the landing language)'],
        ['`hero`', '`title` (80), `subtitle` (240), `badge` (40), `imageUrl` (https), `imageAlt` (120), `imagePosition` (`center|top|bottom|left|right`), `overlay` (0–1; the render raises the minimum needed to guarantee text AA), `gradient {from, to, angle 0–360}`, `pattern` (`none|dots|grid|diagonal`), `mobile`'],
        ['`logo`', '`light` and `dark` (https), `height` (16–96), `position` (`panel|hero|header`), `showName`'],
        ['`background`', '`type` (`color|gradient|image`), `color`, `gradient`, `imageUrl`, `overlay`'],
        ['`form`', '`title` (80), `subtitle` (200), `submitLabel` (40), `registerTitle`, `registerSubtitle`, `registerSubmitLabel`, `showRegisterLink`, `showForgotLink`, `showGoogle`, `showRememberMe`, `alignment` (`left|center`)'],
        ['`testimonials`', '`enabled`, `style` (`cards|carousel|quote`), `items` (up to **8**): `quote` (280, required), `author` (60), `role` (80), `avatarUrl` (https)'],
        ['`features`', 'Up to **6**: `title` (60, required), `text` (160), `icon` (`shield lock zap globe mail users sparkles check star heart clock cloud key inbox send calendar bell file headphones rocket chart building`)'],
        ['`stats`', 'Up to **4**: `value` (16, required), `label` (40)'],
        ['`footer`', '`text` (200), `links` (up to **6**: `label` 40 and `url` https or a path starting with a single `/`), `showPoweredBy`'],
        ['`legal`', '`termsUrl`, `privacyUrl` (https or relative path)'],
        ['`docs`', '`visible`, `showInFooter`, `showInSidebar`, `landingLink`: see [Hide or show docs](/docs/hide-docs)'],
        ['`registration`', '`enabled`, `requireKey`, `message` (200): see below'],
        ['`i18n`', '`{es: {...}, en: {...}}` with the translatable texts'],
    ] },
    { t: 'h3', id: 'i18n', text: 'Per-language text' },
    { t: 'p', text: 'Company texts can be given per language in `i18n.es` / `i18n.en`. Supported keys: `heroTitle`, `heroSubtitle`, `heroBadge`, `imageAlt`, `formTitle`, `formSubtitle`, `submitLabel`, `registerTitle`, `registerSubtitle`, `registerSubmitLabel`, `footerText`, `registrationMessage`. Priority for a text: `i18n[language]` > base value (`hero.title`, …) > BloomX\'s global dictionary. The effective language is `landing.locale` if the company forces it; otherwise the visitor\'s (cookie `bloomx-lang` → `Accept-Language` → Spanish).' },
    { t: 'h3', id: 'registration', text: 'Sign-up' },
    { t: 'ul', items: [
        '`registration.enabled: false` hides the "create account" link on login and shows a notice at `/register` (`registration.message`). **It is UI only**: the server still accepts `POST /api/register` with the right key.',
        '`registration.enabled: false` makes the server (`/api/register`) answer 403 (the form is also hidden). `registration.requireKey: false` makes the server **not ask** for the sign-up key, while `true` (the default) requires `REGISTRATION_KEY`; in production, if it is missing or `dev-secret`, keyed sign-up answers 403. The server enforces the policy even if the form is tampered with.',
        '`form.showRegisterLink: false` hides the sign-up link on login. `showForgotLink`, `showGoogle` and `showRememberMe` control those form elements.',
        'Google sign-in only works if you configured `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `NEXTAUTH_URL` ([Variables](/docs/env-variables#g-oauth)).',
    ] },
    { t: 'h2', id: 'examples', text: 'Copy-paste JSON examples' },
    { t: 'p', text: 'Each example goes inside `theme` (the same object as in [Enterprise themes](/docs/themes)). Image URLs must be https and hosted by you.' },
    { t: 'code', lang: 'json', title: 'Corporate: split with gradient, logo, features and footer', code: exSplit.replace('Correo corporativo', 'Corporate mail').replace('Tu correo, bajo tu marca', 'Your mail, under your brand').replace('Seguro, rápido y con tus reglas.', 'Secure, fast and on your terms.').replace('Seguridad de nivel empresarial', 'Enterprise-grade security').replace('MFA y cifrado en reposo.', 'MFA and encryption at rest.').replace('"Rápido"', '"Fast"').replace('Búsqueda instantánea y atajos de teclado.', 'Instant search and keyboard shortcuts.').replace('Calendario integrado', 'Built-in calendar').replace('Soporte', 'Support') },
    { t: 'code', lang: 'json', title: 'Minimal: invitation only', code: exMinimal.replace('El alta es solo por invitación.', 'Sign-up is by invitation only.') },
    { t: 'code', lang: 'json', title: 'Full: image background, testimonials, stats and es/en texts', code: exFull },
    { t: 'code', lang: 'bash', title: 'Saving', code: putEx.replace('# Guardar (sesión de manager). El cuerpo reemplaza TODO el tema: incluye también palette/colores si los tienes.', '# Save (manager session). The body replaces the WHOLE theme: include palette/colours too if you have them.').replace('tema-completo.json', 'full-theme.json').replace('...colores...', '...colours...') },
    { t: 'callout', kind: 'warn', title: 'PUT replaces the whole theme', text: 'The backend stores exactly the `theme` it receives: if you send only `landing`, you lose the palette. Send the full object (colours + `landing`). The panel\'s landing editor (`LandingEditor`) may not be mounted in your version\'s admin panel: in that case use `PUT /api/admin/domain`, and check that saving from the panel does not drop `landing`.' },
    { t: 'h2', id: 'security', text: 'Security and limits' },
    { t: 'ul', items: [
        'All text goes through cleaning (no HTML, control or bidi characters); text over the maximum is trimmed.',
        'Images must be https and are drawn with `<img referrerPolicy="no-referrer">`; never with CSS `url(...)`, to avoid URL injection. The CSP already allows `https:` in `img-src`.',
        'An element missing a required field (testimonial without `quote`, feature without `title`, link without `label` or `url`) is dropped.',
        'Limits: 8 testimonials, 6 features, 4 stats, 6 footer links, 32 KB in total. Extra items are trimmed.',
        'Text contrast over an image or gradient is computed at render time to meet AA (it raises the minimum `overlay` if needed).',
    ] },
];

const page: DocPageContent = { es, en };
export default page;
