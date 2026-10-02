/**
 * Ejemplos vivos de UI JSON para la galeria de componentes (`/extensions/components`) y el playground.
 *
 * REGLA: hay al menos un ejemplo por CADA componente de UI_COMPONENTS (lo verifica src/lib/expansions/__tests__/
 * ui-examples.test.ts: falla si se anade un componente al catalogo sin ejemplo) y todos validan sin errores con
 * validateUi + checkExpression. Son datos: sin colores ni estilos (solo props semanticas).
 *
 * Las expresiones leen `context.*` (correo de ejemplo, ver EXAMPLE_CONTEXT) y `state.*`. Las llamadas CALL_BACKEND usan
 * las funciones de EXAMPLE_BACKEND (simuladas: nunca se llama al backend real).
 */
import type { BackendScript } from './playground/simulate';

export interface UiExample {
    title: string;
    node: Record<string, any>;
}

type Node = Record<string, any>;
const n = (type: string, props?: Node, children?: Node[]): Node => {
    const out: Node = { type };
    if (props) out.props = props;
    if (children) out.children = children;
    return out;
};
const text = (content: string, props: Node = {}) => n('TEXT', { content, ...props });
const button = (label: string, props: Node = {}) => n('BUTTON', { label, ...props });
const toast = (message: string, tone = 'success') => ({ action: 'TOAST', message, tone });

// ------------------------------------------------------------------ contexto y backend de ejemplo
/** Correo de ejemplo que reciben los mounts de lectura/composer. */
export const EXAMPLE_CONTEXT: Record<string, any> = {
    extensionId: 'playground',
    subject: 'Reunion de seguimiento del proyecto',
    from: 'ana.garcia@example.com',
    fromName: 'Ana Garcia',
    to: ['yo@example.com'],
    cc: [],
    date: '2026-03-12T09:30:00.000Z',
    emailContent: 'Hola, te escribo para agendar la reunion de seguimiento del proyecto. Podemos vernos el jueves a las 10:00. Adjunto el resumen del trimestre. Saludos, Ana.',
    user: { name: 'Yo', email: 'yo@example.com' },
};

/** Overlays que usan los ejemplos con OPEN_OVERLAY (`context.overlays`). */
export const EXAMPLE_OVERLAYS: Record<string, Node> = {
    detalle: n('MODAL', { title: 'Detalle', description: 'Panel abierto con OPEN_OVERLAY', width: 'sm' }, [
        text('Este contenido vive en `overlays.detalle` del manifest.'),
        button('Cerrar', { variant: 'outline', onClick: { action: 'CLOSE_OVERLAY' } }),
    ]),
};

/** Guion por defecto del backend simulado: cubre las funciones que invocan los ejemplos. */
export const EXAMPLE_BACKEND: BackendScript = {
    getSummary: { result: { text: 'Ana propone reunirse el jueves a las 10:00 para revisar el trimestre.', score: 82 }, delayMs: 400 },
    getRows: {
        result: {
            rows: [
                { id: 1, name: 'Ana Garcia', email: 'ana.garcia@example.com', status: 'Activo', amount: 1250.5, created: '2026-01-15' },
                { id: 2, name: 'Luis Perez', email: 'luis.perez@example.com', status: 'Pendiente', amount: 320, created: '2026-02-03' },
                { id: 3, name: 'Marta Ruiz', email: 'marta.ruiz@example.com', status: 'Inactivo', amount: 0, created: '2026-02-21' },
            ],
        },
        delayMs: 300,
    },
    saveNote: { result: { saved: true, id: 'nota-1' }, delayMs: 300 },
    flaky: { error: 'Servicio no disponible (simulado)', times: 1, result: { ok: true } },
    alwaysFails: { error: 'Error permanente simulado' },
};

const TABLE_ROWS = [
    { id: 1, name: 'Ana Garcia', status: 'Activo', amount: 1250.5, created: '2026-01-15' },
    { id: 2, name: 'Luis Perez', status: 'Pendiente', amount: 320, created: '2026-02-03' },
    { id: 3, name: 'Marta Ruiz', status: 'Inactivo', amount: 0, created: '2026-02-21' },
];

const OPTIONS = [
    { value: 'low', label: 'Baja' },
    { value: 'normal', label: 'Normal', description: 'Valor por defecto' },
    { value: 'high', label: 'Alta' },
];

