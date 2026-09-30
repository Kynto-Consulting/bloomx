'use client';

/**
 * Textos de la pagina /extensions (es/en). Autocontenido: no depende de src/lib/i18n/messages. El idioma sale de
 * `useI18n().locale`; cualquier otro cae a espanol. Los marcadores {x} se sustituyen con `fmt`.
 */
import { useI18n } from '@/components/I18nProvider';
import type { CategoryId } from '@/lib/expansions/manage/categories';
import type { StatusFilter } from '@/lib/expansions/manage/model';
import type { ExtensionErrorKind } from '@/lib/expansions/client/error-log';

const ES = {
    title: 'Extensiones', subtitle: 'Gestiona las extensiones instaladas en tu organizacion: activalas, ordenalas y revisa que hacen.',
    searchLabel: 'Buscar extensiones', searchPlaceholder: 'Buscar por nombre, descripcion o etiqueta', clearSearch: 'Borrar busqueda',
    categoryLabel: 'Categoria', allCategories: 'Todas', tagsLabel: 'Etiquetas', statusLabel: 'Estado', viewLabel: 'Vista', viewCards: 'Tarjetas', viewList: 'Lista',
    resultsCount: '{n} de {total} extensiones', resultsOne: '1 de {total} extensiones',
    sessionRequired: 'Necesitas iniciar sesion para gestionar tus extensiones.', goLogin: 'Iniciar sesion', checkingSession: 'Comprobando tu sesion...',
    loading: 'Cargando extensiones...', loadError: 'No se pudieron cargar las extensiones. Comprueba tu conexion e intentalo de nuevo.', retry: 'Reintentar',
    emptyTitle: 'Todavia no hay extensiones instaladas', emptyText: 'Cuando tu organizacion instale extensiones, apareceran aqui.',
    noMatchTitle: 'Ninguna extension coincide', noMatchText: 'Prueba con otra busqueda o quita algun filtro.', clearFilters: 'Quitar filtros',
    statusAll: 'Todas', statusActive: 'Activas', statusUserDisabled: 'Desactivadas por ti', statusOrgDisabled: 'Desactivadas por la organizacion', statusErrors: 'Con errores', statusPaid: 'De pago', statusFree: 'Gratuitas',
    badgeActive: 'Activa', badgeUserDisabled: 'Desactivada por ti', badgeOrgDisabled: 'Desactivada por la organizacion', badgeInvalid: 'Manifest invalido', badgePaid: 'De pago', badgeFree: 'Gratuita', badgeUpdate: 'Actualizacion disponible',
    invalidTitle: 'Manifest invalido: esta extension no se carga', invalidHelp: 'Avisa al autor o al administrador de tu organizacion. Motivo:',
    enableSwitch: 'Activar {name}', enabledFor: 'Activada para ti', disabledFor: 'Desactivada para ti',
    badgeMandatory: 'Obligatoria', mandatoryFor: 'Obligatoria', mandatorySwitch: '{name} es obligatoria y no se puede desactivar',
    mandatoryLocked: 'Tu organizacion la exige (por ejemplo, proteccion de datos): no se puede desactivar y sus reglas de servidor se aplican siempre.',
    loadErrorTitle: 'No se pudieron cargar las extensiones', retrying: 'Reintentando...', loadErrorStale: 'Se muestra la ultima informacion conocida porque no se pudo actualizar. Reintentamos automaticamente; tambien puedes hacerlo tu.',
    noEffect: 'Sin efecto: desactivada por la organizacion', noEffectHelp: 'Aunque la tengas activada, no se mostrara hasta que tu organizacion la active.',
    toggledOn: '{name} activada.', toggledOff: '{name} desactivada.',
    orderTitle: 'Orden de botones y paneles', orderHelp: 'El orden de la lista es el orden en que aparecen los botones y paneles de tus extensiones.', orderPosition: 'Posicion {n}',
    moveUp: 'Subir {name}', moveDown: 'Bajar {name}', moved: '{name} movida a la posicion {n} de {total}.', movedNot: '{name} ya esta en la posicion {n}.', resetOrder: 'Restablecer orden', resetDone: 'Orden restablecido.',
    details: 'Detalles', closeDetail: 'Cerrar detalles', detailOf: 'Detalles de {name}', idLabel: 'Identificador', installedVersion: 'Version instalada', catalogVersion: 'Version del catalogo',
    updateAvailable: 'Actualizacion disponible: la version {catalog} esta publicada y tienes la {installed}.', unknownVersion: 'desconocida',
    invalidUpdateHint: 'Se está usando la versión {installed}; el catálogo tiene la {catalog}: actualiza.', degradedTitle: 'Se descartaron {n} elemento(s) de esta extensión por errores; el resto funciona.',
    problemsTitle: 'Problemas detectados', updateAction: 'Actualizar', updating: 'Actualizando…', updateAria: 'Actualizar {name} a la versión {catalog}',
    updateDone: '{name} actualizada a la versión {catalog}.', updateFailed: 'No se pudo actualizar {name}. Inténtalo de nuevo o pide al administrador que republique la extensión.',
    updateInvalidCatalog: 'La versión del catálogo aún no es válida: hay que republicar la extensión (sync-extensions).', updateAdminOnly: 'Solo el administrador del dominio puede actualizarla.',
    description: 'Descripcion', noDescription: 'Sin descripcion.', permissions: 'Que puede hacer', noPermissions: 'No pide ningun permiso especial.', undocumentedPermission: 'Permiso no documentado',
    sensitivity: 'Sensibilidad', levelLow: 'Baja', levelMedium: 'Media', levelHigh: 'Alta', sensitivityShort: 'Sensibilidad {level}',
    whereAppears: 'Donde aparece', noMounts: 'No anade botones ni paneles visibles.',
    preview: 'Vista previa', previewHelp: 'Solo visual: los botones no hacen nada y no se contacta con ningun servicio.', previewNone: 'Esta extension no tiene ningun panel que previsualizar.', previewBroken: 'La vista previa no esta disponible porque el diseno de la extension tiene errores.',
    screenshots: 'Capturas', screenshotAlt: 'Captura {n} de {name}', changelog: 'Historial de versiones', noChangelog: 'Sin historial de versiones.',
    category: 'Categoria', tags: 'Etiquetas', price: 'Precio', free: 'Gratuita',
    catAll: 'Todas', cat_mail: 'Correo', cat_composer: 'Redactor', cat_calendar: 'Calendario', cat_contacts: 'Contactos', cat_automation: 'Automatizacion', cat_ai: 'IA', cat_integrations: 'Integraciones', cat_settings: 'Ajustes', cat_other: 'Otras',
    errorsTitle: 'Errores de extensiones', errorsHelp: 'Problemas detectados al cargar o ejecutar extensiones en este navegador. Utiles para quien las desarrolla.',
    errorsNone: 'No se ha registrado ningun error.', errorsOf: 'Errores de ejecucion', errorCount: '{n} errores', errorCountOne: '1 error',
    colType: 'Tipo', colPath: 'Ruta', colMessage: 'Mensaje', colTimes: 'Veces', colWhen: 'Ultima vez', colExtension: 'Extension',
    kind_validation: 'Validacion', kind_render: 'Render', kind_action: 'Accion', kind_expression: 'Expresion', kind_manifest: 'Manifest',
    copyReport: 'Copiar informe', copied: 'Informe copiado.', copyFailed: 'No se pudo copiar. Selecciona el texto manualmente.', clear: 'Limpiar', clearAll: 'Limpiar todo', cleared: 'Errores eliminados.',
    openPlayground: 'Abrir en el playground', manageLink: 'Gestionar extensiones',
    reportTitle: 'Informe de errores de extensiones',
    times: 'x{n}', justNow: 'ahora',
} as const;

