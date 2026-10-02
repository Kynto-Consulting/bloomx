import { commonEn, commonEs, shellEn, shellEs } from './shell';
import { overviewEn, overviewEs } from './overview';
import { usersEn, usersEs } from './users';
import { mailEn, mailEs } from './mail';
import { extensionsEn, extensionsEs } from './extensions';
import { accountEn, accountEs } from './account';
import { profileEn, profileEs } from './profile';
import { transferEn, transferEs } from './transfer';
import { spamEn, spamEs } from './spam';
import { cliEn, cliEs } from './cli';
import { permsEn, permsEs } from './permissions';
import { billingEn, billingEs } from './billing';
import { developerEn, developerEs } from './developer';

/**
 * Diccionario de la consola de administracion: se monta en `admin.console` de es.ts / en.ts.
 * Un fichero por seccion para que varias personas trabajen sin pisarse:
 *   common+shell (armazon), overview (+ dominio), users (usuarios y cuentas vinculadas), mail, extensions,
 *   account (perfil, seguridad, auditoria, retencion, clave de firma).
 */
export const adminConsoleEs = {
    common: commonEs,
    shell: shellEs,
    overview: overviewEs,
    users: usersEs,
    mail: mailEs,
    extensions: extensionsEs,
    account: accountEs,
    profile: profileEs,
    transfer: transferEs,
    spam: spamEs,
    cli: cliEs,
    perms: permsEs,
    billing: billingEs,
    developer: developerEs,
} as const;

export const adminConsoleEn: import('./types').DeepString<typeof adminConsoleEs> = {
    common: commonEn,
    shell: shellEn,
    overview: overviewEn,
    users: usersEn,
    mail: mailEn,
    extensions: extensionsEn,
    account: accountEn,
    profile: profileEn,
    transfer: transferEn,
    spam: spamEn,
    cli: cliEn,
    perms: permsEn,
    billing: billingEn,
    developer: developerEn,
};