// ------------------------------------------------------------------ ejemplos
export const UI_EXAMPLES: Record<string, UiExample[]> = {
    // ---- Layout
    STACK: [{ title: 'Apilar con espacio y alineacion', node: n('STACK', { gap: 3 }, [text('Primero', { weight: 'semibold' }), text('Segundo', { variant: 'muted' }), button('Accion', { variant: 'outline', size: 'sm' })]) }],
    ROW: [{ title: 'Fila con distribucion entre extremos', node: n('ROW', { gap: 2, justify: 'between' }, [text('Asunto', { weight: 'semibold' }), n('BADGE', { label: 'Nuevo', tone: 'info' })]) }],
    GRID: [{ title: 'Rejilla de 3 columnas', node: n('GRID', { columns: 3, gap: 3 }, [n('STAT', { label: 'Recibidos', value: '128' }), n('STAT', { label: 'Sin leer', value: '7', tone: 'warning' }), n('STAT', { label: 'Enviados', value: '42', tone: 'success' })]) }],
    CARD: [
        { title: 'Tarjeta con titulo y pie', node: n('CARD', { title: 'Resumen', description: 'Correo abierto', icon: 'Mail', footer: [button('Responder', { size: 'sm' })] }, [text('${context.subject}'), text('De: ${context.from}', { variant: 'muted' })]) },
        { title: 'Tarjeta con acento de intencion', node: n('CARD', { title: 'Atencion', tone: 'warning', variant: 'elevated', density: 'compact' }, [text('Revisa los adjuntos antes de enviar.')]) },
    ],
    PAGE_HEADER: [
        { title: 'Cabecera de pagina con migas, estado y acciones', node: n('PAGE_HEADER', { title: 'Metricas del dominio', description: 'Resumen de actividad de los ultimos 14 dias', icon: 'ChartColumn', breadcrumbs: [{ label: 'Inicio', url: '/' }, { label: 'Metricas' }], status: { label: 'En vivo', tone: 'success' }, actions: [button('Actualizar', { variant: 'outline', icon: 'RefreshCw', onClick: { action: 'REFRESH' } }), n('MENU', { label: 'Mas', items: [{ label: 'Exportar', icon: 'Download', onClick: toast('Exportando', 'info') }] })] }) },
        { title: 'Estado de error con Reintentar', node: n('PAGE_HEADER', { title: 'Notas rapidas', error: 'No se pudieron cargar las notas', onRetry: toast('Reintentando', 'info') }) },
    ],
    SPLIT_PANE: [{ title: 'Lista y detalle redimensionables', node: n('SPLIT_PANE', { ratio: '1:2', resizable: true, startLabel: 'Lista', endLabel: 'Detalle', startPane: [n('LIST', { variant: 'divided' }, [n('LIST_ITEM', { title: 'Ana Garcia', description: 'Gerente' }), n('LIST_ITEM', { title: 'Luis Perez', description: 'Ventas' })])], endPane: [n('CARD', { title: 'Detalle' }, [text('Selecciona un elemento de la lista.', { variant: 'muted' })])] }) }],
    SECTION: [{ title: 'Seccion plegable', node: n('SECTION', { title: 'Detalles', description: 'Pulsa para plegar', collapsible: true, defaultOpen: true, gap: 2 }, [text('Contenido de la seccion.'), text('Segundo parrafo.', { variant: 'muted' })]) }],
    DIVIDER: [{ title: 'Separador con etiqueta', node: n('STACK', { gap: 1 }, [text('Arriba'), n('DIVIDER', { label: 'o' }), text('Abajo')]) }],
    SPACER: [{ title: 'Espacio de la escala', node: n('STACK', { gap: 0 }, [text('Antes'), n('SPACER', { size: 6 }), text('Despues (24 px mas abajo)')]) }],

    // ---- Tipografia
    TEXT: [
        { title: 'Variantes y tonos', node: n('STACK', { gap: 1 }, [text('Texto por defecto'), text('Texto atenuado', { variant: 'muted' }), text('Correcto', { tone: 'success', weight: 'semibold' }), text('Peligro', { tone: 'danger' }), text('Cita del correo', { variant: 'quote' })]) },
        { title: 'Expresion con filtros', node: text('${context.subject | upper | truncate:30}', { mono: true, lines: 1 }) },
    ],
    HEADING: [{ title: 'Niveles de encabezado', node: n('STACK', { gap: 1 }, [n('HEADING', { content: 'Titulo principal', level: 2 }), n('HEADING', { content: 'Subtitulo', level: 4, tone: 'primary' })]) }],
    CODE: [{ title: 'Bloque copiable', node: n('CODE', { content: '{ "action": "TOAST", "message": "Hola" }', block: true, copyable: true, language: 'json' }) }],
    LINK: [{ title: 'Enlace y enlace con accion', node: n('ROW', { gap: 4 }, [n('LINK', { label: 'Documentacion', url: 'https://example.com/docs' }), n('LINK', { label: 'Mostrar aviso', tone: 'neutral', onClick: toast('Enlace pulsado', 'info') })]) }],
    MARKDOWN: [{ title: 'Markdown seguro', node: n('MARKDOWN', { content: '**Negrita**, *cursiva* y `codigo`.\n\n- Elemento uno\n- Elemento dos\n\n[Enlace](https://example.com)' }) }],
    ICON: [{ title: 'Iconos por tono y tamano', node: n('ROW', { gap: 3 }, [n('ICON', { name: 'Mail', size: 'lg' }), n('ICON', { name: 'Check', tone: 'success', label: 'Correcto' }), n('ICON', { name: 'AlertTriangle', tone: 'warning', size: 'xl' })]) }, { title: 'Logotipos de apps (brand:) e iniciales', node: n('ROW', { gap: 3 }, [n('ICON', { name: 'brand:zoom', size: 'xl', label: 'Zoom' }), n('ICON', { name: 'brand:googlemeet', size: 'xl', label: 'Google Meet' }), n('ICON', { name: 'brand:notion', size: 'xl', label: 'Notion' }), n('ICON', { name: 'initials:AB', size: 'xl', label: 'AB' })]) }],

    // ---- Acciones
    BUTTON: [
        { title: 'Tonos y variantes', node: n('ROW', { gap: 2, wrap: true }, [button('Principal', { onClick: toast('Principal') }), button('Suave', { variant: 'soft', tone: 'info' }), button('Borde', { variant: 'outline' }), button('Fantasma', { variant: 'ghost' }), button('Enlace', { variant: 'link' }), button('Eliminar', { tone: 'danger', icon: 'Trash2' })]) },
        { title: 'Carga automatica con CALL_BACKEND', node: button('Resumir correo', { icon: 'Sparkles', loading: '${state.$loading.getSummary}', onClick: { action: 'CALL_BACKEND', function: 'getSummary', args: { text: '${context.emailContent}' }, resultKey: 'summary', onSuccess: toast('Resumen listo') } }) },
    ],
    ICON_BUTTON: [{ title: 'Boton de icono (label obligatorio)', node: n('ROW', { gap: 1 }, [n('ICON_BUTTON', { icon: 'Copy', label: 'Copiar asunto', onClick: { action: 'COPY_TO_CLIPBOARD', text: '${context.subject}', successMessage: 'Asunto copiado' } }), n('ICON_BUTTON', { icon: 'Trash2', label: 'Eliminar', tone: 'danger', variant: 'soft' })]) }],
    BUTTON_GROUP: [{ title: 'Botones unidos', node: n('BUTTON_GROUP', { attached: true }, [button('Dia', { variant: 'outline' }), button('Semana', { variant: 'outline' }), button('Mes', { variant: 'outline' })]) }],
    MENU: [{ title: 'Menu de acciones', node: n('MENU', { label: 'Acciones', icon: 'MoreHorizontal', items: [{ label: 'Copiar asunto', icon: 'Copy', onClick: { action: 'COPY_TO_CLIPBOARD', text: '${context.subject}' } }, { separator: true }, { label: 'Eliminar', icon: 'Trash2', tone: 'danger', onClick: toast('Eliminado', 'warning') }] }) }],
    IMAGE_BUTTON: [{ title: 'Imagen pulsable', node: n('IMAGE_BUTTON', { src: 'https://example.com/banner.png', alt: 'Banner de ejemplo', onClick: toast('Imagen pulsada', 'info') }) }],
    SMART_REPLY_CHIPS: [{ title: 'Sugerencias desde el estado', node: n('SMART_REPLY_CHIPS', { suggestions: ['Gracias, me parece bien', 'El jueves me va perfecto', 'Puedes proponer otra hora?'], onSelect: { action: 'INSERT_CONTENT', content: '${value}' } }) }],

    // ---- Entradas
    INPUT: [{ title: 'Campo enlazado con `bind`', node: n('STACK', { gap: 2 }, [n('INPUT', { label: 'Correo', type: 'email', bind: 'email', placeholder: 'nombre@empresa.com', helperText: 'Se guarda en state.email', rules: { required: true, email: true } }), text('Escribiste: ${state.email | default:"(vacio)"}', { variant: 'muted' })]) }],
    TEXTAREA: [{ title: 'Texto multilinea con contador', node: n('TEXTAREA', { label: 'Nota', bind: 'note', rows: 3, maxLength: 200, rules: { maxLength: 200 } }) }],
    SELECT: [{ title: 'Lista con onChange', node: n('SELECT', { label: 'Prioridad', bind: 'priority', options: OPTIONS, onChange: toast('Prioridad: ${value}', 'info') }) }],
    CHECKBOX: [{ title: 'Casilla enlazada', node: n('STACK', { gap: 1 }, [n('CHECKBOX', { label: 'Acepto las condiciones', bind: 'accepted' }), text('${state.accepted ? "Aceptado" : "Pendiente"}', { variant: 'muted' })]) }],
    RADIO_GROUP: [{ title: 'Opciones excluyentes', node: n('RADIO_GROUP', { label: 'Tono de la respuesta', bind: 'tone', options: [{ value: 'formal', label: 'Formal' }, { value: 'casual', label: 'Cercano' }], orientation: 'horizontal', defaultValue: 'formal' }) }],
    TOGGLE: [{ title: 'Interruptor', node: n('TOGGLE', { label: 'Firmar automaticamente', bind: 'autosign', helperText: 'Activa o desactiva la firma' }) }],
    SLIDER: [{ title: 'Deslizante con valor', node: n('SLIDER', { label: 'Longitud del resumen', bind: 'length', min: 1, max: 10, step: 1, defaultValue: 3 }) }],
    DATE_PICKER: [{ title: 'Fecha con limites', node: n('DATE_PICKER', { label: 'Fecha de entrega', bind: 'due', min: '2026-01-01', max: '2026-12-31' }) }],
    TIME_PICKER: [{ title: 'Hora', node: n('TIME_PICKER', { label: 'Hora de la reunion', bind: 'time', step: 900 }) }],
    COLOR_PICKER: [{ title: 'Color de un dato del usuario (etiqueta)', node: n('COLOR_PICKER', { label: 'Color de la etiqueta', bind: 'labelColor', defaultValue: '#3b82f6' /* theme-lint-ignore: hex del DATO de usuario, no estiliza la UI */ }) }],
    FILE_INPUT: [{ title: 'Seleccion con limite de tamano', node: n('FILE_INPUT', { label: 'Adjunto', accept: 'image/*,.pdf', maxSizeMb: 2, multiple: true, bind: 'files', onSelect: toast('Archivos elegidos', 'info') }) }],
    TAG_INPUT: [{ title: 'Destinatarios como etiquetas', node: n('TAG_INPUT', { label: 'Copia a', bind: 'cc', validate: 'email', max: 5, suggestions: ['ana@example.com', 'luis@example.com'], placeholder: 'Escribe y pulsa Enter' }) }],
    CONTACT_PICKER: [{ title: 'Contactos propios', node: n('CONTACT_PICKER', { label: 'Invitados', bind: 'guests', contacts: [{ name: 'Ana Garcia', email: 'ana@example.com' }, { name: 'Luis Perez', email: 'luis@example.com' }] }) }],
    FORM: [{
        title: 'Formulario con validacion y backend simulado',
        node: n('FORM', {
            fields: [
                { name: 'title', label: 'Titulo', type: 'text', required: true, rules: { minLength: 3, message: 'Minimo 3 caracteres' } },
                { name: 'priority', label: 'Prioridad', type: 'select', options: OPTIONS },
                { name: 'notify', label: 'Avisar por correo', type: 'toggle' },
            ],
            submitLabel: 'Guardar nota',
            successMessage: 'Nota guardada',
            resetOnSuccess: true,
            validateOn: 'blur',
            onSubmit: { action: 'CALL_BACKEND', function: 'saveNote', resultKey: 'saved' },
        }),
    }],

    // ---- Datos
    TABLE: [
        { title: 'Tabla con orden, formato y acciones', node: n('TABLE', { caption: 'Contactos', rowKey: 'id', data: TABLE_ROWS, pageSize: 0, columns: [{ key: 'name', label: 'Nombre', sortable: true }, { key: 'status', label: 'Estado', format: 'badge' }, { key: 'amount', label: 'Importe', format: 'number', align: 'end', sortable: true }, { key: 'created', label: 'Alta', format: 'date' }], actions: [{ label: 'Ver', icon: 'Eye', onClick: toast('Fila: ${row.name}', 'info') }], onRowClick: toast('Abriste ${row.name}', 'info') }) },
        { title: 'Filas desde el backend simulado', node: n('STACK', { gap: 2 }, [button('Cargar filas', { variant: 'outline', onClick: { action: 'CALL_BACKEND', function: 'getRows', resultKey: 'rows' } }), n('TABLE', { data: '${state.rows.rows}', loading: '${state.$loading.getRows}', emptyText: 'Pulsa "Cargar filas"', columns: [{ key: 'name', label: 'Nombre' }, { key: 'email', label: 'Correo' }, { key: 'status', label: 'Estado', format: 'badge' }] })]) },
        { title: 'Busqueda, filtro por columna, estado y acciones masivas', node: n('TABLE', { caption: 'Tareas', rowKey: 'id', searchable: true, pageSize: 5, selectable: 'multiple', bind: 'picked', defaultSort: { key: 'created', dir: 'desc' }, data: [{ id: 1, name: 'Revisar informe', status: 'Abierta', url: 'https://example.com/1', created: '2026-03-01' }, { id: 2, name: 'Enviar resumen', status: 'Hecha', url: 'https://example.com/2', created: '2026-03-04' }, { id: 3, name: 'Llamar a Luis', status: 'Abierta', url: '/', created: '2026-03-07' }], columns: [{ key: 'name', label: 'Tarea', format: 'link', hrefKey: 'url', sortable: true }, { key: 'status', label: 'Estado', format: 'status', filter: true, toneMap: { Abierta: 'warning', Hecha: 'success' } }, { key: 'created', label: 'Creada', format: 'date', sortable: true }], bulkActions: [{ label: 'Archivar', icon: 'Archive', onClick: toast('Archivadas: ${value}', 'info') }] }) },
        { title: 'Estado de error con Reintentar', node: n('TABLE', { columns: [{ key: 'name', label: 'Nombre' }], data: [], error: 'No se pudo cargar la tabla', onRetry: toast('Reintentando', 'info') }) },
        { title: 'Seleccion multiple enlazada', node: n('TABLE', { data: TABLE_ROWS, rowKey: 'id', selectable: 'multiple', bind: 'selected', density: 'compact', columns: [{ key: 'name', label: 'Nombre' }, { key: 'status', label: 'Estado' }] }) },
    ],
    TIMELINE: [{ title: 'Eventos con fecha, icono y tono', node: n('TIMELINE', { items: [{ title: 'Correo enviado', description: 'A ana.garcia@example.com', time: '2026-03-12T09:30:00.000Z', icon: 'Send', tone: 'success' }, { title: 'Respuesta recibida', time: '2026-03-12T11:05:00.000Z', icon: 'Mail', tone: 'info' }, { title: 'Reunion agendada', description: 'Jueves a las 10:00', time: 'Jueves', icon: 'Calendar' }] }) }],
    TREE: [{ title: 'Arbol de carpetas con seleccion', node: n('STACK', { gap: 2 }, [n('TREE', { label: 'Carpetas', bind: 'folderSel', defaultExpanded: 1, items: [{ id: 'inbox', label: 'Entrada', icon: 'Inbox', badge: '3' }, { id: 'projects', label: 'Proyectos', icon: 'Folder', children: [{ id: 'p-a', label: 'Proyecto A' }, { id: 'p-b', label: 'Proyecto B', children: [{ id: 'p-b-1', label: 'Facturas' }] }] }, { id: 'archive', label: 'Archivo', icon: 'Archive' }] }), text('Elegido: ${state.folderSel | default:"(ninguno)"}', { variant: 'muted' })]) }],
    LIST: [
        { title: 'Lista con plantilla por dato', node: n('LIST', { variant: 'divided', items: [{ title: 'Ana Garcia', subtitle: 'Gerente' }, { title: 'Luis Perez', subtitle: 'Ventas' }], itemTemplate: n('LIST_ITEM', { title: '${item.title}', description: '${item.subtitle}', icon: 'User' }) }) },
        { title: 'Lista con hijos LIST_ITEM', node: n('LIST', { variant: 'cards' }, [n('LIST_ITEM', { title: 'Reunion el jueves', meta: '10:00', icon: 'Calendar' }), n('LIST_ITEM', { title: 'Enviar resumen', meta: 'Hoy', tone: 'warning' })]) },
    ],
    LIST_ITEM: [{ title: 'Elemento con icono y accion final', node: n('LIST_ITEM', { title: 'Informe trimestral', description: 'Actualizado hace 2 h', meta: '2 MB', icon: 'FileText', selected: false, onClick: toast('Abriendo informe', 'info') }, [n('BADGE', { label: 'PDF', tone: 'neutral' })]) }],

    // ---- Navegacion
    STEPPER: [{ title: 'Pasos de un proceso', node: n('STEPPER', { current: 1, steps: [{ title: 'Datos', description: 'Nombre y correo' }, { title: 'Revision' }, { title: 'Confirmacion' }] }) }],
    TABS: [{ title: 'Pestanas con estado enlazado', node: n('TABS', { bind: 'tab', variant: 'underline', tabs: [{ label: 'General', value: 'general', content: [text('Contenido de General')] }, { label: 'Avanzado', value: 'advanced', icon: 'Settings', content: [text('Contenido de Avanzado')] }] }) }],
    TAB_ITEM: [{ title: 'Forma heredada: TABS con hijos TAB_ITEM', node: n('TABS', { value: 'uno' }, [n('TAB_ITEM', { label: 'Uno', value: 'uno' }, [text('Primer panel')]), n('TAB_ITEM', { label: 'Dos', value: 'dos' }, [text('Segundo panel')])]) }],
    ACCORDION: [{ title: 'Secciones plegables', node: n('ACCORDION', { multiple: false, sections: [{ title: 'Que es esto?', defaultOpen: true, content: [text('Un acordeon accesible.')] }, { title: 'Como se usa?', content: [text('Enter o Espacio para abrir.')] }] }) }],
    ACCORDION_ITEM: [{ title: 'Forma heredada: ACCORDION con ACCORDION_ITEM', node: n('ACCORDION', undefined, [n('ACCORDION_ITEM', { title: 'Primera' }, [text('Contenido uno')]), n('ACCORDION_ITEM', { title: 'Segunda' }, [text('Contenido dos')])]) }],
    WIZARD: [{
        title: 'Asistente de 3 pasos',
        node: n('WIZARD', {
            nav: 'auto', finishLabel: 'Crear', onFinish: toast('Asistente completado'),
            steps: [
                { title: 'Datos', description: 'Nombre', content: [n('INPUT', { label: 'Nombre', bind: 'wizName' })] },
                { title: 'Opciones', content: [n('TOGGLE', { label: 'Notificarme', bind: 'wizNotify' })] },
                { title: 'Resumen', content: [text('Nombre: ${state.wizName | default:"(sin nombre)"}')] },
            ],
        }),
    }],

    // ---- Feedback
    BADGE: [{ title: 'Tonos y variantes', node: n('ROW', { gap: 2, wrap: true }, [n('BADGE', { label: 'Neutral' }), n('BADGE', { label: 'Exito', tone: 'success' }), n('BADGE', { label: 'Aviso', tone: 'warning', variant: 'outline' }), n('BADGE', { label: 'Error', tone: 'danger', variant: 'solid' }), n('BADGE', { label: 'Info', tone: 'info', size: 'sm' })]) }],
    CHIP: [{ title: 'Chip seleccionable y eliminable', node: n('ROW', { gap: 2 }, [n('CHIP', { label: 'Filtro', icon: 'Filter', selected: true, onClick: toast('Filtro', 'info') }), n('CHIP', { label: 'Etiqueta', removable: true, onRemove: toast('Quitada', 'warning') })]) }],
    AVATAR: [{ title: 'Iniciales y tamanos', node: n('ROW', { gap: 2 }, [n('AVATAR', { name: 'Ana Garcia', size: 'sm' }), n('AVATAR', { name: '${context.fromName}', tone: 'primary' }), n('AVATAR', { initials: 'LP', size: 'lg', tone: 'success' })]) }],
    STAT: [{ title: 'Metrica con variacion', node: n('GRID', { columns: 2, gap: 3 }, [n('STAT', { label: 'Ingresos', value: '1.250 EUR', delta: '+12 %', trend: 'up', icon: 'TrendingUp', description: 'frente al mes anterior' }), n('STAT', { label: 'Bajas', value: '8', delta: '+2', trend: 'down' })]) }],
    PROGRESS: [{ title: 'Progreso determinado e indeterminado', node: n('STACK', { gap: 3 }, [n('PROGRESS', { label: 'Sincronizacion', value: 65, tone: 'primary' }), n('PROGRESS', { label: 'Procesando...', indeterminate: true, tone: 'info', size: 'sm' })]) }],
    KPI_CARD: [{ title: 'Indicadores con variacion y mini-tendencia', node: n('GRID', { columns: 3, gap: 3 }, [n('KPI_CARD', { label: 'Recibidos', value: '1.284', delta: '+8 %', trend: 'up', icon: 'Inbox', sparkline: [3, 5, 4, 8, 6, 9, 12, 10], description: 'ultimos 14 dias' }), n('KPI_CARD', { label: 'Spam bloqueado', value: '96', delta: '-12 %', trend: 'down', invertTrend: true, icon: 'ShieldAlert' }), n('KPI_CARD', { label: 'Cargando', loading: true })]) }],
    SKELETON: [{ title: 'Marcadores de carga', node: n('ROW', { gap: 3, align: 'start' }, [n('SKELETON', { variant: 'circle', size: 'lg' }), n('SKELETON', { variant: 'text', lines: 3 })]) }],
    EMPTY: [{ title: 'Estado vacio con accion', node: n('EMPTY', { icon: 'Inbox', title: 'Sin resultados', description: 'Prueba otro filtro o crea el primer elemento.', actionLabel: 'Crear', action: toast('Crear', 'info') }) }],
    ALERT: [{ title: 'Avisos por intencion', node: n('STACK', { gap: 2 }, [n('ALERT', { tone: 'info', title: 'Informacion', message: 'Tu correo se guardo como borrador.' }), n('ALERT', { tone: 'warning', message: 'Falta el asunto.', dismissible: true }), n('ALERT', { tone: 'danger', title: 'Error', message: 'No se pudo enviar.' })]) }],
    CALLOUT: [{ title: 'Nota destacada con hijos', node: n('CALLOUT', { tone: 'success', title: 'Consejo', icon: 'Lightbulb' }, [text('Usa `tone` en lugar de colores: el tema garantiza el contraste.')]) }],
    LOADING: [{ title: 'Indicador de carga', node: n('LOADING', { label: 'Cargando correos...', size: 'md' }) }],

    // ---- Overlays
    MODAL: [
        { title: 'Dialogo propio con `bind`', node: n('STACK', { gap: 2 }, [button('Abrir dialogo', { onClick: { action: 'SET_STATE', key: 'dlg', value: true } }), n('MODAL', { bind: 'dlg', title: 'Confirmar envio', description: 'Esta accion no se puede deshacer', width: 'sm', footer: [button('Cancelar', { variant: 'outline', onClick: { action: 'SET_STATE', key: 'dlg', value: false } }), button('Enviar', { onClick: [toast('Enviado'), { action: 'SET_STATE', key: 'dlg', value: false }] })] }, [text('Se enviara el correo a ${context.from}.')])]) },
        { title: 'Overlay del manifest con OPEN_OVERLAY', node: button('Abrir panel', { variant: 'outline', onClick: { action: 'OPEN_OVERLAY', targetId: 'detalle' } }) },
    ],
    DRAWER: [{ title: 'Panel lateral con `bind`', node: n('STACK', { gap: 2 }, [button('Abrir panel', { variant: 'outline', onClick: { action: 'SET_STATE', key: 'drw', value: true } }), n('DRAWER', { bind: 'drw', title: 'Ajustes', side: 'right', width: 'sm', footer: [button('Cerrar', { onClick: { action: 'SET_STATE', key: 'drw', value: false } })] }, [n('TOGGLE', { label: 'Notificaciones', bind: 'notif' })])]) }],
    POPOVER: [{ title: 'Contenido flotante', node: n('POPOVER', { triggerLabel: 'Mas informacion', title: 'Detalle', align: 'start' }, [text('Contenido anclado al boton.'), n('LINK', { label: 'Ver todo', url: '/' })]) }],
    TOOLTIP: [{ title: 'Ayuda al enfocar o pasar el raton', node: n('TOOLTIP', { text: 'Copia el asunto al portapapeles' }, [n('ICON_BUTTON', { icon: 'Copy', label: 'Copiar' })]) }],

    // ---- Graficos
    BAR_CHART: [{ title: 'Barras verticales', node: n('BAR_CHART', { title: 'Correos por dia', height: 'md', showValues: true, data: [{ label: 'Lun', value: 12 }, { label: 'Mar', value: 19 }, { label: 'Mie', value: 7, tone: 'warning' }, { label: 'Jue', value: 15 }, { label: 'Vie', value: 9, tone: 'success' }] }) }],
    CHART: [
        { title: 'Lineas con varias series', node: n('CHART', { kind: 'line', title: 'Correos por dia', labels: ['Lun', 'Mar', 'Mie', 'Jue', 'Vie'], series: [{ label: 'Recibidos', data: [12, 19, 7, 15, 9] }, { label: 'Enviados', data: [5, 8, 4, 9, 6], tone: 'success' }], unit: 'correos' }) },
        { title: 'Barras apiladas', node: n('CHART', { kind: 'bar', stacked: true, labels: ['Lun', 'Mar', 'Mie'], series: [{ label: 'Entrada', data: [10, 14, 9] }, { label: 'Spam', data: [3, 2, 6], tone: 'danger' }], height: 'sm' }) },
        { title: 'Area y anillo', node: n('ROW', { gap: 4, align: 'start', wrap: true }, [n('CHART', { kind: 'area', labels: ['A', 'B', 'C', 'D'], series: [{ label: 'Carga', data: [2, 6, 4, 9], tone: 'info' }] }), n('CHART', { kind: 'donut', centerLabel: '100', data: [{ label: 'Activos', value: 60, tone: 'success' }, { label: 'Pendientes', value: 40, tone: 'warning' }] })]) },
    ],
    SPARKLINE: [{ title: 'Tendencia con area', node: n('SPARKLINE', { values: [3, 5, 4, 8, 6, 9, 12, 10], area: true, tone: 'success', height: 'md', label: 'Tendencia de 8 dias' }) }],
    DONUT: [{ title: 'Proporciones con leyenda', node: n('DONUT', { title: 'Por estado', centerLabel: '100', data: [{ label: 'Activos', value: 60, tone: 'success' }, { label: 'Pendientes', value: 25, tone: 'warning' }, { label: 'Inactivos', value: 15, tone: 'danger' }] }) }],

    // ---- Logica
    CONDITIONAL: [{ title: 'Mostrar segun el estado', node: n('STACK', { gap: 2 }, [n('TOGGLE', { label: 'Modo avanzado', bind: 'advanced' }), n('CONDITIONAL', { condition: '${state.advanced}', true: [n('ALERT', { tone: 'warning', message: 'Modo avanzado activado' })], false: [text('Modo basico', { variant: 'muted' })] })]) }],
    CONDITION: [{ title: 'Con `if` y `else`', node: n('STACK', { gap: 2 }, [n('INPUT', { label: 'Escribe algo', bind: 'q' }), n('CONDITION', { if: '${state.q}', true: [text('Buscando "${state.q}"')], else: [text('Escribe para buscar', { variant: 'muted' })] })]) }],
    FOR_EACH: [{ title: 'Repetir una plantilla', node: n('FOR_EACH', { items: '${context.to}', as: 'dest', index: 'i', template: n('ROW', { gap: 2 }, [n('BADGE', { label: '${i + 1}' }), text('${dest}')]), empty: text('Sin destinatarios') }) }],
    REPEAT: [{ title: 'Repetir hijos N veces', node: n('REPEAT', { count: 3 }, [n('SKELETON', { variant: 'text' })]) }],
    SWITCH: [{ title: 'Elegir un caso', node: n('STACK', { gap: 2 }, [n('SELECT', { label: 'Vista', bind: 'view', options: [{ value: 'list', label: 'Lista' }, { value: 'grid', label: 'Rejilla' }] }), n('SWITCH', { value: '${state.view}', cases: { list: [text('Vista de lista')], grid: [text('Vista de rejilla')] }, default: [text('Elige una vista', { variant: 'muted' })] })]) }],
    CASE: [{ title: 'Forma con hijos CASE/DEFAULT', node: n('SWITCH', { value: 'b' }, [n('CASE', { value: 'a' }, [text('Caso A')]), n('CASE', { value: 'b' }, [text('Caso B (activo)')]), n('DEFAULT', undefined, [text('Otro')])]) }],
    DEFAULT: [{ title: 'Caso por defecto', node: n('SWITCH', { value: 'z' }, [n('CASE', { value: 'a' }, [text('Caso A')]), n('DEFAULT', undefined, [text('Ningun caso coincide: se muestra DEFAULT')])]) }],
    SET_VAR: [{ title: 'Variable invisible de state', node: n('STACK', { gap: 1 }, [n('SET_VAR', { name: 'greeting', value: 'Hola, ${context.fromName}' }), text('${state.greeting}')]) }],
    HEADLESS: [{ title: 'Sin interfaz: solo ejecuta onLoad', node: n('HEADLESS', { onLoad: toast('HEADLESS ejecuto onLoad', 'info') }) }],
    DEBUG: [{ title: 'Solo desarrollo: contexto y estado', node: n('DEBUG') }],
};

/** Ejemplos de la cabecera del playground: [{id, title, group, text}] (un nodo = un ejemplo). */
export function flattenExamples(): Array<{ id: string; type: string; title: string; node: Node }> {
    const out: Array<{ id: string; type: string; title: string; node: Node }> = [];
    for (const type of Object.keys(UI_EXAMPLES)) {
        UI_EXAMPLES[type].forEach((example, index) => out.push({ id: `${type}:${index}`, type, title: example.title, node: example.node }));
    }
    return out;
}