export type ManageStrings = { [K in keyof typeof ES]: string };

const EN: ManageStrings = {
    title: 'Extensions', subtitle: 'Manage the extensions installed in your organization: turn them on or off, reorder them and review what they do.',
    searchLabel: 'Search extensions', searchPlaceholder: 'Search by name, description or tag', clearSearch: 'Clear search',
    categoryLabel: 'Category', allCategories: 'All', tagsLabel: 'Tags', statusLabel: 'Status', viewLabel: 'View', viewCards: 'Cards', viewList: 'List',
    resultsCount: '{n} of {total} extensions', resultsOne: '1 of {total} extensions',
    sessionRequired: 'You need to sign in to manage your extensions.', goLogin: 'Sign in', checkingSession: 'Checking your session...',
    loading: 'Loading extensions...', loadError: 'Extensions could not be loaded. Check your connection and try again.', retry: 'Try again',
    emptyTitle: 'No extensions installed yet', emptyText: 'When your organization installs extensions, they will show up here.',
    noMatchTitle: 'No extension matches', noMatchText: 'Try another search or remove a filter.', clearFilters: 'Clear filters',
    statusAll: 'All', statusActive: 'Active', statusUserDisabled: 'Turned off by you', statusOrgDisabled: 'Turned off by the organization', statusErrors: 'With errors', statusPaid: 'Paid', statusFree: 'Free',
    badgeActive: 'Active', badgeUserDisabled: 'Turned off by you', badgeOrgDisabled: 'Turned off by the organization', badgeInvalid: 'Invalid manifest', badgePaid: 'Paid', badgeFree: 'Free', badgeUpdate: 'Update available',
    invalidTitle: 'Invalid manifest: this extension is not loaded', invalidHelp: 'Let the author or your organization administrator know. Reason:',
    enableSwitch: 'Turn on {name}', enabledFor: 'On for you', disabledFor: 'Off for you',
    badgeMandatory: 'Mandatory', mandatoryFor: 'Mandatory', mandatorySwitch: '{name} is mandatory and cannot be turned off',
    mandatoryLocked: 'Your organization requires it (for example, data protection): it cannot be turned off and its server rules always apply.',
    loadErrorTitle: 'Extensions could not be loaded', retrying: 'Retrying...', loadErrorStale: 'Showing the last known information because it could not be refreshed. We retry automatically; you can also retry now.',
    noEffect: 'No effect: turned off by the organization', noEffectHelp: 'Even if you keep it on, it will not show up until your organization turns it on.',
    toggledOn: '{name} turned on.', toggledOff: '{name} turned off.',
    orderTitle: 'Order of buttons and panels', orderHelp: 'The order of the list is the order in which your extensions\' buttons and panels appear.', orderPosition: 'Position {n}',
    moveUp: 'Move {name} up', moveDown: 'Move {name} down', moved: '{name} moved to position {n} of {total}.', movedNot: '{name} is already at position {n}.', resetOrder: 'Reset order', resetDone: 'Order reset.',
    details: 'Details', closeDetail: 'Close details', detailOf: 'Details of {name}', idLabel: 'Identifier', installedVersion: 'Installed version', catalogVersion: 'Catalog version',
    updateAvailable: 'Update available: version {catalog} is published and you have {installed}.', unknownVersion: 'unknown',
    invalidUpdateHint: 'Version {installed} is in use; the catalog has {catalog}: update.', degradedTitle: '{n} element(s) of this extension were discarded because of errors; the rest works.',
    problemsTitle: 'Problems found', updateAction: 'Update', updating: 'Updating…', updateAria: 'Update {name} to version {catalog}',
    updateDone: '{name} updated to version {catalog}.', updateFailed: 'Could not update {name}. Try again or ask the administrator to republish the extension.',
    updateInvalidCatalog: 'The catalog version is not valid yet: the extension must be republished (sync-extensions).', updateAdminOnly: 'Only the domain administrator can update it.',
    description: 'Description', noDescription: 'No description.', permissions: 'What it can do', noPermissions: 'It does not ask for any special permission.', undocumentedPermission: 'Undocumented permission',
    sensitivity: 'Sensitivity', levelLow: 'Low', levelMedium: 'Medium', levelHigh: 'High', sensitivityShort: '{level} sensitivity',
    whereAppears: 'Where it appears', noMounts: 'It does not add visible buttons or panels.',
    preview: 'Preview', previewHelp: 'Visual only: buttons do nothing and no service is contacted.', previewNone: 'This extension has no panel to preview.', previewBroken: 'The preview is not available because the extension design has errors.',
    screenshots: 'Screenshots', screenshotAlt: 'Screenshot {n} of {name}', changelog: 'Version history', noChangelog: 'No version history.',
    category: 'Category', tags: 'Tags', price: 'Price', free: 'Free',
    catAll: 'All', cat_mail: 'Mail', cat_composer: 'Composer', cat_calendar: 'Calendar', cat_contacts: 'Contacts', cat_automation: 'Automation', cat_ai: 'AI', cat_integrations: 'Integrations', cat_settings: 'Settings', cat_other: 'Other',
    errorsTitle: 'Extension errors', errorsHelp: 'Problems detected while loading or running extensions in this browser. Useful for whoever builds them.',
    errorsNone: 'No errors have been recorded.', errorsOf: 'Runtime errors', errorCount: '{n} errors', errorCountOne: '1 error',
    colType: 'Type', colPath: 'Path', colMessage: 'Message', colTimes: 'Times', colWhen: 'Last seen', colExtension: 'Extension',
    kind_validation: 'Validation', kind_render: 'Render', kind_action: 'Action', kind_expression: 'Expression', kind_manifest: 'Manifest',
    copyReport: 'Copy report', copied: 'Report copied.', copyFailed: 'Could not copy. Select the text manually.', clear: 'Clear', clearAll: 'Clear all', cleared: 'Errors cleared.',
    openPlayground: 'Open in the playground', manageLink: 'Manage extensions',
    reportTitle: 'Extension error report',
    times: 'x{n}', justNow: 'now',
};

