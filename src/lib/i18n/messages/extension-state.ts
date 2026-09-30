/**
 * Textos de estado de las extensiones (namespace `extensionState`): fallo de carga con "Reintentar" (distinto de "sin extensiones")
 * y el enlace "Gestionar extensiones" de Ajustes. Se incorporan a es.ts / en.ts. `extensionStateEn` debe tener la forma de `extensionStateEs`.
 */
export const extensionStateEs = {
    loadError: {
        title: 'No se pudieron cargar las extensiones',
        body: 'Hubo un problema de conexión o del servidor. Esto no significa que no tengas extensiones: reintentamos automáticamente.',
        bodyStale: 'Se muestran las extensiones de la última carga correcta porque no se pudo actualizar. Reintentamos automáticamente.',
        retry: 'Reintentar',
        retrying: 'Reintentando…',
        inline: 'Las extensiones no se pudieron cargar. Reintentar',
    },
    settingsLink: {
        title: 'Gestionar extensiones',
        description: 'Activa o desactiva las extensiones instaladas, cambia su orden y revisa qué hacen y qué permisos piden.',
        open: 'Abrir Extensiones',
        adminTitle: 'Administración de extensiones',
        adminDescription: 'Instala, configura y marca extensiones como obligatorias para toda la organización.',
        openAdmin: 'Abrir la consola de administración',
        hint: 'Las extensiones que tu organización marca como obligatorias no se pueden desactivar.',
    },
};

export const extensionStateEn: typeof extensionStateEs = {
    loadError: {
        title: 'Extensions could not be loaded',
        body: 'There was a connection or server problem. This does not mean you have no extensions: we retry automatically.',
        bodyStale: 'Showing the extensions from the last successful load because they could not be refreshed. We retry automatically.',
        retry: 'Try again',
        retrying: 'Retrying…',
        inline: 'Extensions could not be loaded. Try again',
    },
    settingsLink: {
        title: 'Manage extensions',
        description: 'Turn installed extensions on or off, change their order and review what they do and which permissions they ask for.',
        open: 'Open Extensions',
        adminTitle: 'Extensions administration',
        adminDescription: 'Install, configure and mark extensions as mandatory for the whole organization.',
        openAdmin: 'Open the administration console',
        hint: 'Extensions your organization marks as mandatory cannot be turned off.',
    },
};
