/**
 * Textos de la pestana "Grupos de correo" de Ajustes (namespace `mailGroups`, componente MailGroupsSettings).
 * `mailGroupsEn` debe tener la forma de `mailGroupsEs`.
 */
export const mailGroupsEs = {
    title: 'Grupos de correo',
    help: 'Crea alias como @ventas o @direccion y se expandirán a sus miembros al redactar.',
    add: 'Añadir grupo',
    empty: 'Aún no hay alias. Añade uno y usa las sugerencias de contactos para armar los miembros.',
    aliasLabel: 'Alias del grupo',
    aliasPlaceholder: '@equipo',
    remove: 'Quitar',
    removeGroup: 'Quitar el grupo {alias}',
    removeGroupUnnamed: 'Quitar el grupo nuevo',
    membersLabel: 'Miembros de {alias}',
    membersUnnamed: 'Miembros del grupo nuevo',
    addRecipients: 'Añadir destinatarios',
};

export const mailGroupsEn: typeof mailGroupsEs = {
    title: 'Mail groups',
    help: 'Create aliases like @sales or @leadership and they expand to their members inside compose.',
    add: 'Add group',
    empty: 'No aliases yet. Add one and use contact suggestions to assemble the members.',
    aliasLabel: 'Group alias',
    aliasPlaceholder: '@team',
    remove: 'Remove',
    removeGroup: 'Remove group {alias}',
    removeGroupUnnamed: 'Remove the new group',
    membersLabel: 'Members of {alias}',
    membersUnnamed: 'Members of the new group',
    addRecipients: 'Add recipients',
};
