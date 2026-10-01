import type { DocPageContent } from '../types';

/**
 * Texto de la ficha de /docs/extension-tools/tsdocs. La pagina real (indice con buscador y paginas por simbolo)
 * se pinta con componentes propios desde src/app/docs/_content/generated/sdk-tsdocs.json; este contenido alimenta
 * el buscador global y la navegacion.
 */
const page: DocPageContent = {
    es: [
        { t: 'p', text: 'Referencia **generada automáticamente** de los `.d.ts` reales del SDK (`bloomx-extensions/_shared/sdk`): interfaces, tipos, funciones, constantes, acciones y servicios del host, con su documentación TSDoc, ejemplos copiables y enlaces entre tipos.' },
        { t: 'h2', id: 'modules', text: 'Módulos' },
        { t: 'ul', items: [
            '`sdk`: `defineManifest` y reexportaciones.',
            '`manifest`: `Manifest`, `ManifestMount`, `MountPoint`, permisos, hooks y rutas.',
            '`ui`: componentes (`ui.*`), acciones (`act.*`) y expresiones (`expr.*`).',
            '`host`: `HandlerContext`, `Handler` y los servicios de `ctx.services` (storage, notify, calendar...).',
        ] },
        { t: 'h2', id: 'regenerate', text: 'Regenerar' },
        { t: 'code', lang: 'bash', title: 'Frontend', code: 'npm run docs:tsdocs          # escribe src/app/docs/_content/generated/sdk-tsdocs*.json\nnpm run docs:tsdocs -- --check  # falla si lo commiteado esta desactualizado' },
    ],
    en: [
        { t: 'p', text: '**Automatically generated** reference of the real SDK `.d.ts` files (`bloomx-extensions/_shared/sdk`): interfaces, types, functions, constants, actions and host services, with their TSDoc documentation, copyable examples and links between types.' },
        { t: 'h2', id: 'modules', text: 'Modules' },
        { t: 'ul', items: [
            '`sdk`: `defineManifest` and re-exports.',
            '`manifest`: `Manifest`, `ManifestMount`, `MountPoint`, permissions, hooks and routes.',
            '`ui`: components (`ui.*`), actions (`act.*`) and expressions (`expr.*`).',
            '`host`: `HandlerContext`, `Handler` and the `ctx.services` services (storage, notify, calendar...).',
        ] },
        { t: 'h2', id: 'regenerate', text: 'Regenerate' },
        { t: 'code', lang: 'bash', title: 'Frontend', code: 'npm run docs:tsdocs          # writes src/app/docs/_content/generated/sdk-tsdocs*.json\nnpm run docs:tsdocs -- --check  # fails if the committed files are stale' },
    ],
};

export default page;
