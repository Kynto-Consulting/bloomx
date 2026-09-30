import type { DocPageContent } from '../types';

const hideAll = `{
  "landing": {
    "docs": { "visible": false }
  }
}`;

const footerOnly = `{
  "landing": {
    "docs": { "visible": true, "landingLink": false, "showInFooter": true }
  }
}`;

const page: DocPageContent = {
    es: [
        { t: 'p', text: 'Cada empresa decide si su instancia muestra esta documentación y dónde se enlaza. Se configura en `theme.landing.docs` del dominio (ver [Landing y login](/docs/landing)) y se aplica sin desplegar: el frontend lee la configuración desde `GET /api/config`.' },
        { t: 'h2', id: 'options', text: 'Opciones' },
        { t: 'table', head: ['Campo', 'Por defecto', 'Efecto'], rows: [
            ['`docs.visible`', '`true`', 'Si es `false`, las páginas `/docs` no se muestran: aparece una página 404 amable ("DocsHidden") sin enlaces a `/docs`, y todos los enlaces siguientes se ocultan'],
            ['`docs.landingLink`', '`true`', 'Enlace "Documentación" en el hero/cabecera de login y registro'],
            ['`docs.showInFooter`', '`false` (opt-in)', 'Enlace "Documentación" en el pie de la landing'],
            ['`docs.showInSidebar`', '`true`', 'Reservado para la barra lateral/ajustes de la app. **Hoy ninguna pantalla lo consume**: la opción se calcula y se valida, pero no muestra ni oculta nada'],
        ] },
        { t: 'p', text: 'Sin configuración se conserva el comportamiento histórico: documentación abierta y enlace en el login.' },
        { t: 'h2', id: 'examples', text: 'Ejemplos' },
        { t: 'code', lang: 'json', title: 'Ocultar la documentación por completo', code: hideAll },
        { t: 'code', lang: 'json', title: 'Sin enlace en el login, solo en el pie', code: footerOnly },
        { t: 'p', text: 'Estos objetos van dentro de `theme` (junto al resto de la configuración). Recuerda que `PUT /api/admin/domain` **reemplaza el tema completo**: envía también colores y demás campos, o los perderás.' },
        { t: 'h2', id: 'behaviour', text: 'Cómo funciona' },
        { t: 'ol', items: [
            'El layout de `/docs` lee `landing.docs` con `useLandingConfig()` (que re-sanea la configuración en el cliente) y `resolveDocsVisibility()`.',
            'Mientras la configuración carga, `/docs` no pinta contenido, para evitar un parpadeo de documentación que luego se oculta.',
            'Si `visible` es `false`, se muestra `DocsHidden` (404 amigable con un botón hacia el login), en el idioma de la landing.',
            'Los enlaces del hero (`landingLink`) y del pie (`footer`) se calculan con la misma función, así que siempre son coherentes con `visible`.',
        ] },
        { t: 'callout', kind: 'warn', title: 'Ocultar no es proteger', text: 'La ocultación es de **interfaz**: `/docs` sigue respondiendo 200 y el contenido de la documentación viaja en el JavaScript de la aplicación. Además `/docs` es una ruta pública en el middleware. Si necesitas que la documentación no sea accesible, no la despliegues en esa instancia (por ejemplo, elimina `src/app/docs`). En esta documentación no hay secretos ni datos de tu instancia.' },
        { t: 'h2', id: 'admin', text: 'Dónde se cambia' },
        { t: 'ul', items: [
            'Por API: `PUT /api/admin/domain` con el `theme` completo (sesión de manager del dominio).',
            'Por el editor de landing del panel de administración, cuando esté disponible en tu versión (sección "Documentación": *documentación visible*, *enlace en el pie*, …).',
        ] },
    ],
    en: [
        { t: 'p', text: 'Each company decides whether its instance shows this documentation and where it is linked. It is configured in the domain\'s `theme.landing.docs` (see [Landing and login](/docs/landing)) and applied without redeploying: the frontend reads the configuration from `GET /api/config`.' },
        { t: 'h2', id: 'options', text: 'Options' },
        { t: 'table', head: ['Field', 'Default', 'Effect'], rows: [
            ['`docs.visible`', '`true`', 'If `false`, the `/docs` pages are not shown: a friendly 404 page ("DocsHidden") appears with no links to `/docs`, and all the links below are hidden'],
            ['`docs.landingLink`', '`true`', '"Documentation" link in the login and sign-up hero/header'],
            ['`docs.showInFooter`', '`false` (opt-in)', '"Documentation" link in the landing footer'],
            ['`docs.showInSidebar`', '`true`', 'Reserved for the app sidebar/settings. **No screen consumes it today**: the option is computed and validated but neither shows nor hides anything'],
        ] },
        { t: 'p', text: 'Without configuration the historical behaviour is kept: open documentation and a link on login.' },
        { t: 'h2', id: 'examples', text: 'Examples' },
        { t: 'code', lang: 'json', title: 'Hide the documentation completely', code: hideAll },
        { t: 'code', lang: 'json', title: 'No link on login, footer only', code: footerOnly },
        { t: 'p', text: 'These objects go inside `theme` (next to the rest of the configuration). Remember that `PUT /api/admin/domain` **replaces the whole theme**: also send colours and other fields, or you will lose them.' },
        { t: 'h2', id: 'behaviour', text: 'How it works' },
        { t: 'ol', items: [
            'The `/docs` layout reads `landing.docs` with `useLandingConfig()` (which re-sanitises the configuration on the client) and `resolveDocsVisibility()`.',
            'While the configuration loads, `/docs` renders no content, to avoid a flash of documentation that is then hidden.',
            'If `visible` is `false`, `DocsHidden` is shown (a friendly 404 with a button to login), in the landing language.',
            'The hero (`landingLink`) and footer (`footer`) links are computed with the same function, so they are always consistent with `visible`.',
        ] },
        { t: 'callout', kind: 'warn', title: 'Hiding is not protecting', text: 'Hiding is **UI-level**: `/docs` still answers 200 and the documentation content ships in the application\'s JavaScript. Also `/docs` is a public route in the middleware. If the documentation must not be reachable, do not deploy it on that instance (for example remove `src/app/docs`). This documentation contains no secrets or data about your instance.' },
        { t: 'h2', id: 'admin', text: 'Where to change it' },
        { t: 'ul', items: [
            'Through the API: `PUT /api/admin/domain` with the full `theme` (the domain manager\'s session).',
            'Through the admin panel\'s landing editor, when available in your version ("Documentation" section: *documentation visible*, *footer link*, …).',
        ] },
    ],
};

export default page;
