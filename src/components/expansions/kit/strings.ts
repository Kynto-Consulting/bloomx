'use client';

/**
 * Textos integrados del kit (botones de Wizard, "Cerrar", paginacion...). Autocontenido: no depende de las
 * claves de i18n de la app para poder usarse en el playground y en tests sin proveedor. El idioma sale de
 * `useI18n().locale` (es/en); cualquier otro cae a espanol.
 */
import { useI18n } from '@/components/I18nProvider';

const ES = {
    close: 'Cerrar', accept: 'Aceptar', confirmTitle: 'Confirmar', back: 'Atras', next: 'Siguiente', finish: 'Finalizar', submit: 'Enviar', cancel: 'Cancelar', retry: 'Reintentar',
    loading: 'Cargando...', empty: 'Sin datos', moreActions: 'Mas acciones', dismiss: 'Descartar', remove: 'Quitar', copy: 'Copiar', copied: 'Copiado',
    required: 'Este campo es obligatorio', page: 'Pagina', of: 'de', previousPage: 'Pagina anterior', nextPage: 'Pagina siguiente', rowsSelected: 'seleccionadas',
    selectAll: 'Seleccionar todo', selectRow: 'Seleccionar fila', select: 'Seleccionar...', search: 'Buscar...', noResults: 'Sin resultados', addTag: 'Anadir', chooseFile: 'Elegir archivo',
    chooseFiles: 'Elegir archivos', fileTooLarge: 'El archivo supera el limite', stepOf: 'Paso', sortedAsc: 'orden ascendente', sortedDesc: 'orden descendente', sortBy: 'Ordenar por',
    minLength: 'Minimo {n} caracteres', maxLength: 'Maximo {n} caracteres', min: 'Debe ser al menos {n}', max: 'Debe ser como maximo {n}', minItems: 'Elige al menos {n}', maxItems: 'Elige como maximo {n}',
    pattern: 'El formato no es valido', email: 'Escribe un correo valido', url: 'Escribe una URL valida', invalidTag: 'Valor no valido', saved: 'Guardado', error: 'No se pudo completar',
    endBeforeStart: 'El fin debe ser posterior al inicio', extensions: 'Extensiones', manageExtensions: 'Gestionar extensiones', pinToBar: 'Anclar a la barra', unpinFromBar: 'Quitar de la barra', searchActions: 'Buscar acciones', noActions: 'No hay acciones', pinKeyHint: 'P: anclar o quitar', actionsCount: '{n} acciones',
    extensionError: 'Esta extension no se pudo mostrar', extensionErrorHelp: 'El resto de la aplicacion sigue funcionando. Avisa al autor de la extension.', details: 'Detalles', errors: 'errores',
    breadcrumbs: 'Migas de pan', resizePanes: 'Cambiar el tamano de los paneles', filterBy: 'Filtrar por', allValues: 'Todos', resultsCount: '{n} resultados', clearSelection: 'Quitar seleccion',
    stepsLabel: 'Pasos', stepComplete: 'completado', stepCurrent: 'actual', stepUpcoming: 'pendiente', stepError: 'con error', trendUp: 'sube', trendDown: 'baja', trendFlat: 'sin cambios',
    treeLabel: 'Arbol', expand: 'Expandir', collapse: 'Contraer', loadError: 'No se pudieron cargar los datos',
};
export type KitStrings = typeof ES;

const EN: KitStrings = {
    close: 'Close', accept: 'Accept', confirmTitle: 'Confirm', back: 'Back', next: 'Next', finish: 'Finish', submit: 'Submit', cancel: 'Cancel', retry: 'Retry',
    loading: 'Loading...', empty: 'No data', moreActions: 'More actions', dismiss: 'Dismiss', remove: 'Remove', copy: 'Copy', copied: 'Copied',
    required: 'This field is required', page: 'Page', of: 'of', previousPage: 'Previous page', nextPage: 'Next page', rowsSelected: 'selected',
    selectAll: 'Select all', selectRow: 'Select row', select: 'Select...', search: 'Search...', noResults: 'No results', addTag: 'Add', chooseFile: 'Choose file',
    chooseFiles: 'Choose files', fileTooLarge: 'The file exceeds the limit', stepOf: 'Step', sortedAsc: 'sorted ascending', sortedDesc: 'sorted descending', sortBy: 'Sort by',
    minLength: 'At least {n} characters', maxLength: 'At most {n} characters', min: 'Must be at least {n}', max: 'Must be at most {n}', minItems: 'Choose at least {n}', maxItems: 'Choose at most {n}',
    pattern: 'The format is not valid', email: 'Enter a valid email', url: 'Enter a valid URL', invalidTag: 'Invalid value', saved: 'Saved', error: 'Could not complete',
    endBeforeStart: 'The end must be after the start', extensions: 'Extensions', manageExtensions: 'Manage extensions', pinToBar: 'Pin to the bar', unpinFromBar: 'Remove from the bar', searchActions: 'Search actions', noActions: 'No actions', pinKeyHint: 'P: pin or unpin', actionsCount: '{n} actions',
    extensionError: 'This extension could not be displayed', extensionErrorHelp: 'The rest of the app keeps working. Let the extension author know.', details: 'Details', errors: 'errors',
    breadcrumbs: 'Breadcrumbs', resizePanes: 'Resize the panels', filterBy: 'Filter by', allValues: 'All', resultsCount: '{n} results', clearSelection: 'Clear selection',
    stepsLabel: 'Steps', stepComplete: 'completed', stepCurrent: 'current', stepUpcoming: 'upcoming', stepError: 'with error', trendUp: 'up', trendDown: 'down', trendFlat: 'unchanged',
    treeLabel: 'Tree', expand: 'Expand', collapse: 'Collapse', loadError: 'The data could not be loaded',
};

export function getKitStrings(locale: string | undefined): KitStrings {
    return locale === 'en' ? EN : ES;
}

export function formatKit(template: string, params?: Record<string, string | number>): string {
    return params ? template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? '')) : template;
}

export function useKitStrings(): KitStrings {
    const { locale } = useI18n();
    return getKitStrings(locale);
}
