// Definiciones SQL de la bandeja compartidas entre el DDL (db/schema.ts) y las consultas (mail-list-sql.ts).
// Solo cadenas: sin Prisma ni red. NO CAMBIAR el cuerpo de `bloomx_sender_key`: el indice de expresion depende de el
// (si algun dia hace falta otra regla, se crea `bloomx_sender_key2` y un indice nuevo).

/** Grupos de letras con marcas -> letra base. Se aplican mayusculas y minusculas: no depende de la configuracion regional de la BD. */
const ACCENT_GROUPS: Array<[string, string]> = [
    ['a', 'ÁÀÂÄÃÅĀĂĄáàâäãåāăą'],
    ['c', 'ÇĆĈĊČçćĉċč'],
    ['d', 'ĎĐďđ'],
    ['e', 'ÉÈÊËĒĔĖĘĚéèêëēĕėęě'],
    ['g', 'ĜĞĠĢĝğġģ'],
    ['h', 'ĤĥĦħ'],
    ['i', 'ÍÌÎÏĨĪĬĮİíìîïĩīĭįı'],
    ['j', 'Ĵĵ'],
    ['k', 'Ķķ'],
    ['l', 'ĹĻĽĿŁĺļľŀł'],
    ['n', 'ÑŃŅŇñńņň'],
    ['o', 'ÓÒÔÖÕØŌŎŐóòôöõøōŏő'],
    ['r', 'ŔŖŘŕŗř'],
    ['s', 'ŚŜŞŠśŝşš'],
    ['t', 'ŢŤŦţťŧ'],
    ['u', 'ÚÙÛÜŨŪŬŮŰŲúùûüũūŭůűų'],
    ['w', 'Ŵŵ'],
    ['y', 'ÝŸŶýÿŷ'],
    ['z', 'ŹŻŽźżž'],
];

export const ACCENT_FROM = ACCENT_GROUPS.map(([, chars]) => chars).join('');
export const ACCENT_TO = ACCENT_GROUPS.map(([base, chars]) => base.repeat([...chars].length)).join('');

/**
 * Expresion de la clave de orden por remitente a partir de la cabecera `from` cruda (`col`):
 * nombre visible (sin comillas ni `<direccion>`) o, si no lo hay, la direccion; en minusculas y sin acentos.
 *   "Pérez, Ana" <ana@x.com>  ->  perez, ana        <Zoe@X.com>  ->  zoe@x.com        bob@x.com  ->  bob@x.com
 */
export function senderKeyExpr(col: string): string {
    return `translate(lower(COALESCE(`
        + `NULLIF(btrim(regexp_replace(COALESCE(${col},''), '<[^>]*>', '', 'g'), E' \\t"''<>'), ''),`
        + `NULLIF(btrim(COALESCE(substring(COALESCE(${col},'') from '<([^>]*)>'), ''), E' \\t'), ''),`
        + `btrim(COALESCE(${col},''), E' \\t'))), '${ACCENT_FROM}', '${ACCENT_TO}')`;
}

export const SENDER_KEY_FN = 'bloomx_sender_key';
export const SENDER_KEY_INDEX = 'Email_userId_folder_senderKey_idx';

export const SENDER_KEY_FUNCTION_DDL =
    `CREATE OR REPLACE FUNCTION ${SENDER_KEY_FN}(h text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $bx$ SELECT ${senderKeyExpr('h')} $bx$`;

/** Indice de expresion (aditivo): sirve `ORDER BY clave COLLATE "C", createdAt DESC, id DESC` de una carpeta de un usuario. */
export const SENDER_KEY_INDEX_DDL =
    `CREATE INDEX IF NOT EXISTS "${SENDER_KEY_INDEX}" ON "Email" ("userId", "folder", (${SENDER_KEY_FN}("from") COLLATE "C"), "createdAt" DESC, "id" DESC)`;

export const CREATED_MS_FN = 'bloomx_email_created_ms';
export const CREATED_MS_TRIGGER = 'Email_createdAt_ms_trg';

/** Redondea `createdAt` a milisegundos en CUALQUIER insercion (Prisma, SQL crudo, importadores): el cursor (createdAt, id) no pierde precision. */
export const CREATED_MS_FUNCTION_DDL =
    `CREATE OR REPLACE FUNCTION ${CREATED_MS_FN}() RETURNS trigger LANGUAGE plpgsql AS $bx$ BEGIN NEW."createdAt" := date_trunc('milliseconds', NEW."createdAt"); RETURN NEW; END $bx$`;

/** Crea el disparador una sola vez y, solo entonces, iguala a ms las filas antiguas con microsegundos (idempotente). */
export const CREATED_MS_TRIGGER_DDL = `DO $bx$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${CREATED_MS_TRIGGER}' AND tgrelid = '"Email"'::regclass) THEN
        CREATE TRIGGER "${CREATED_MS_TRIGGER}" BEFORE INSERT OR UPDATE OF "createdAt" ON "Email"
            FOR EACH ROW EXECUTE PROCEDURE ${CREATED_MS_FN}();
        UPDATE "Email" SET "createdAt" = date_trunc('milliseconds', "createdAt") WHERE "createdAt" <> date_trunc('milliseconds', "createdAt");
    END IF;
END $bx$`;