const STATUS_KEY: Record<StatusFilter, keyof ManageStrings> = {
    all: 'statusAll', active: 'statusActive', 'user-disabled': 'statusUserDisabled', 'org-disabled': 'statusOrgDisabled', errors: 'statusErrors', paid: 'statusPaid', free: 'statusFree',
};

export function getManageStrings(locale: string): ManageStrings { return locale === 'en' ? EN : ES; }
export const fmt = (template: string, values: Record<string, string | number>): string => template.replace(/\{(\w+)\}/g, (_, k) => (k in values ? String(values[k]) : `{${k}}`));

export function useManageStrings() {
    const { locale } = useI18n();
    const s = getManageStrings(locale);
    const lang: 'es' | 'en' = locale === 'en' ? 'en' : 'es';
    return {
        s, lang,
        statusLabel: (status: StatusFilter) => s[STATUS_KEY[status]],
        categoryLabel: (id: CategoryId) => s[`cat_${id}` as keyof ManageStrings],
        kindLabel: (kind: ExtensionErrorKind) => s[`kind_${kind}` as keyof ManageStrings],
        levelLabel: (level: 'low' | 'medium' | 'high') => s[level === 'low' ? 'levelLow' : level === 'medium' ? 'levelMedium' : 'levelHigh'],
    };
}
