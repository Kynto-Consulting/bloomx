/**
 * Textos del modo heredado (namespace `legacyMode`): insignias de fuente de credenciales y banner de modo sin firma.
 * Se incorporan a es.ts / en.ts. `legacyModeEn` debe tener exactamente la forma de `legacyModeEs`.
 */
export const legacyModeEs = {
    sources: {
        label: 'Fuente activa',
        domain: 'Credenciales del dominio',
        legacy: 'Credenciales heredadas del dominio',
        serverEnv: 'Usando credenciales del servidor (modo heredado)',
        missing: 'Sin configurar',
    },
    move: {
        button: 'Mover a credenciales del dominio',
        busy: 'Moviendo...',
        done: 'Se movieron {count} credencial(es) a las credenciales del dominio.',
        nothing: 'No había credenciales heredadas que mover.',
        serverEnvOnly: 'Las credenciales del servidor no se pueden copiar porque el valor nunca sale del backend. Escribe el valor de tu dominio en el campo para reemplazarlas.',
        failed: 'No se pudieron mover las credenciales.',
        hint: 'Copia cifradas al dominio las credenciales heredadas de esta extensión. No borra nada del modo heredado.',
    },
    banner: {
        title: 'Modo heredado sin firma',
        body: 'Este dominio usa el modo heredado sin firma: registra tu clave de firma para activar la protección.',
        howTo: 'Genera el par de claves con `node scripts/gen-domain-keypair.mjs`, guarda la privada en BLOOMX_DOMAIN_PRIVATE_KEY y registra la pública.',
        docsLink: 'Cómo registrar la clave de firma',
        requireTitle: 'Protección activa: firma obligatoria',
        requireBody: 'La clave de firma está registrada. Puedes exigir la firma para rechazar definitivamente el modo heredado.',
        requireButton: 'Exigir firma',
        requireBusy: 'Activando...',
        requireOn: 'Firma exigida: el modo heredado está rechazado para este dominio.',
        requireDisable: 'Desactivar exigencia de firma',
        requireFailed: 'No se pudo cambiar la exigencia de firma.',
        loadFailed: 'No se pudo consultar el estado de la clave de firma.',
        dismiss: 'Ocultar aviso',
    },
} as const;

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };

export const legacyModeEn: Shape<typeof legacyModeEs> = {
    sources: {
        label: 'Active source',
        domain: 'Domain credentials',
        legacy: 'Legacy domain credentials',
        serverEnv: 'Using server credentials (legacy mode)',
        missing: 'Not configured',
    },
    move: {
        button: 'Move to domain credentials',
        busy: 'Moving...',
        done: '{count} credential(s) moved to domain credentials.',
        nothing: 'There were no legacy credentials to move.',
        serverEnvOnly: 'Server credentials cannot be copied because the value never leaves the backend. Type your domain\'s value in the field to replace them.',
        failed: 'Could not move the credentials.',
        hint: 'Copies this extension\'s legacy credentials to the domain, encrypted. Nothing is deleted from legacy mode.',
    },
    banner: {
        title: 'Legacy mode without signature',
        body: 'This domain uses legacy mode without a signature: register your signing key to enable protection.',
        howTo: 'Generate the key pair with `node scripts/gen-domain-keypair.mjs`, store the private key in BLOOMX_DOMAIN_PRIVATE_KEY and register the public one.',
        docsLink: 'How to register the signing key',
        requireTitle: 'Protection on: signature required',
        requireBody: 'The signing key is registered. You can require signatures to permanently reject legacy mode.',
        requireButton: 'Require signature',
        requireBusy: 'Enabling...',
        requireOn: 'Signature required: legacy mode is rejected for this domain.',
        requireDisable: 'Stop requiring signatures',
        requireFailed: 'Could not change the signature requirement.',
        loadFailed: 'Could not check the signing key status.',
        dismiss: 'Dismiss notice',
    },
};
