import type { Pool } from 'pg';
import { getDbPool } from './pool';
import { CREATED_MS_FUNCTION_DDL, CREATED_MS_TRIGGER_DDL, SENDER_KEY_FUNCTION_DDL, SENDER_KEY_INDEX_DDL } from './mail-sql';

type ColumnSpec = {
    name: string;
    definition: string;
};

type ConstraintSpec = {
    name: string;
    statement: string;
};

type TableSpec = {
    name: string;
    createStatement: string;
    columns: ColumnSpec[];
    constraints?: ConstraintSpec[];
    /** Funciones SQL (CREATE OR REPLACE): se crean ANTES de los indices que las usan. */
    functions?: string[];
    indexes?: string[];
    /** Sentencias posteriores a los indices (disparadores y rellenos unicos). Deben ser idempotentes. */
    after?: string[];
};

const TABLES: TableSpec[] = [
    {
        name: 'User',
        createStatement: `CREATE TABLE IF NOT EXISTS "User" (
            "id" TEXT NOT NULL,
            "email" TEXT NOT NULL,
            "name" TEXT,
            "password" TEXT NOT NULL,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "avatar" TEXT,
            "signature" TEXT,
            "expansionSettings" JSONB
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'email', definition: 'TEXT NOT NULL' },
            { name: 'name', definition: 'TEXT' },
            { name: 'password', definition: 'TEXT NOT NULL' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'avatar', definition: 'TEXT' },
            { name: 'signature', definition: 'TEXT' },
            { name: 'expansionSettings', definition: 'JSONB' },
            // Revocacion global de sesiones JWT (claim `tv`). Aditivo; se lee/escribe por SQL crudo (lib/session-revocation.ts)
            // y NO esta en schema.prisma a proposito: asi los findMany/select existentes no dependen de la columna.
            { name: 'tokenVersion', definition: 'INTEGER NOT NULL DEFAULT 0' },
        ],
        constraints: [
            { name: 'User_pkey', statement: 'ALTER TABLE "User" ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id")' },
            { name: 'User_email_key', statement: 'ALTER TABLE "User" ADD CONSTRAINT "User_email_key" UNIQUE ("email")' },
        ],
    },
    {
        name: 'Account',
        createStatement: `CREATE TABLE IF NOT EXISTS "Account" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "type" TEXT NOT NULL,
            "provider" TEXT NOT NULL,
            "providerAccountId" TEXT NOT NULL,
            "refresh_token" TEXT,
            "access_token" TEXT,
            "expires_at" INTEGER,
            "token_type" TEXT,
            "scope" TEXT,
            "id_token" TEXT,
            "session_state" TEXT
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'type', definition: 'TEXT NOT NULL' },
            { name: 'provider', definition: 'TEXT NOT NULL' },
            { name: 'providerAccountId', definition: 'TEXT NOT NULL' },
            { name: 'refresh_token', definition: 'TEXT' },
            { name: 'access_token', definition: 'TEXT' },
            { name: 'expires_at', definition: 'INTEGER' },
            { name: 'token_type', definition: 'TEXT' },
            { name: 'scope', definition: 'TEXT' },
            { name: 'id_token', definition: 'TEXT' },
            { name: 'session_state', definition: 'TEXT' },
            // Hash de la identidad del proveedor OAuth con el que se obtuvo el token (lib/oauth/providers.ts#providerIdentityHash). Aditiva.
            { name: 'provider_hash', definition: 'TEXT' },
        ],
        constraints: [
            { name: 'Account_pkey', statement: 'ALTER TABLE "Account" ADD CONSTRAINT "Account_pkey" PRIMARY KEY ("id")' },
            { name: 'Account_provider_providerAccountId_key', statement: 'ALTER TABLE "Account" ADD CONSTRAINT "Account_provider_providerAccountId_key" UNIQUE ("provider", "providerAccountId")' },
            { name: 'Account_userId_fkey', statement: 'ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "Account_userId_idx" ON "Account" ("userId")',
        ],
    },
    {
        name: 'Email',
        createStatement: `CREATE TABLE IF NOT EXISTS "Email" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "messageId" TEXT NOT NULL,
            "from" TEXT NOT NULL,
            "to" TEXT NOT NULL,
            "replyTo" TEXT,
            "subject" TEXT,
            "snippet" TEXT,
            "htmlKey" TEXT,
            "textKey" TEXT,
            "rawKey" TEXT,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "read" BOOLEAN NOT NULL DEFAULT FALSE,
            "folder" TEXT NOT NULL DEFAULT 'inbox',
            "status" TEXT NOT NULL DEFAULT 'received',
            "starred" BOOLEAN NOT NULL DEFAULT FALSE,
            "cleanTo" TEXT,
            "scheduledAt" TIMESTAMPTZ,
            "smartReplies" JSONB
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'messageId', definition: 'TEXT NOT NULL' },
            { name: 'from', definition: 'TEXT NOT NULL' },
            { name: 'to', definition: 'TEXT NOT NULL' },
            { name: 'cc', definition: 'TEXT' },
            { name: 'bcc', definition: 'TEXT' },
            { name: 'replyTo', definition: 'TEXT' },
            { name: 'subject', definition: 'TEXT' },
            { name: 'snippet', definition: 'TEXT' },
            { name: 'htmlKey', definition: 'TEXT' },
            { name: 'textKey', definition: 'TEXT' },
            { name: 'rawKey', definition: 'TEXT' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'read', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'folder', definition: "TEXT NOT NULL DEFAULT 'inbox'" },
            { name: 'status', definition: "TEXT NOT NULL DEFAULT 'received'" },
            { name: 'starred', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'cleanTo', definition: 'TEXT' },
            { name: 'scheduledAt', definition: 'TIMESTAMPTZ' },
            { name: 'smartReplies', definition: 'JSONB' },
            { name: 'attachmentsChecked', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'rawMimeUrl', definition: 'TEXT' },
            // Carpeta desde la que se movio el correo a archive/trash/spam (la fija el servidor; "Restaurar" vuelve ahi).
            // Aditivo y tolerante: lib/mail-previous-folder.ts lee/escribe con SQL crudo y cae a la bandeja si la columna no existe.
            { name: 'previousFolder', definition: 'TEXT' },
            // Spam v2 (lib/spam/*). Aditivo y tolerante: se escribe con SQL crudo tras crear el correo y NO esta en schema.prisma a proposito
            // (asi los findMany existentes no dependen de la columna). spamScore 0-100; spamReasons = { v, d (decision), sg (senales base, <= 2 KB) };
            // isExternal = remitente fuera de los dominios propios/internos (lo leen las reglas v2).
            { name: 'spamScore', definition: 'INTEGER' },
            { name: 'spamReasons', definition: 'JSONB' },
            { name: 'isExternal', definition: 'BOOLEAN' },
            // Hilos de conversacion (lib/threading.ts). Aditivo y tolerante: lib/thread-store.ts y mail-list-sql.ts leen/escriben con SQL crudo
            // y, si faltan las columnas, se agrupa con la clave heuristica heredada (asunto + destinatarios).
            //   rfcMessageId = Message-ID del correo (sin <>, dominio en minusculas); inReplyTo = su padre directo;
            //   refs = References normalizadas separadas por espacio (raiz + las 50 mas recientes); threadKey = raiz canonica del hilo.
            { name: 'rfcMessageId', definition: 'TEXT' },
            { name: 'inReplyTo', definition: 'TEXT' },
            { name: 'refs', definition: 'TEXT' },
            { name: 'threadKey', definition: 'TEXT' },
            // Cabeceras de la LISTA BLANCA (List-Id, List-Unsubscribe, Precedence, Auto-Submitted, X-Mailer, Reply-To,
            // Authentication-Results, ...) como {nombre-en-minuscula: valor}, <= 4 KB (motor de reglas v2, lib/rules/headers.ts).
            // Aditivo; se escribe por SQL best-effort en la ingesta. Correos antiguos: NULL => sus condiciones de cabecera "no coinciden".
            { name: 'hdrs', definition: 'JSONB' },
        ],
        constraints: [
            { name: 'Email_pkey', statement: 'ALTER TABLE "Email" ADD CONSTRAINT "Email_pkey" PRIMARY KEY ("id")' },
            { name: 'Email_messageId_key', statement: 'ALTER TABLE "Email" ADD CONSTRAINT "Email_messageId_key" UNIQUE ("messageId")' },
            { name: 'Email_userId_fkey', statement: 'ALTER TABLE "Email" ADD CONSTRAINT "Email_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        // Orden por remitente (clave normalizada, indexada) y createdAt siempre en milisegundos (cursor estable). Ver db/mail-sql.ts.
        functions: [SENDER_KEY_FUNCTION_DDL, CREATED_MS_FUNCTION_DDL],
        after: [CREATED_MS_TRIGGER_DDL],
        indexes: [
            SENDER_KEY_INDEX_DDL,
            'CREATE INDEX IF NOT EXISTS "Email_to_idx" ON "Email" ("to")',
            'CREATE INDEX IF NOT EXISTS "Email_folder_idx" ON "Email" ("folder")',
            'CREATE INDEX IF NOT EXISTS "Email_createdAt_idx" ON "Email" ("createdAt")',
            'CREATE INDEX IF NOT EXISTS "Email_userId_idx" ON "Email" ("userId")',
            'CREATE INDEX IF NOT EXISTS "Email_userId_folder_createdAt_idx" ON "Email" ("userId", "folder", "createdAt" DESC)',
            'CREATE INDEX IF NOT EXISTS "Email_userId_folder_read_idx" ON "Email" ("userId", "folder", "read")',
            'CREATE INDEX IF NOT EXISTS "Email_userId_scheduledAt_idx" ON "Email" ("userId", "scheduledAt")',
            // Hilos por cabeceras: miembros de un hilo, busqueda por Message-ID y por padre (respuestas llegadas antes que su original).
            'CREATE INDEX IF NOT EXISTS "Email_userId_threadKey_idx" ON "Email" ("userId", "threadKey")',
            'CREATE INDEX IF NOT EXISTS "Email_userId_rfcMessageId_idx" ON "Email" ("userId", "rfcMessageId")',
            'CREATE INDEX IF NOT EXISTS "Email_userId_inReplyTo_idx" ON "Email" ("userId", "inReplyTo") WHERE "inReplyTo" IS NOT NULL',
            // Filtro "destacados" y su conteo por carpeta (parcial: solo las filas destacadas, un indice muy pequeno).
            'CREATE INDEX IF NOT EXISTS "Email_userId_folder_starred_idx" ON "Email" ("userId", "folder", "createdAt" DESC) WHERE "starred" = TRUE',
            // Full-text (busqueda). La expresion debe coincidir con FTS_EXPRESSION_SQL en src/lib/rules/search.ts
            `CREATE INDEX IF NOT EXISTS "Email_fts_idx" ON "Email" USING GIN (to_tsvector('simple', coalesce("subject",'') || ' ' || coalesce("from",'') || ' ' || coalesce("snippet",'')))`,
        ],
    },
    {
        name: 'Draft',
        createStatement: `CREATE TABLE IF NOT EXISTS "Draft" (
            "id" TEXT NOT NULL,
            "to" TEXT,
            "subject" TEXT,
            "body" TEXT,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "from" TEXT NOT NULL,
            "bcc" TEXT,
            "cc" TEXT
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'to', definition: 'TEXT' },
            { name: 'subject', definition: 'TEXT' },
            { name: 'body', definition: 'TEXT' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'from', definition: 'TEXT NOT NULL' },
            { name: 'bcc', definition: 'TEXT' },
            { name: 'cc', definition: 'TEXT' },
            // Contexto de respuesta del borrador (aditivo, SQL crudo tolerante en api/drafts): al reabrir un borrador de respuesta se conserva
            // el vinculo con el original (In-Reply-To / References en el envio). replyMode: reply | replyAll | forward.
            { name: 'inReplyToEmailId', definition: 'TEXT' },
            { name: 'replyMode', definition: 'TEXT' },
        ],
        constraints: [
            { name: 'Draft_pkey', statement: 'ALTER TABLE "Draft" ADD CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "Draft_updatedAt_idx" ON "Draft" ("updatedAt")',
            'CREATE INDEX IF NOT EXISTS "Draft_from_idx" ON "Draft" ("from")',
        ],
    },
    {
        name: 'Attachment',
        createStatement: `CREATE TABLE IF NOT EXISTS "Attachment" (
            "id" TEXT NOT NULL,
            "emailId" TEXT,
            "filename" TEXT NOT NULL,
            "mimeType" TEXT NOT NULL,
            "size" INTEGER NOT NULL,
            "key" TEXT NOT NULL,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "draftId" TEXT
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'emailId', definition: 'TEXT' },
            { name: 'filename', definition: 'TEXT NOT NULL' },
            { name: 'mimeType', definition: 'TEXT NOT NULL' },
            { name: 'size', definition: 'INTEGER NOT NULL' },
            { name: 'key', definition: 'TEXT NOT NULL' },
            { name: 'status', definition: "TEXT NOT NULL DEFAULT 'ready'" },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'draftId', definition: 'TEXT' },
            // Content-ID (sin angulos) de imagenes inline; resuelve `cid:` antes que el nombre de archivo. Aditivo y nulo por defecto.
            // Se escribe por SQL best-effort (lib/attachment-content-id.ts): la ingesta no falla si la columna aun no existe.
            { name: 'contentId', definition: 'TEXT' },
        ],
        constraints: [
            { name: 'Attachment_pkey', statement: 'ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")' },
            { name: 'Attachment_draftId_fkey', statement: 'ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
            { name: 'Attachment_emailId_fkey', statement: 'ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "Attachment_emailId_idx" ON "Attachment" ("emailId")',
            'CREATE INDEX IF NOT EXISTS "Attachment_draftId_idx" ON "Attachment" ("draftId")',
        ],
    },
    {
        name: 'EmailEvent',
        createStatement: `CREATE TABLE IF NOT EXISTS "EmailEvent" (
            "id" TEXT NOT NULL,
            "emailId" TEXT,
            "resendEmailId" TEXT,
            "type" TEXT NOT NULL,
            "data" JSONB,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'emailId', definition: 'TEXT' },
            { name: 'resendEmailId', definition: 'TEXT' },
            { name: 'type', definition: 'TEXT NOT NULL' },
            { name: 'data', definition: 'JSONB' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'EmailEvent_pkey', statement: 'ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")' },
            { name: 'EmailEvent_emailId_fkey', statement: 'ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE SET NULL ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "EmailEvent_resendEmailId_idx" ON "EmailEvent" ("resendEmailId")',
            'CREATE INDEX IF NOT EXISTS "EmailEvent_emailId_idx" ON "EmailEvent" ("emailId")',
            'CREATE INDEX IF NOT EXISTS "EmailEvent_type_idx" ON "EmailEvent" ("type")',
            // Idempotencia atomica de POST /api/emails: una sola fila por (usuario, Idempotency-Key). Ver lib/send-idempotency.ts.
            `DO $$
            BEGIN
                CREATE UNIQUE INDEX IF NOT EXISTS "EmailEvent_send_idem_key" ON "EmailEvent" ("type") WHERE "type" LIKE 'send_idem:%';
            EXCEPTION
                WHEN unique_violation THEN
                    RAISE NOTICE 'EmailEvent: hay claves send_idem duplicadas; indice unico parcial omitido.';
            END $$`,
        ],
    },
    {
        name: 'Label',
        createStatement: `CREATE TABLE IF NOT EXISTS "Label" (
            "id" TEXT NOT NULL,
            "name" TEXT NOT NULL,
            "color" TEXT NOT NULL DEFAULT '#6366f1',
            "userId" TEXT NOT NULL,
            "aliasSuffix" TEXT,
            "filterRegex" TEXT,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'name', definition: 'TEXT NOT NULL' },
            { name: 'color', definition: "TEXT NOT NULL DEFAULT '#6366f1'" },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'aliasSuffix', definition: 'TEXT' },
            { name: 'filterRegex', definition: 'TEXT' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            // Etiquetas jerarquicas con comportamiento (aditivo; lib/labels/store.ts lee/escribe por SQL crudo y tolera su ausencia).
            // "name" es el SEGMENTO; la ruta completa ("Trabajo/Proyecto A") es "fullPath" (NULL = igual que name, etiquetas antiguas).
            { name: 'parentId', definition: 'TEXT' },
            { name: 'behavior', definition: "TEXT NOT NULL DEFAULT 'tag'" },
            { name: 'sortOrder', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'icon', definition: 'TEXT' },
            { name: 'showInSidebar', definition: 'BOOLEAN NOT NULL DEFAULT TRUE' },
            { name: 'showUnread', definition: 'BOOLEAN NOT NULL DEFAULT TRUE' },
            { name: 'fullPath', definition: 'TEXT' },
        ],
        constraints: [
            { name: 'Label_pkey', statement: 'ALTER TABLE "Label" ADD CONSTRAINT "Label_pkey" PRIMARY KEY ("id")' },
            { name: 'Label_userId_fkey', statement: 'ALTER TABLE "Label" ADD CONSTRAINT "Label_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
            // Si se borra el padre por SQL directo, los hijos pasan a la raiz (la API decide antes: reubicar o borrar el subarbol).
            { name: 'Label_parentId_fkey', statement: 'ALTER TABLE "Label" ADD CONSTRAINT "Label_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Label"("id") ON DELETE SET NULL ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "Label_userId_idx" ON "Label" ("userId")',
            'CREATE INDEX IF NOT EXISTS "Label_userId_parentId_idx" ON "Label" ("userId", "parentId")',
        ],
        // La unicidad pasa de (userId, name) a (userId, padre, name): la restriccion antigua se retira y se crea el indice unico
        // (tolerante: si hubiera duplicados historicos se omite con un aviso en vez de romper el despliegue).
        after: [
            'ALTER TABLE "Label" DROP CONSTRAINT IF EXISTS "Label_userId_name_key"',
            `DO $$
            BEGIN
                CREATE UNIQUE INDEX IF NOT EXISTS "Label_user_parent_name_key" ON "Label" ("userId", COALESCE("parentId", ''), "name");
            EXCEPTION
                WHEN unique_violation THEN
                    RAISE NOTICE 'Label: hay etiquetas duplicadas; indice unico (userId,parentId,name) omitido.';
            END $$`,
            // En bases creadas con Prisma la unicidad antigua es un indice suelto (DROP CONSTRAINT no lo quita) y bloquearia hijos con el mismo nombre.
            'DROP INDEX IF EXISTS "Label_userId_name_key"',
            // Prisma (@updatedAt) no deja valor por defecto: los INSERT por SQL crudo fallaban con NOT NULL.
            'ALTER TABLE "Label" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP',
        ],
    },
    {
        name: 'Rule',
        createStatement: `CREATE TABLE IF NOT EXISTS "Rule" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "name" TEXT NOT NULL,
            "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
            "priority" INTEGER NOT NULL DEFAULT 0,
            "conditions" JSONB NOT NULL DEFAULT '{}'::jsonb,
            "actions" JSONB NOT NULL DEFAULT '[]'::jsonb,
            "stopProcessing" BOOLEAN NOT NULL DEFAULT FALSE,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'name', definition: 'TEXT NOT NULL' },
            { name: 'enabled', definition: 'BOOLEAN NOT NULL DEFAULT TRUE' },
            { name: 'priority', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'conditions', definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
            { name: 'actions', definition: "JSONB NOT NULL DEFAULT '[]'::jsonb" },
            { name: 'stopProcessing', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            // Regla vinculada a una etiqueta ("Asignar automaticamente") y estadisticas de uso. Aditivo y tolerante.
            { name: 'labelId', definition: 'TEXT' },
            { name: 'matchedCount', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'lastMatchedAt', definition: 'TIMESTAMPTZ' },
        ],
        constraints: [
            { name: 'Rule_pkey', statement: 'ALTER TABLE "Rule" ADD CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")' },
            { name: 'Rule_userId_fkey', statement: 'ALTER TABLE "Rule" ADD CONSTRAINT "Rule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
            { name: 'Rule_labelId_fkey', statement: 'ALTER TABLE "Rule" ADD CONSTRAINT "Rule_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "Rule_userId_priority_idx" ON "Rule" ("userId", "priority")',
            'CREATE INDEX IF NOT EXISTS "Rule_labelId_idx" ON "Rule" ("labelId")',
        ],
    },
    {
        // Lotes de "Aplicar a existentes": cada lote guarda, por correo, el estado previo para poder DESHACERLO.
        // (RuleRun tiene una fila por correo -idempotencia de la ingesta-: no puede representar varios lotes.)
        name: 'RuleBatch',
        createStatement: `CREATE TABLE IF NOT EXISTS "RuleBatch" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "ruleId" TEXT,
            "labelId" TEXT,
            "status" TEXT NOT NULL DEFAULT 'applied',
            "processed" INTEGER NOT NULL DEFAULT 0,
            "changed" INTEGER NOT NULL DEFAULT 0,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "undoneAt" TIMESTAMPTZ
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'ruleId', definition: 'TEXT' },
            { name: 'labelId', definition: 'TEXT' },
            { name: 'status', definition: "TEXT NOT NULL DEFAULT 'applied'" },
            { name: 'processed', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'changed', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'undoneAt', definition: 'TIMESTAMPTZ' },
        ],
        constraints: [
            { name: 'RuleBatch_pkey', statement: 'ALTER TABLE "RuleBatch" ADD CONSTRAINT "RuleBatch_pkey" PRIMARY KEY ("id")' },
            { name: 'RuleBatch_userId_fkey', statement: 'ALTER TABLE "RuleBatch" ADD CONSTRAINT "RuleBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "RuleBatch_userId_createdAt_idx" ON "RuleBatch" ("userId", "createdAt" DESC)',
        ],
    },
    {
        name: 'RuleBatchItem',
        createStatement: `CREATE TABLE IF NOT EXISTS "RuleBatchItem" (
            "batchId" TEXT NOT NULL,
            "emailId" TEXT NOT NULL,
            "prev" JSONB NOT NULL DEFAULT '{}'::jsonb
        )`,
        columns: [
            { name: 'batchId', definition: 'TEXT NOT NULL' },
            { name: 'emailId', definition: 'TEXT NOT NULL' },
            { name: 'prev', definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
        ],
        constraints: [
            { name: 'RuleBatchItem_pkey', statement: 'ALTER TABLE "RuleBatchItem" ADD CONSTRAINT "RuleBatchItem_pkey" PRIMARY KEY ("batchId", "emailId")' },
            { name: 'RuleBatchItem_batchId_fkey', statement: 'ALTER TABLE "RuleBatchItem" ADD CONSTRAINT "RuleBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "RuleBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
            { name: 'RuleBatchItem_emailId_fkey', statement: 'ALTER TABLE "RuleBatchItem" ADD CONSTRAINT "RuleBatchItem_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "RuleBatchItem_emailId_idx" ON "RuleBatchItem" ("emailId")',
        ],
    },
    {
        name: 'RuleRun',
        createStatement: `CREATE TABLE IF NOT EXISTS "RuleRun" (
            "emailId" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'emailId', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'appliedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'RuleRun_pkey', statement: 'ALTER TABLE "RuleRun" ADD CONSTRAINT "RuleRun_pkey" PRIMARY KEY ("emailId")' },
            { name: 'RuleRun_emailId_fkey', statement: 'ALTER TABLE "RuleRun" ADD CONSTRAINT "RuleRun_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "RuleRun_userId_idx" ON "RuleRun" ("userId")',
        ],
    },
    {
        // Estado de vistas/caducidad de los mensajes sellados (ver lib/sealed/store.ts). El contador se incrementa con un
        // UPDATE atomico condicionado (views < maxViews AND expiresAt > now()), valido entre instancias serverless.
        name: 'SecureMessageMeta',
        createStatement: `CREATE TABLE IF NOT EXISTS "SecureMessageMeta" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "maxViews" INTEGER,
            "views" INTEGER NOT NULL DEFAULT 0,
            "expiresAt" TIMESTAMPTZ NOT NULL,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'maxViews', definition: 'INTEGER' },
            { name: 'views', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'expiresAt', definition: 'TIMESTAMPTZ NOT NULL' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'SecureMessageMeta_pkey', statement: 'ALTER TABLE "SecureMessageMeta" ADD CONSTRAINT "SecureMessageMeta_pkey" PRIMARY KEY ("id")' },
            { name: 'SecureMessageMeta_userId_fkey', statement: 'ALTER TABLE "SecureMessageMeta" ADD CONSTRAINT "SecureMessageMeta_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "SecureMessageMeta_userId_idx" ON "SecureMessageMeta" ("userId")',
            'CREATE INDEX IF NOT EXISTS "SecureMessageMeta_expiresAt_idx" ON "SecureMessageMeta" ("expiresAt")',
        ],
    },
    {
        name: 'MoltSession',
        createStatement: `CREATE TABLE IF NOT EXISTS "MoltSession" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "accessToken" TEXT NOT NULL,
            "refreshToken" TEXT,
            "expiresAt" TIMESTAMPTZ NOT NULL,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'accessToken', definition: 'TEXT NOT NULL' },
            { name: 'refreshToken', definition: 'TEXT' },
            { name: 'expiresAt', definition: 'TIMESTAMPTZ NOT NULL' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'MoltSession_pkey', statement: 'ALTER TABLE "MoltSession" ADD CONSTRAINT "MoltSession_pkey" PRIMARY KEY ("id")' },
            { name: 'MoltSession_accessToken_key', statement: 'ALTER TABLE "MoltSession" ADD CONSTRAINT "MoltSession_accessToken_key" UNIQUE ("accessToken")' },
            { name: 'MoltSession_userId_fkey', statement: 'ALTER TABLE "MoltSession" ADD CONSTRAINT "MoltSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "MoltSession_userId_idx" ON "MoltSession" ("userId")',
            'CREATE INDEX IF NOT EXISTS "MoltSession_accessToken_idx" ON "MoltSession" ("accessToken")',
        ],
    },
    {
        // Estado de los flujos OAuth en curso (registro de proveedores OAuth de extensiones): SOLO el hash del `state` (nunca el state ni el
        // verificador PKCE, que viajan en una cookie HttpOnly cifrada). Sirve para que cada state se consuma UNA sola vez (anti-replay).
        // Aditivo: la app sigue funcionando si la tabla aun no existe (el flujo degrada al nonce de la cookie).
        name: 'OAuthFlow',
        createStatement: `CREATE TABLE IF NOT EXISTS "OAuthFlow" (
            "stateHash" TEXT NOT NULL,
            "provider" TEXT NOT NULL,
            "userId" TEXT,
            "mode" TEXT NOT NULL,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "expiresAt" TIMESTAMPTZ NOT NULL,
            "consumedAt" TIMESTAMPTZ
        )`,
        columns: [
            { name: 'stateHash', definition: 'TEXT NOT NULL' },
            { name: 'provider', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT' },
            { name: 'mode', definition: 'TEXT NOT NULL' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'expiresAt', definition: 'TIMESTAMPTZ NOT NULL' },
            { name: 'consumedAt', definition: 'TIMESTAMPTZ' },
        ],
        constraints: [
            { name: 'OAuthFlow_pkey', statement: 'ALTER TABLE "OAuthFlow" ADD CONSTRAINT "OAuthFlow_pkey" PRIMARY KEY ("stateHash")' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "OAuthFlow_expiresAt_idx" ON "OAuthFlow" ("expiresAt")',
        ],
    },
    {
        // Configuracion OAuth PROPIA de la instancia por proveedor: el client secret (cifrado con la clave de datos de ESTA instancia, AES-256-GCM v3)
        // y los hosts de los endpoints que el admin aprobo al guardarlo. Si la extension cambia de host, el proveedor queda desactivado hasta
        // que el admin lo apruebe de nuevo (el secreto nunca viaja a un destino no aprobado). El secreto jamas llega a una extension ni al navegador.
        name: 'OAuthProviderConfig',
        createStatement: `CREATE TABLE IF NOT EXISTS "OAuthProviderConfig" (
            "provider" TEXT NOT NULL,
            "extensionId" TEXT,
            "clientSecret" TEXT,
            "approvedHosts" TEXT NOT NULL DEFAULT '[]',
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedBy" TEXT,
            "extra" TEXT NOT NULL DEFAULT '{}'
        )`,
        columns: [
            { name: 'provider', definition: 'TEXT NOT NULL' },
            { name: 'extensionId', definition: 'TEXT' },
            { name: 'clientSecret', definition: 'TEXT' },
            { name: 'approvedHosts', definition: "TEXT NOT NULL DEFAULT '[]'" },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedBy', definition: 'TEXT' },
            // Credenciales COMPARTIDAS adicionales (organizador / cuenta de servicio): JSON { NOMBRE: valor cifrado (AES-256-GCM v3) }.
            { name: 'extra', definition: "TEXT NOT NULL DEFAULT '{}'" },
        ],
        constraints: [
            { name: 'OAuthProviderConfig_pkey', statement: 'ALTER TABLE "OAuthProviderConfig" ADD CONSTRAINT "OAuthProviderConfig_pkey" PRIMARY KEY ("provider")' },
        ],
    },
    {
        name: '_EmailToLabel',
        createStatement: `CREATE TABLE IF NOT EXISTS "_EmailToLabel" (
            "A" TEXT NOT NULL,
            "B" TEXT NOT NULL
        )`,
        columns: [
            { name: 'A', definition: 'TEXT NOT NULL' },
            { name: 'B', definition: 'TEXT NOT NULL' },
        ],
        constraints: [
            { name: '_EmailToLabel_A_fkey', statement: 'ALTER TABLE "_EmailToLabel" ADD CONSTRAINT "_EmailToLabel_A_fkey" FOREIGN KEY ("A") REFERENCES "Email"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
            { name: '_EmailToLabel_B_fkey', statement: 'ALTER TABLE "_EmailToLabel" ADD CONSTRAINT "_EmailToLabel_B_fkey" FOREIGN KEY ("B") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE UNIQUE INDEX IF NOT EXISTS "_EmailToLabel_AB_unique" ON "_EmailToLabel" ("A", "B")',
            'CREATE INDEX IF NOT EXISTS "_EmailToLabel_B_index" ON "_EmailToLabel" ("B")',
        ],
    },
    {
        name: 'push_subscriptions',
        createStatement: `CREATE TABLE IF NOT EXISTS push_subscriptions (
            id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            expiration_time BIGINT,
            user_agent TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_success_at TIMESTAMPTZ
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'user_id', definition: 'TEXT NOT NULL' },
            { name: 'endpoint', definition: 'TEXT NOT NULL' },
            { name: 'p256dh', definition: 'TEXT NOT NULL' },
            { name: 'auth', definition: 'TEXT NOT NULL' },
            { name: 'expiration_time', definition: 'BIGINT' },
            { name: 'user_agent', definition: 'TEXT' },
            { name: 'created_at', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updated_at', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'last_success_at', definition: 'TIMESTAMPTZ' },
        ],
        constraints: [
            { name: 'push_subscriptions_pkey', statement: 'ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id)' },
            { name: 'push_subscriptions_endpoint_key', statement: 'ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint)' },
            { name: 'push_subscriptions_user_id_fkey', statement: 'ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON push_subscriptions (user_id)',
        ],
    },
    {
        name: 'push_vapid_config',
        createStatement: `CREATE TABLE IF NOT EXISTS push_vapid_config (
            id TEXT NOT NULL,
            public_key TEXT NOT NULL,
            private_key TEXT NOT NULL,
            subject TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'public_key', definition: 'TEXT NOT NULL' },
            { name: 'private_key', definition: 'TEXT NOT NULL' },
            { name: 'subject', definition: 'TEXT NOT NULL' },
            { name: 'created_at', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updated_at', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'push_vapid_config_pkey', statement: 'ALTER TABLE push_vapid_config ADD CONSTRAINT push_vapid_config_pkey PRIMARY KEY (id)' },
        ],
    },
    {
        name: 'Calendar',
        createStatement: `CREATE TABLE IF NOT EXISTS "Calendar" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "name" TEXT NOT NULL,
            "color" TEXT NOT NULL DEFAULT '#2563eb',
            "source" TEXT NOT NULL DEFAULT 'local',
            "isReadOnly" BOOLEAN NOT NULL DEFAULT FALSE,
            "externalId" TEXT,
            "syncToken" TEXT,
            "lastSyncedAt" TIMESTAMPTZ,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'name', definition: 'TEXT NOT NULL' },
            { name: 'color', definition: "TEXT NOT NULL DEFAULT '#2563eb'" },
            { name: 'source', definition: "TEXT NOT NULL DEFAULT 'local'" },
            { name: 'isReadOnly', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'externalId', definition: 'TEXT' },
            { name: 'syncToken', definition: 'TEXT' },
            { name: 'lastSyncedAt', definition: 'TIMESTAMPTZ' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'Calendar_pkey', statement: 'ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_pkey" PRIMARY KEY ("id")' },
            { name: 'Calendar_userId_source_name_key', statement: 'ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_userId_source_name_key" UNIQUE ("userId", "source", "name")' },
            { name: 'Calendar_userId_fkey', statement: 'ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "Calendar_userId_idx" ON "Calendar" ("userId")',
            'CREATE INDEX IF NOT EXISTS "Calendar_source_idx" ON "Calendar" ("source")',
        ],
    },
    {
        name: 'CalendarEvent',
        createStatement: `CREATE TABLE IF NOT EXISTS "CalendarEvent" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "calendarId" TEXT NOT NULL,
            "title" TEXT NOT NULL,
            "description" TEXT,
            "location" TEXT,
            "startsAt" TIMESTAMPTZ NOT NULL,
            "endsAt" TIMESTAMPTZ NOT NULL,
            "allDay" BOOLEAN NOT NULL DEFAULT FALSE,
            "status" TEXT NOT NULL DEFAULT 'confirmed',
            "responseStatus" TEXT,
            "source" TEXT NOT NULL DEFAULT 'local',
            "externalId" TEXT,
            "inviteUid" TEXT,
            "organizerEmail" TEXT,
            "organizerName" TEXT,
            "sourceEmailId" TEXT,
            "lastSyncedAt" TIMESTAMPTZ,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'calendarId', definition: 'TEXT NOT NULL' },
            { name: 'title', definition: 'TEXT NOT NULL' },
            { name: 'description', definition: 'TEXT' },
            { name: 'location', definition: 'TEXT' },
            { name: 'startsAt', definition: 'TIMESTAMPTZ NOT NULL' },
            { name: 'endsAt', definition: 'TIMESTAMPTZ NOT NULL' },
            { name: 'allDay', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'status', definition: "TEXT NOT NULL DEFAULT 'confirmed'" },
            { name: 'responseStatus', definition: 'TEXT' },
            { name: 'source', definition: "TEXT NOT NULL DEFAULT 'local'" },
            { name: 'externalId', definition: 'TEXT' },
            { name: 'inviteUid', definition: 'TEXT' },
            { name: 'organizerEmail', definition: 'TEXT' },
            { name: 'organizerName', definition: 'TEXT' },
            { name: 'sourceEmailId', definition: 'TEXT' },
            // Conferencia adjunta (aditivas; eventos existentes siguen usando `location` como enlace)
            { name: 'conferenceUrl', definition: 'TEXT' },
            { name: 'conferenceProvider', definition: 'TEXT' },
            { name: 'conferenceMeetingId', definition: 'TEXT' },
            { name: 'lastSyncedAt', definition: 'TIMESTAMPTZ' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'CalendarEvent_pkey', statement: 'ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")' },
            { name: 'CalendarEvent_userId_fkey', statement: 'ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
            { name: 'CalendarEvent_calendarId_fkey', statement: 'ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "CalendarEvent_userId_idx" ON "CalendarEvent" ("userId")',
            'CREATE INDEX IF NOT EXISTS "CalendarEvent_calendarId_idx" ON "CalendarEvent" ("calendarId")',
            'CREATE INDEX IF NOT EXISTS "CalendarEvent_startsAt_idx" ON "CalendarEvent" ("startsAt")',
            'CREATE INDEX IF NOT EXISTS "CalendarEvent_source_idx" ON "CalendarEvent" ("source")',
            'CREATE INDEX IF NOT EXISTS "CalendarEvent_inviteUid_idx" ON "CalendarEvent" ("inviteUid")',
            'CREATE INDEX IF NOT EXISTS "CalendarEvent_userId_startsAt_idx" ON "CalendarEvent" ("userId", "startsAt")',
            'CREATE INDEX IF NOT EXISTS "CalendarEvent_calendarId_externalId_idx" ON "CalendarEvent" ("calendarId", "externalId")',
        ],
    },
    {
        name: 'CalendarAttendee',
        createStatement: `CREATE TABLE IF NOT EXISTS "CalendarAttendee" (
            "id" TEXT NOT NULL,
            "eventId" TEXT NOT NULL,
            "email" TEXT NOT NULL,
            "name" TEXT,
            "responseStatus" TEXT,
            "isOrganizer" BOOLEAN NOT NULL DEFAULT FALSE,
            "invitedAt" TIMESTAMPTZ,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'eventId', definition: 'TEXT NOT NULL' },
            { name: 'email', definition: 'TEXT NOT NULL' },
            { name: 'name', definition: 'TEXT' },
            { name: 'responseStatus', definition: 'TEXT' },
            { name: 'isOrganizer', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'invitedAt', definition: 'TIMESTAMPTZ' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'CalendarAttendee_pkey', statement: 'ALTER TABLE "CalendarAttendee" ADD CONSTRAINT "CalendarAttendee_pkey" PRIMARY KEY ("id")' },
            { name: 'CalendarAttendee_eventId_fkey', statement: 'ALTER TABLE "CalendarAttendee" ADD CONSTRAINT "CalendarAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "CalendarAttendee_eventId_idx" ON "CalendarAttendee" ("eventId")',
            'CREATE INDEX IF NOT EXISTS "CalendarAttendee_email_idx" ON "CalendarAttendee" ("email")',
        ],
    },
    {
        name: 'AppointmentSchedule',
        createStatement: `CREATE TABLE IF NOT EXISTS "AppointmentSchedule" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "name" TEXT NOT NULL,
            "description" TEXT,
            "duration" INTEGER NOT NULL DEFAULT 30,
            "color" TEXT NOT NULL DEFAULT '#2563eb',
            "timezone" TEXT NOT NULL DEFAULT 'UTC',
            "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
            "conferencing" TEXT,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'name', definition: 'TEXT NOT NULL' },
            { name: 'description', definition: 'TEXT' },
            { name: 'duration', definition: 'INTEGER NOT NULL DEFAULT 30' },
            { name: 'color', definition: "TEXT NOT NULL DEFAULT '#2563eb'" },
            { name: 'timezone', definition: "TEXT NOT NULL DEFAULT 'UTC'" },
            { name: 'isActive', definition: 'BOOLEAN NOT NULL DEFAULT TRUE' },
            { name: 'conferencing', definition: 'TEXT' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'AppointmentSchedule_pkey', statement: 'ALTER TABLE "AppointmentSchedule" ADD CONSTRAINT "AppointmentSchedule_pkey" PRIMARY KEY ("id")' },
            { name: 'AppointmentSchedule_userId_fkey', statement: 'ALTER TABLE "AppointmentSchedule" ADD CONSTRAINT "AppointmentSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "AppointmentSchedule_userId_idx" ON "AppointmentSchedule" ("userId")',
        ],
    },
    {
        name: 'AppointmentAvailability',
        createStatement: `CREATE TABLE IF NOT EXISTS "AppointmentAvailability" (
            "id" TEXT NOT NULL,
            "scheduleId" TEXT NOT NULL,
            "dayOfWeek" INTEGER NOT NULL,
            "startTime" TEXT NOT NULL DEFAULT '09:00',
            "endTime" TEXT NOT NULL DEFAULT '17:00',
            "isEnabled" BOOLEAN NOT NULL DEFAULT TRUE
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'scheduleId', definition: 'TEXT NOT NULL' },
            { name: 'dayOfWeek', definition: 'INTEGER NOT NULL' },
            { name: 'startTime', definition: "TEXT NOT NULL DEFAULT '09:00'" },
            { name: 'endTime', definition: "TEXT NOT NULL DEFAULT '17:00'" },
            { name: 'isEnabled', definition: 'BOOLEAN NOT NULL DEFAULT TRUE' },
        ],
        constraints: [
            { name: 'AppointmentAvailability_pkey', statement: 'ALTER TABLE "AppointmentAvailability" ADD CONSTRAINT "AppointmentAvailability_pkey" PRIMARY KEY ("id")' },
            { name: 'AppointmentAvailability_scheduleId_fkey', statement: 'ALTER TABLE "AppointmentAvailability" ADD CONSTRAINT "AppointmentAvailability_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "AppointmentSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "AppointmentAvailability_scheduleId_idx" ON "AppointmentAvailability" ("scheduleId")',
        ],
    },
    {
        name: 'AppointmentBooking',
        createStatement: `CREATE TABLE IF NOT EXISTS "AppointmentBooking" (
            "id" TEXT NOT NULL,
            "scheduleId" TEXT NOT NULL,
            "calendarEventId" TEXT,
            "guestName" TEXT NOT NULL,
            "guestEmail" TEXT NOT NULL,
            "guestNotes" TEXT,
            "startsAt" TIMESTAMPTZ NOT NULL,
            "endsAt" TIMESTAMPTZ NOT NULL,
            "meetUrl" TEXT,
            "status" TEXT NOT NULL DEFAULT 'confirmed',
            "cancelToken" TEXT,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'scheduleId', definition: 'TEXT NOT NULL' },
            { name: 'calendarEventId', definition: 'TEXT' },
            { name: 'guestName', definition: 'TEXT NOT NULL' },
            { name: 'guestEmail', definition: 'TEXT NOT NULL' },
            { name: 'guestNotes', definition: 'TEXT' },
            { name: 'startsAt', definition: 'TIMESTAMPTZ NOT NULL' },
            { name: 'endsAt', definition: 'TIMESTAMPTZ NOT NULL' },
            { name: 'meetUrl', definition: 'TEXT' },
            { name: 'status', definition: "TEXT NOT NULL DEFAULT 'confirmed'" },
            { name: 'cancelToken', definition: 'TEXT' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'AppointmentBooking_pkey', statement: 'ALTER TABLE "AppointmentBooking" ADD CONSTRAINT "AppointmentBooking_pkey" PRIMARY KEY ("id")' },
            { name: 'AppointmentBooking_scheduleId_fkey', statement: 'ALTER TABLE "AppointmentBooking" ADD CONSTRAINT "AppointmentBooking_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "AppointmentSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
            { name: 'AppointmentBooking_cancelToken_key', statement: 'ALTER TABLE "AppointmentBooking" ADD CONSTRAINT "AppointmentBooking_cancelToken_key" UNIQUE ("cancelToken")' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "AppointmentBooking_scheduleId_idx" ON "AppointmentBooking" ("scheduleId")',
            'CREATE INDEX IF NOT EXISTS "AppointmentBooking_startsAt_idx" ON "AppointmentBooking" ("startsAt")',
            'CREATE INDEX IF NOT EXISTS "AppointmentBooking_guestEmail_idx" ON "AppointmentBooking" ("guestEmail")',
            'CREATE INDEX IF NOT EXISTS "AppointmentBooking_cancelToken_idx" ON "AppointmentBooking" ("cancelToken")',
            `DO $$
            BEGIN
                CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentBooking_scheduleId_startsAt_confirmed_key"
                    ON "AppointmentBooking" ("scheduleId", "startsAt") WHERE "status" = 'confirmed';
            EXCEPTION
                WHEN unique_violation THEN
                    RAISE NOTICE 'AppointmentBooking: hay reservas confirmadas duplicadas; indice unico parcial omitido.';
            END $$`,
        ],
    },
    {
        name: 'Contact',
        createStatement: `CREATE TABLE IF NOT EXISTS "Contact" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "email" TEXT NOT NULL,
            "name" TEXT,
            "source" TEXT NOT NULL DEFAULT 'local',
            "externalId" TEXT,
            "notes" TEXT,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'email', definition: 'TEXT NOT NULL' },
            { name: 'name', definition: 'TEXT' },
            { name: 'source', definition: "TEXT NOT NULL DEFAULT 'local'" },
            { name: 'externalId', definition: 'TEXT' },
            { name: 'notes', definition: 'TEXT' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'Contact_pkey', statement: 'ALTER TABLE "Contact" ADD CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")' },
            { name: 'Contact_userId_email_key', statement: 'ALTER TABLE "Contact" ADD CONSTRAINT "Contact_userId_email_key" UNIQUE ("userId", "email")' },
            { name: 'Contact_userId_fkey', statement: 'ALTER TABLE "Contact" ADD CONSTRAINT "Contact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "Contact_userId_idx" ON "Contact" ("userId")',
            'CREATE INDEX IF NOT EXISTS "Contact_source_idx" ON "Contact" ("source")',
        ],
    },
    // ---- Seguridad (aditivo): auditoria persistente, MFA TOTP y revocacion de sesiones. Acceso por SQL crudo. ----
    {
        name: 'AuditEvent',
        createStatement: `CREATE TABLE IF NOT EXISTS "AuditEvent" (
            "id" TEXT NOT NULL,
            "ts" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "event" TEXT NOT NULL,
            "userId" TEXT,
            "ip" TEXT,
            "data" JSONB NOT NULL DEFAULT '{}'::jsonb
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'ts', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'event', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT' },
            { name: 'ip', definition: 'TEXT' },
            { name: 'data', definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
        ],
        constraints: [
            { name: 'AuditEvent_pkey', statement: 'ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "AuditEvent_ts_idx" ON "AuditEvent" ("ts")',
            'CREATE INDEX IF NOT EXISTS "AuditEvent_userId_ts_idx" ON "AuditEvent" ("userId", "ts")',
            'CREATE INDEX IF NOT EXISTS "AuditEvent_event_ts_idx" ON "AuditEvent" ("event", "ts")',
        ],
    },
    // ---- Extensiones (aditivo): almacenamiento KV y notificaciones de services.storage / services.notify. SQL crudo. ----
    {
        name: 'ExtensionStorage',
        createStatement: `CREATE TABLE IF NOT EXISTS "ExtensionStorage" (
            "userId" TEXT NOT NULL,
            "extensionId" TEXT NOT NULL,
            "key" TEXT NOT NULL,
            "value" TEXT NOT NULL,
            "bytes" INTEGER NOT NULL,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'extensionId', definition: 'TEXT NOT NULL' },
            { name: 'key', definition: 'TEXT NOT NULL' },
            { name: 'value', definition: 'TEXT NOT NULL' },
            { name: 'bytes', definition: 'INTEGER NOT NULL' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'ExtensionStorage_pkey', statement: 'ALTER TABLE "ExtensionStorage" ADD CONSTRAINT "ExtensionStorage_pkey" PRIMARY KEY ("userId", "extensionId", "key")' },
            { name: 'ExtensionStorage_userId_fkey', statement: 'ALTER TABLE "ExtensionStorage" ADD CONSTRAINT "ExtensionStorage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
    },
    {
        name: 'ExtensionNotification',
        createStatement: `CREATE TABLE IF NOT EXISTS "ExtensionNotification" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "extensionId" TEXT NOT NULL,
            "level" TEXT NOT NULL DEFAULT 'info',
            "title" TEXT,
            "message" TEXT NOT NULL,
            "url" TEXT,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "deliveredAt" TIMESTAMPTZ
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'extensionId', definition: 'TEXT NOT NULL' },
            { name: 'level', definition: "TEXT NOT NULL DEFAULT 'info'" },
            { name: 'title', definition: 'TEXT' },
            { name: 'message', definition: 'TEXT NOT NULL' },
            { name: 'url', definition: 'TEXT' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'deliveredAt', definition: 'TIMESTAMPTZ' },
        ],
        constraints: [
            { name: 'ExtensionNotification_pkey', statement: 'ALTER TABLE "ExtensionNotification" ADD CONSTRAINT "ExtensionNotification_pkey" PRIMARY KEY ("id")' },
            { name: 'ExtensionNotification_userId_fkey', statement: 'ALTER TABLE "ExtensionNotification" ADD CONSTRAINT "ExtensionNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "ExtensionNotification_pending_idx" ON "ExtensionNotification" ("userId", "createdAt") WHERE "deliveredAt" IS NULL',
            'CREATE INDEX IF NOT EXISTS "ExtensionNotification_createdAt_idx" ON "ExtensionNotification" ("createdAt")',
        ],
    },
    {
        name: 'UserMfa',
        createStatement: `CREATE TABLE IF NOT EXISTS "UserMfa" (
            "userId" TEXT NOT NULL,
            "secretEnc" TEXT NOT NULL,
            "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
            "lastStep" BIGINT NOT NULL DEFAULT 0,
            "recoveryHashes" JSONB NOT NULL DEFAULT '[]'::jsonb,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "confirmedAt" TIMESTAMPTZ,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'secretEnc', definition: 'TEXT NOT NULL' },
            { name: 'enabled', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'lastStep', definition: 'BIGINT NOT NULL DEFAULT 0' },
            { name: 'recoveryHashes', definition: "JSONB NOT NULL DEFAULT '[]'::jsonb" },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'confirmedAt', definition: 'TIMESTAMPTZ' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'UserMfa_pkey', statement: 'ALTER TABLE "UserMfa" ADD CONSTRAINT "UserMfa_pkey" PRIMARY KEY ("userId")' },
            { name: 'UserMfa_userId_fkey', statement: 'ALTER TABLE "UserMfa" ADD CONSTRAINT "UserMfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
    },
    {
        name: 'RevokedSession',
        createStatement: `CREATE TABLE IF NOT EXISTS "RevokedSession" (
            "jti" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "expiresAt" TIMESTAMPTZ NOT NULL,
            "revokedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'jti', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'expiresAt', definition: 'TIMESTAMPTZ NOT NULL' },
            { name: 'revokedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'RevokedSession_pkey', statement: 'ALTER TABLE "RevokedSession" ADD CONSTRAINT "RevokedSession_pkey" PRIMARY KEY ("jti")' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "RevokedSession_expiresAt_idx" ON "RevokedSession" ("expiresAt")',
            'CREATE INDEX IF NOT EXISTS "RevokedSession_userId_idx" ON "RevokedSession" ("userId")',
        ],
    },
    {
        name: 'ElixirTemplate',
        createStatement: `CREATE TABLE IF NOT EXISTS "ElixirTemplate" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "name" TEXT NOT NULL,
            "subject" TEXT NOT NULL DEFAULT '',
            "body" TEXT NOT NULL DEFAULT '',
            "senderConfig" JSONB NOT NULL DEFAULT '{}'::jsonb,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'name', definition: 'TEXT NOT NULL' },
            { name: 'subject', definition: "TEXT NOT NULL DEFAULT ''" },
            { name: 'body', definition: "TEXT NOT NULL DEFAULT ''" },
            { name: 'senderConfig', definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'ElixirTemplate_pkey', statement: 'ALTER TABLE "ElixirTemplate" ADD CONSTRAINT "ElixirTemplate_pkey" PRIMARY KEY ("id")' },
            { name: 'ElixirTemplate_userId_fkey', statement: 'ALTER TABLE "ElixirTemplate" ADD CONSTRAINT "ElixirTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE UNIQUE INDEX IF NOT EXISTS "ElixirTemplate_userId_name_key" ON "ElixirTemplate" ("userId", "name")',
            'CREATE INDEX IF NOT EXISTS "ElixirTemplate_userId_updatedAt_idx" ON "ElixirTemplate" ("userId", "updatedAt")',
        ],
    },
    {
        name: 'ElixirCampaign',
        createStatement: `CREATE TABLE IF NOT EXISTS "ElixirCampaign" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "name" TEXT NOT NULL DEFAULT '',
            "status" TEXT NOT NULL DEFAULT 'draft',
            "subject" TEXT NOT NULL,
            "template" TEXT NOT NULL,
            "senderConfig" JSONB NOT NULL DEFAULT '{}'::jsonb,
            "options" JSONB NOT NULL DEFAULT '{}'::jsonb,
            "total" INTEGER NOT NULL DEFAULT 0,
            "lockedUntil" TIMESTAMPTZ,
            "lastError" TEXT,
            "startedAt" TIMESTAMPTZ,
            "finishedAt" TIMESTAMPTZ,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'name', definition: "TEXT NOT NULL DEFAULT ''" },
            { name: 'status', definition: "TEXT NOT NULL DEFAULT 'draft'" },
            { name: 'subject', definition: 'TEXT NOT NULL' },
            { name: 'template', definition: 'TEXT NOT NULL' },
            { name: 'senderConfig', definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
            { name: 'options', definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
            { name: 'total', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'lockedUntil', definition: 'TIMESTAMPTZ' },
            { name: 'lastError', definition: 'TEXT' },
            { name: 'startedAt', definition: 'TIMESTAMPTZ' },
            { name: 'finishedAt', definition: 'TIMESTAMPTZ' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'ElixirCampaign_pkey', statement: 'ALTER TABLE "ElixirCampaign" ADD CONSTRAINT "ElixirCampaign_pkey" PRIMARY KEY ("id")' },
            { name: 'ElixirCampaign_userId_fkey', statement: 'ALTER TABLE "ElixirCampaign" ADD CONSTRAINT "ElixirCampaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "ElixirCampaign_userId_createdAt_idx" ON "ElixirCampaign" ("userId", "createdAt")',
            'CREATE INDEX IF NOT EXISTS "ElixirCampaign_status_idx" ON "ElixirCampaign" ("status")',
        ],
    },
    {
        name: 'ElixirCampaignRow',
        createStatement: `CREATE TABLE IF NOT EXISTS "ElixirCampaignRow" (
            "campaignId" TEXT NOT NULL,
            "idx" INTEGER NOT NULL,
            "email" TEXT NOT NULL DEFAULT '',
            "recipient" TEXT,
            "data" JSONB NOT NULL DEFAULT '{}'::jsonb,
            "status" TEXT NOT NULL DEFAULT 'pending',
            "attempts" INTEGER NOT NULL DEFAULT 0,
            "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "message" TEXT,
            "code" TEXT,
            "resendEmailId" TEXT,
            "sentAt" TIMESTAMPTZ,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'campaignId', definition: 'TEXT NOT NULL' },
            { name: 'idx', definition: 'INTEGER NOT NULL' },
            { name: 'email', definition: "TEXT NOT NULL DEFAULT ''" },
            { name: 'recipient', definition: 'TEXT' },
            { name: 'data', definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
            { name: 'status', definition: "TEXT NOT NULL DEFAULT 'pending'" },
            { name: 'attempts', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'nextAttemptAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'message', definition: 'TEXT' },
            { name: 'code', definition: 'TEXT' },
            { name: 'resendEmailId', definition: 'TEXT' },
            { name: 'sentAt', definition: 'TIMESTAMPTZ' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'ElixirCampaignRow_pkey', statement: 'ALTER TABLE "ElixirCampaignRow" ADD CONSTRAINT "ElixirCampaignRow_pkey" PRIMARY KEY ("campaignId", "idx")' },
            { name: 'ElixirCampaignRow_campaignId_fkey', statement: 'ALTER TABLE "ElixirCampaignRow" ADD CONSTRAINT "ElixirCampaignRow_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ElixirCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            // Idempotencia por (campana, destinatario): "recipient" es NULL en filas no enviables (invalidas/duplicadas).
            'CREATE UNIQUE INDEX IF NOT EXISTS "ElixirCampaignRow_campaignId_recipient_key" ON "ElixirCampaignRow" ("campaignId", "recipient")',
            'CREATE INDEX IF NOT EXISTS "ElixirCampaignRow_campaignId_status_nextAttemptAt_idx" ON "ElixirCampaignRow" ("campaignId", "status", "nextAttemptAt")',
            'CREATE INDEX IF NOT EXISTS "ElixirCampaignRow_resendEmailId_idx" ON "ElixirCampaignRow" ("resendEmailId")',
            'CREATE INDEX IF NOT EXISTS "ElixirCampaignRow_sentAt_idx" ON "ElixirCampaignRow" ("sentAt")',
        ],
    },
    // ---- Consola de administracion (aditivo, SQL crudo; ver src/lib/admin/*) ----
    // Estado administrativo por usuario (deshabilitado, cambio de clave forzado, ultimo acceso). Tabla aparte a proposito:
    // asi "User" no cambia y las consultas existentes no dependen de columnas nuevas.
    {
        name: 'UserAdminState',
        createStatement: `CREATE TABLE IF NOT EXISTS "UserAdminState" (
            "userId" TEXT NOT NULL,
            "disabled" BOOLEAN NOT NULL DEFAULT FALSE,
            "disabledAt" TIMESTAMPTZ,
            "mustChangePassword" BOOLEAN NOT NULL DEFAULT FALSE,
            "lastLoginAt" TIMESTAMPTZ,
            "lastLoginIp" TEXT,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'disabled', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'disabledAt', definition: 'TIMESTAMPTZ' },
            { name: 'mustChangePassword', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'lastLoginAt', definition: 'TIMESTAMPTZ' },
            { name: 'lastLoginIp', definition: 'TEXT' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'UserAdminState_pkey', statement: 'ALTER TABLE "UserAdminState" ADD CONSTRAINT "UserAdminState_pkey" PRIMARY KEY ("userId")' },
            { name: 'UserAdminState_userId_fkey', statement: 'ALTER TABLE "UserAdminState" ADD CONSTRAINT "UserAdminState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "UserAdminState_disabled_idx" ON "UserAdminState" ("disabled") WHERE "disabled" = TRUE',
            'CREATE INDEX IF NOT EXISTS "UserAdminState_lastLoginAt_idx" ON "UserAdminState" ("lastLoginAt")',
        ],
    },
    // Registro de sesiones emitidas (el JWT es sin estado: sin esto no se pueden LISTAR). `tv` = User.tokenVersion al emitir:
    // la sesion sigue activa mientras tv >= User.tokenVersion y su jti no este en RevokedSession.
    {
        name: 'UserSession',
        createStatement: `CREATE TABLE IF NOT EXISTS "UserSession" (
            "jti" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "tv" INTEGER NOT NULL DEFAULT 0,
            "mfa" BOOLEAN NOT NULL DEFAULT FALSE,
            "ip" TEXT,
            "userAgent" TEXT,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "expiresAt" TIMESTAMPTZ NOT NULL
        )`,
        columns: [
            { name: 'jti', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'tv', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'mfa', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'ip', definition: 'TEXT' },
            { name: 'userAgent', definition: 'TEXT' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'expiresAt', definition: 'TIMESTAMPTZ NOT NULL' },
        ],
        constraints: [
            { name: 'UserSession_pkey', statement: 'ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_pkey" PRIMARY KEY ("jti")' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "UserSession_userId_createdAt_idx" ON "UserSession" ("userId", "createdAt" DESC)',
            'CREATE INDEX IF NOT EXISTS "UserSession_expiresAt_idx" ON "UserSession" ("expiresAt")',
        ],
    },
    // Tokens de la CLI de administracion (bloomx-cli / consola). Solo se guarda el SHA-256 del token; ver src/lib/admin-cli/tokens.ts.
    {
        name: 'AdminCliToken',
        createStatement: `CREATE TABLE IF NOT EXISTS "AdminCliToken" (
            "id" TEXT NOT NULL,
            "tokenHash" TEXT NOT NULL,
            "name" TEXT NOT NULL,
            "kind" TEXT NOT NULL,
            "adminId" TEXT NOT NULL,
            "adminEmail" TEXT,
            "scopes" TEXT NOT NULL DEFAULT 'read',
            "domain" TEXT,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "expiresAt" TIMESTAMPTZ NOT NULL,
            "lastUsedAt" TIMESTAMPTZ,
            "lastUsedIp" TEXT,
            "lastUsedUa" TEXT,
            "createdIp" TEXT,
            "revokedAt" TIMESTAMPTZ,
            "managerSessionEnc" TEXT,
            "permission_level" SMALLINT NOT NULL DEFAULT 1,
            "class" TEXT NOT NULL DEFAULT 'interactive'
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'tokenHash', definition: 'TEXT NOT NULL' },
            { name: 'name', definition: 'TEXT NOT NULL' },
            { name: 'kind', definition: 'TEXT NOT NULL' },
            { name: 'adminId', definition: 'TEXT NOT NULL' },
            { name: 'adminEmail', definition: 'TEXT' },
            { name: 'scopes', definition: "TEXT NOT NULL DEFAULT 'read'" },
            { name: 'domain', definition: 'TEXT' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'expiresAt', definition: 'TIMESTAMPTZ NOT NULL' },
            { name: 'lastUsedAt', definition: 'TIMESTAMPTZ' },
            { name: 'lastUsedIp', definition: 'TEXT' },
            { name: 'lastUsedUa', definition: 'TEXT' },
            { name: 'createdIp', definition: 'TEXT' },
            { name: 'revokedAt', definition: 'TIMESTAMPTZ' },
            { name: 'managerSessionEnc', definition: 'TEXT' },
            // Tope de nivel de la cuenta al emitir el token (el nivel efectivo es min(este, el actual de la cuenta)).
            { name: 'permission_level', definition: 'SMALLINT NOT NULL DEFAULT 1' },
            // interactive (ocupa el slot de sesion privilegiada) | machine (automatizacion: solo lectura, corta duracion, no ocupa el slot)
            { name: 'class', definition: "TEXT NOT NULL DEFAULT 'interactive'" },
        ],
        constraints: [
            { name: 'AdminCliToken_pkey', statement: 'ALTER TABLE "AdminCliToken" ADD CONSTRAINT "AdminCliToken_pkey" PRIMARY KEY ("id")' },
        ],
        indexes: [
            'CREATE UNIQUE INDEX IF NOT EXISTS "AdminCliToken_tokenHash_key" ON "AdminCliToken" ("tokenHash")',
            'CREATE INDEX IF NOT EXISTS "AdminCliToken_adminId_idx" ON "AdminCliToken" ("adminId", "createdAt" DESC)',
        ],
    },
    // Niveles de permisos de la administracion (0 user .. 4 superadmin). ADMIN_EMAILS sigue siendo semilla/rescate (nivel 4 fijado por
    // entorno); aqui solo viven las concesiones hechas desde la consola/CLI. Ver src/lib/permissions-core.ts y permissions.ts.
    {
        name: 'UserPermission',
        createStatement: `CREATE TABLE IF NOT EXISTS "UserPermission" (
            "email" TEXT NOT NULL,
            "userId" TEXT,
            "permission_level" SMALLINT NOT NULL DEFAULT 0,
            "grantedBy" TEXT,
            "grantedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "note" TEXT
        )`,
        columns: [
            { name: 'email', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT' },
            { name: 'permission_level', definition: 'SMALLINT NOT NULL DEFAULT 0' },
            { name: 'grantedBy', definition: 'TEXT' },
            { name: 'grantedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'note', definition: 'TEXT' },
        ],
        constraints: [
            { name: 'UserPermission_pkey', statement: 'ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("email")' },
            { name: 'UserPermission_level_check', statement: 'ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_level_check" CHECK ("permission_level" BETWEEN 0 AND 4)' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "UserPermission_level_idx" ON "UserPermission" ("permission_level") WHERE "permission_level" > 0',
        ],
    },
    // Historial inmutable de cambios de nivel (quien, a quien, anterior -> nuevo, IP). Solo se inserta.
    {
        name: 'UserPermissionHistory',
        createStatement: `CREATE TABLE IF NOT EXISTS "UserPermissionHistory" (
            "id" TEXT NOT NULL,
            "email" TEXT NOT NULL,
            "userId" TEXT,
            "previousLevel" SMALLINT NOT NULL,
            "newLevel" SMALLINT NOT NULL,
            "changedBy" TEXT,
            "changedByLevel" SMALLINT,
            "changedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "ip" TEXT,
            "source" TEXT,
            "note" TEXT
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'email', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT' },
            { name: 'previousLevel', definition: 'SMALLINT NOT NULL' },
            { name: 'newLevel', definition: 'SMALLINT NOT NULL' },
            { name: 'changedBy', definition: 'TEXT' },
            { name: 'changedByLevel', definition: 'SMALLINT' },
            { name: 'changedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'ip', definition: 'TEXT' },
            { name: 'source', definition: 'TEXT' },
            { name: 'note', definition: 'TEXT' },
        ],
        constraints: [
            { name: 'UserPermissionHistory_pkey', statement: 'ALTER TABLE "UserPermissionHistory" ADD CONSTRAINT "UserPermissionHistory_pkey" PRIMARY KEY ("id")' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "UserPermissionHistory_email_idx" ON "UserPermissionHistory" ("email", "changedAt" DESC)',
            'CREATE INDEX IF NOT EXISTS "UserPermissionHistory_changedAt_idx" ON "UserPermissionHistory" ("changedAt" DESC)',
        ],
    },
    // UNA sola sesion privilegiada (admin web o CLI interactivo) por cuenta con permission_level >= 1. Ver src/lib/privileged-session.ts.
    {
        name: 'PrivilegedSession',
        createStatement: `CREATE TABLE IF NOT EXISTS "PrivilegedSession" (
            "userId" TEXT NOT NULL,
            "kind" TEXT NOT NULL,
            "sessionRef" TEXT NOT NULL,
            "ip" TEXT,
            "userAgent" TEXT,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'kind', definition: 'TEXT NOT NULL' },
            { name: 'sessionRef', definition: 'TEXT NOT NULL' },
            { name: 'ip', definition: 'TEXT' },
            { name: 'userAgent', definition: 'TEXT' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'lastSeenAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'PrivilegedSession_pkey', statement: 'ALTER TABLE "PrivilegedSession" ADD CONSTRAINT "PrivilegedSession_pkey" PRIMARY KEY ("userId")' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "PrivilegedSession_ref_idx" ON "PrivilegedSession" ("sessionRef")',
        ],
    },
    // Bloqueo del acceso privilegiado de una cuenta por "pelea de sesiones" (>= umbral de reemplazos en la ventana). Solo lo levanta un superadmin
    // (perms unlock, con step-up) o el rescate por entorno ADMIN_LOCKOUT_RESET. No afecta al correo web normal de la cuenta.
    {
        name: 'PrivilegedLock',
        createStatement: `CREATE TABLE IF NOT EXISTS "PrivilegedLock" (
            "userId" TEXT NOT NULL,
            "email" TEXT,
            "lockedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "replacements" INTEGER NOT NULL DEFAULT 0,
            "reason" TEXT NOT NULL DEFAULT 'session_fight'
        )`,
        columns: [
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'email', definition: 'TEXT' },
            { name: 'lockedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'replacements', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'reason', definition: "TEXT NOT NULL DEFAULT 'session_fight'" },
        ],
        constraints: [
            { name: 'PrivilegedLock_pkey', statement: 'ALTER TABLE "PrivilegedLock" ADD CONSTRAINT "PrivilegedLock_pkey" PRIMARY KEY ("userId")' },
        ],
    },
    // Por que termino una sesion privilegiada (superseded | expired_idle | expired_absolute | closed): permite el mensaje claro al volver a usarla.
    {
        name: 'PrivilegedSessionEnd',
        createStatement: `CREATE TABLE IF NOT EXISTS "PrivilegedSessionEnd" (
            "sessionRef" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "kind" TEXT NOT NULL,
            "reason" TEXT NOT NULL,
            "endedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "byKind" TEXT,
            "byIp" TEXT,
            "byUserAgent" TEXT
        )`,
        columns: [
            { name: 'sessionRef', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'kind', definition: 'TEXT NOT NULL' },
            { name: 'reason', definition: 'TEXT NOT NULL' },
            { name: 'endedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'byKind', definition: 'TEXT' },
            { name: 'byIp', definition: 'TEXT' },
            { name: 'byUserAgent', definition: 'TEXT' },
        ],
        constraints: [
            { name: 'PrivilegedSessionEnd_pkey', statement: 'ALTER TABLE "PrivilegedSessionEnd" ADD CONSTRAINT "PrivilegedSessionEnd_pkey" PRIMARY KEY ("sessionRef")' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "PrivilegedSessionEnd_endedAt_idx" ON "PrivilegedSessionEnd" ("endedAt")',
        ],
    },
    // Politicas editables desde la consola (retencion). Sustituyen a la variable de entorno cuando existen.
    {
        name: 'AdminSetting',
        createStatement: `CREATE TABLE IF NOT EXISTS "AdminSetting" (
            "key" TEXT NOT NULL,
            "value" JSONB NOT NULL DEFAULT 'null'::jsonb,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedBy" TEXT
        )`,
        columns: [
            { name: 'key', definition: 'TEXT NOT NULL' },
            { name: 'value', definition: "JSONB NOT NULL DEFAULT 'null'::jsonb" },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedBy', definition: 'TEXT' },
        ],
        constraints: [
            { name: 'AdminSetting_pkey', statement: 'ALTER TABLE "AdminSetting" ADD CONSTRAINT "AdminSetting_pkey" PRIMARY KEY ("key")' },
        ],
    },
    // Spam v2: listas de bloqueo / permitidos / externos de confianza (dominio o usuario). Ver src/lib/spam/lists-store.ts.
    {
        name: 'SpamList',
        createStatement: `CREATE TABLE IF NOT EXISTS "SpamList" (
            "id" TEXT NOT NULL,
            "scope" TEXT NOT NULL,
            "ownerKey" TEXT NOT NULL,
            "kind" TEXT NOT NULL,
            "matchType" TEXT NOT NULL,
            "value" TEXT NOT NULL,
            "includeSubdomains" BOOLEAN NOT NULL DEFAULT FALSE,
            "reason" TEXT,
            "expiresAt" TIMESTAMPTZ,
            "createdBy" TEXT,
            "hits" INTEGER NOT NULL DEFAULT 0,
            "lastHitAt" TIMESTAMPTZ,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'scope', definition: 'TEXT NOT NULL' },
            { name: 'ownerKey', definition: 'TEXT NOT NULL' },
            { name: 'kind', definition: 'TEXT NOT NULL' },
            { name: 'matchType', definition: 'TEXT NOT NULL' },
            { name: 'value', definition: 'TEXT NOT NULL' },
            { name: 'includeSubdomains', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'reason', definition: 'TEXT' },
            { name: 'expiresAt', definition: 'TIMESTAMPTZ' },
            { name: 'createdBy', definition: 'TEXT' },
            { name: 'hits', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'lastHitAt', definition: 'TIMESTAMPTZ' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'SpamList_pkey', statement: 'ALTER TABLE "SpamList" ADD CONSTRAINT "SpamList_pkey" PRIMARY KEY ("id")' },
            { name: 'SpamList_scope_check', statement: 'ALTER TABLE "SpamList" ADD CONSTRAINT "SpamList_scope_check" CHECK ("scope" IN (\'domain\', \'user\'))' },
            { name: 'SpamList_kind_check', statement: 'ALTER TABLE "SpamList" ADD CONSTRAINT "SpamList_kind_check" CHECK ("kind" IN (\'allow\', \'block\', \'external\'))' },
            { name: 'SpamList_matchType_check', statement: 'ALTER TABLE "SpamList" ADD CONSTRAINT "SpamList_matchType_check" CHECK ("matchType" IN (\'email\', \'domain\', \'wildcard\', \'tld\', \'regex\'))' },
        ],
        indexes: [
            // Una misma regla no se repite en una lista (dedupe atomico incluso con altas concurrentes).
            'CREATE UNIQUE INDEX IF NOT EXISTS "SpamList_unique_idx" ON "SpamList" ("scope", "ownerKey", "kind", "matchType", "value", "includeSubdomains")',
            'CREATE INDEX IF NOT EXISTS "SpamList_owner_kind_idx" ON "SpamList" ("scope", "ownerKey", "kind", "createdAt" DESC)',
            'CREATE INDEX IF NOT EXISTS "SpamList_expiresAt_idx" ON "SpamList" ("expiresAt") WHERE "expiresAt" IS NOT NULL',
        ],
    },
    // Spam v2: modelo bayesiano por usuario (tokens con hash truncado). La fila tokenHash='__n' guarda los contadores de mensajes.
    {
        name: 'SpamToken',
        createStatement: `CREATE TABLE IF NOT EXISTS "SpamToken" (
            "userId" TEXT NOT NULL,
            "tokenHash" TEXT NOT NULL,
            "spam" INTEGER NOT NULL DEFAULT 0,
            "ham" INTEGER NOT NULL DEFAULT 0,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'tokenHash', definition: 'TEXT NOT NULL' },
            { name: 'spam', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'ham', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'SpamToken_pkey', statement: 'ALTER TABLE "SpamToken" ADD CONSTRAINT "SpamToken_pkey" PRIMARY KEY ("userId", "tokenHash")' },
            { name: 'SpamToken_userId_fkey', statement: 'ALTER TABLE "SpamToken" ADD CONSTRAINT "SpamToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: ['CREATE INDEX IF NOT EXISTS "SpamToken_user_updated_idx" ON "SpamToken" ("userId", "updatedAt" DESC)'],
    },
    // Spam v2: contadores de marcas del usuario por remitente (e:direccion) y dominio (d:dominio).
    {
        name: 'SpamSender',
        createStatement: `CREATE TABLE IF NOT EXISTS "SpamSender" (
            "userId" TEXT NOT NULL,
            "senderKey" TEXT NOT NULL,
            "spamCount" INTEGER NOT NULL DEFAULT 0,
            "hamCount" INTEGER NOT NULL DEFAULT 0,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'senderKey', definition: 'TEXT NOT NULL' },
            { name: 'spamCount', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'hamCount', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'SpamSender_pkey', statement: 'ALTER TABLE "SpamSender" ADD CONSTRAINT "SpamSender_pkey" PRIMARY KEY ("userId", "senderKey")' },
            { name: 'SpamSender_userId_fkey', statement: 'ALTER TABLE "SpamSender" ADD CONSTRAINT "SpamSender_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
    },
    // Spam v2: registro ligero de decisiones (sin contenido). Retencion configurable (lib/spam/events-store.ts).
    {
        name: 'SpamEvent',
        createStatement: `CREATE TABLE IF NOT EXISTS "SpamEvent" (
            "id" TEXT NOT NULL,
            "ts" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "userId" TEXT,
            "recipient" TEXT,
            "sender" TEXT NOT NULL,
            "senderDomain" TEXT,
            "decision" TEXT NOT NULL,
            "score" INTEGER,
            "ruleId" TEXT,
            "ruleLabel" TEXT,
            "reasons" JSONB NOT NULL DEFAULT '[]'::jsonb,
            "external" BOOLEAN NOT NULL DEFAULT FALSE
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'ts', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'userId', definition: 'TEXT' },
            { name: 'recipient', definition: 'TEXT' },
            { name: 'sender', definition: 'TEXT NOT NULL' },
            { name: 'senderDomain', definition: 'TEXT' },
            { name: 'decision', definition: 'TEXT NOT NULL' },
            { name: 'score', definition: 'INTEGER' },
            { name: 'ruleId', definition: 'TEXT' },
            { name: 'ruleLabel', definition: 'TEXT' },
            { name: 'reasons', definition: "JSONB NOT NULL DEFAULT '[]'::jsonb" },
            { name: 'external', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
        ],
        constraints: [
            { name: 'SpamEvent_pkey', statement: 'ALTER TABLE "SpamEvent" ADD CONSTRAINT "SpamEvent_pkey" PRIMARY KEY ("id")' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "SpamEvent_ts_idx" ON "SpamEvent" ("ts" DESC)',
            'CREATE INDEX IF NOT EXISTS "SpamEvent_decision_ts_idx" ON "SpamEvent" ("decision", "ts" DESC)',
            'CREATE INDEX IF NOT EXISTS "SpamEvent_domain_ts_idx" ON "SpamEvent" ("senderDomain", "ts" DESC)',
        ],
    },
    // Registro de reuniones de la fachada de conferencias: idempotencia persistente + propiedad (lib/conferencing/ledger.ts).
    {
        name: 'ConferenceMeeting',
        createStatement: `CREATE TABLE IF NOT EXISTS "ConferenceMeeting" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "provider" TEXT NOT NULL,
            "meetingId" TEXT NOT NULL,
            "joinUrl" TEXT NOT NULL,
            "hostUrl" TEXT,
            "idempotencyKey" TEXT,
            "status" TEXT NOT NULL DEFAULT 'ready',
            "payload" JSONB,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'provider', definition: 'TEXT NOT NULL' },
            { name: 'meetingId', definition: 'TEXT NOT NULL' },
            { name: 'joinUrl', definition: 'TEXT NOT NULL' },
            { name: 'hostUrl', definition: 'TEXT' },
            { name: 'idempotencyKey', definition: 'TEXT' },
            { name: 'status', definition: "TEXT NOT NULL DEFAULT 'ready'" },
            { name: 'payload', definition: 'JSONB' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'ConferenceMeeting_pkey', statement: 'ALTER TABLE "ConferenceMeeting" ADD CONSTRAINT "ConferenceMeeting_pkey" PRIMARY KEY ("id")' },
            { name: 'ConferenceMeeting_userId_provider_idempotencyKey_key', statement: 'ALTER TABLE "ConferenceMeeting" ADD CONSTRAINT "ConferenceMeeting_userId_provider_idempotencyKey_key" UNIQUE ("userId", "provider", "idempotencyKey")' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "ConferenceMeeting_userId_provider_meetingId_idx" ON "ConferenceMeeting" ("userId", "provider", "meetingId")',
            'CREATE INDEX IF NOT EXISTS "ConferenceMeeting_createdAt_idx" ON "ConferenceMeeting" ("createdAt")',
        ],
    },
    // ---- Importar / exportar correo (aditivo; lib/mail-transfer/*, SQL crudo) ----
    // Trabajos en segundo plano por lotes (patron del worker de Elixir): estado, cursor de reanudacion, contadores, bloqueo.
    // "userId" NO tiene FK a proposito: el administrador puede ser un "manager" del backend que no es un User de la app.
    {
        name: 'MailTransferJob',
        createStatement: `CREATE TABLE IF NOT EXISTS "MailTransferJob" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "actorKind" TEXT NOT NULL DEFAULT 'user',
            "domain" TEXT NOT NULL DEFAULT '',
            "kind" TEXT NOT NULL,
            "scope" TEXT NOT NULL DEFAULT 'domain',
            "targetUserId" TEXT,
            "format" TEXT NOT NULL DEFAULT 'unknown',
            "status" TEXT NOT NULL DEFAULT 'created',
            "phase" TEXT NOT NULL DEFAULT '',
            "fileName" TEXT,
            "options" JSONB NOT NULL DEFAULT '{}'::jsonb,
            "summary" JSONB NOT NULL DEFAULT '{}'::jsonb,
            "cursor" JSONB NOT NULL DEFAULT '{}'::jsonb,
            "totalBytes" BIGINT NOT NULL DEFAULT 0,
            "uploadedBytes" BIGINT NOT NULL DEFAULT 0,
            "totalItems" INTEGER NOT NULL DEFAULT 0,
            "doneItems" INTEGER NOT NULL DEFAULT 0,
            "importedItems" INTEGER NOT NULL DEFAULT 0,
            "duplicateItems" INTEGER NOT NULL DEFAULT 0,
            "skippedItems" INTEGER NOT NULL DEFAULT 0,
            "errorItems" INTEGER NOT NULL DEFAULT 0,
            "bytesProcessed" BIGINT NOT NULL DEFAULT 0,
            "outputBytes" BIGINT NOT NULL DEFAULT 0,
            "outputSha256" TEXT,
            "lockedUntil" TIMESTAMPTZ,
            "lastError" TEXT,
            "cancelRequested" BOOLEAN NOT NULL DEFAULT FALSE,
            "downloadedAt" TIMESTAMPTZ,
            "expiresAt" TIMESTAMPTZ,
            "startedAt" TIMESTAMPTZ,
            "finishedAt" TIMESTAMPTZ,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'actorKind', definition: "TEXT NOT NULL DEFAULT 'user'" },
            { name: 'domain', definition: "TEXT NOT NULL DEFAULT ''" },
            { name: 'kind', definition: 'TEXT NOT NULL' },
            { name: 'scope', definition: "TEXT NOT NULL DEFAULT 'domain'" },
            { name: 'targetUserId', definition: 'TEXT' },
            { name: 'format', definition: "TEXT NOT NULL DEFAULT 'unknown'" },
            { name: 'status', definition: "TEXT NOT NULL DEFAULT 'created'" },
            { name: 'phase', definition: "TEXT NOT NULL DEFAULT ''" },
            { name: 'fileName', definition: 'TEXT' },
            { name: 'options', definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
            { name: 'summary', definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
            { name: 'cursor', definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
            { name: 'totalBytes', definition: 'BIGINT NOT NULL DEFAULT 0' },
            { name: 'uploadedBytes', definition: 'BIGINT NOT NULL DEFAULT 0' },
            { name: 'totalItems', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'doneItems', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'importedItems', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'duplicateItems', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'skippedItems', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'errorItems', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'bytesProcessed', definition: 'BIGINT NOT NULL DEFAULT 0' },
            { name: 'outputBytes', definition: 'BIGINT NOT NULL DEFAULT 0' },
            { name: 'outputSha256', definition: 'TEXT' },
            { name: 'lockedUntil', definition: 'TIMESTAMPTZ' },
            { name: 'lastError', definition: 'TEXT' },
            { name: 'cancelRequested', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'downloadedAt', definition: 'TIMESTAMPTZ' },
            { name: 'expiresAt', definition: 'TIMESTAMPTZ' },
            { name: 'startedAt', definition: 'TIMESTAMPTZ' },
            { name: 'finishedAt', definition: 'TIMESTAMPTZ' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'MailTransferJob_pkey', statement: 'ALTER TABLE "MailTransferJob" ADD CONSTRAINT "MailTransferJob_pkey" PRIMARY KEY ("id")' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "MailTransferJob_userId_createdAt_idx" ON "MailTransferJob" ("userId", "createdAt" DESC)',
            'CREATE INDEX IF NOT EXISTS "MailTransferJob_domain_status_idx" ON "MailTransferJob" ("domain", "status")',
            'CREATE INDEX IF NOT EXISTS "MailTransferJob_status_updatedAt_idx" ON "MailTransferJob" ("status", "updatedAt")',
        ],
    },
    // Una fila por mensaje importado (o por buzon exportado): idempotencia por (job, clave de origen) e informe descargable.
    {
        name: 'MailTransferItem',
        createStatement: `CREATE TABLE IF NOT EXISTS "MailTransferItem" (
            "id" BIGSERIAL NOT NULL,
            "jobId" TEXT NOT NULL,
            "mailbox" TEXT NOT NULL DEFAULT '',
            "sourceKey" TEXT NOT NULL,
            "messageId" TEXT,
            "status" TEXT NOT NULL DEFAULT 'pending',
            "error" TEXT,
            "emailId" TEXT,
            "folder" TEXT,
            "bytes" BIGINT NOT NULL DEFAULT 0,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'BIGSERIAL NOT NULL' },
            { name: 'jobId', definition: 'TEXT NOT NULL' },
            { name: 'mailbox', definition: "TEXT NOT NULL DEFAULT ''" },
            { name: 'sourceKey', definition: 'TEXT NOT NULL' },
            { name: 'messageId', definition: 'TEXT' },
            { name: 'status', definition: "TEXT NOT NULL DEFAULT 'pending'" },
            { name: 'error', definition: 'TEXT' },
            { name: 'emailId', definition: 'TEXT' },
            { name: 'folder', definition: 'TEXT' },
            { name: 'bytes', definition: 'BIGINT NOT NULL DEFAULT 0' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'MailTransferItem_pkey', statement: 'ALTER TABLE "MailTransferItem" ADD CONSTRAINT "MailTransferItem_pkey" PRIMARY KEY ("id")' },
            { name: 'MailTransferItem_jobId_fkey', statement: 'ALTER TABLE "MailTransferItem" ADD CONSTRAINT "MailTransferItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MailTransferJob"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE UNIQUE INDEX IF NOT EXISTS "MailTransferItem_jobId_sourceKey_key" ON "MailTransferItem" ("jobId", "sourceKey")',
            'CREATE INDEX IF NOT EXISTS "MailTransferItem_jobId_status_idx" ON "MailTransferItem" ("jobId", "status")',
        ],
    },
    // ---- Servicio de IA central de la instancia (aditivo; lib/ai/*, SQL crudo) ----
    // AiSettings: UNA fila por instancia (id = 'default'). La clave del proveedor va CIFRADA (lib/encryption) y nunca se devuelve.
    // AiUsage: un renglon por llamada al proveedor SIN contenido de prompts ni respuestas. AiAudit: cambios de configuracion (sin secretos).
    {
        name: 'AiSettings',
        createStatement: `CREATE TABLE IF NOT EXISTS "AiSettings" (
            "id" TEXT NOT NULL,
            "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
            "provider" TEXT,
            "model" TEXT,
            "baseUrl" TEXT,
            "apiKeyEnc" TEXT,
            "apiKeyLast4" TEXT,
            "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedBy" TEXT
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'enabled', definition: 'BOOLEAN NOT NULL DEFAULT FALSE' },
            { name: 'provider', definition: 'TEXT' },
            { name: 'model', definition: 'TEXT' },
            { name: 'baseUrl', definition: 'TEXT' },
            { name: 'apiKeyEnc', definition: 'TEXT' },
            { name: 'apiKeyLast4', definition: 'TEXT' },
            { name: 'config', definition: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
            { name: 'updatedAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'updatedBy', definition: 'TEXT' },
        ],
        constraints: [
            { name: 'AiSettings_pkey', statement: 'ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")' },
        ],
    },
    {
        name: 'AiUsage',
        createStatement: `CREATE TABLE IF NOT EXISTS "AiUsage" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "feature" TEXT NOT NULL,
            "extensionId" TEXT,
            "provider" TEXT NOT NULL DEFAULT '',
            "model" TEXT NOT NULL DEFAULT '',
            "tokensIn" INTEGER NOT NULL DEFAULT 0,
            "tokensOut" INTEGER NOT NULL DEFAULT 0,
            "ok" BOOLEAN NOT NULL DEFAULT TRUE,
            "errorCode" TEXT,
            "flags" TEXT,
            "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
            "ts" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'feature', definition: 'TEXT NOT NULL' },
            { name: 'extensionId', definition: 'TEXT' },
            { name: 'provider', definition: "TEXT NOT NULL DEFAULT ''" },
            { name: 'model', definition: "TEXT NOT NULL DEFAULT ''" },
            { name: 'tokensIn', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'tokensOut', definition: 'INTEGER NOT NULL DEFAULT 0' },
            { name: 'ok', definition: 'BOOLEAN NOT NULL DEFAULT TRUE' },
            { name: 'errorCode', definition: 'TEXT' },
            { name: 'flags', definition: 'TEXT' },
            { name: 'costUsd', definition: 'DOUBLE PRECISION NOT NULL DEFAULT 0' },
            { name: 'ts', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'AiUsage_pkey', statement: 'ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "AiUsage_ts_idx" ON "AiUsage" ("ts" DESC)',
            'CREATE INDEX IF NOT EXISTS "AiUsage_userId_ts_idx" ON "AiUsage" ("userId", "ts" DESC)',
        ],
    },
    {
        name: 'AiAudit',
        createStatement: `CREATE TABLE IF NOT EXISTS "AiAudit" (
            "id" TEXT NOT NULL,
            "actor" TEXT NOT NULL DEFAULT '',
            "action" TEXT NOT NULL,
            "fields" TEXT NOT NULL DEFAULT '',
            "ts" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'id', definition: 'TEXT NOT NULL' },
            { name: 'actor', definition: "TEXT NOT NULL DEFAULT ''" },
            { name: 'action', definition: 'TEXT NOT NULL' },
            { name: 'fields', definition: "TEXT NOT NULL DEFAULT ''" },
            { name: 'ts', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'AiAudit_pkey', statement: 'ALTER TABLE "AiAudit" ADD CONSTRAINT "AiAudit_pkey" PRIMARY KEY ("id")' },
        ],
        indexes: ['CREATE INDEX IF NOT EXISTS "AiAudit_ts_idx" ON "AiAudit" ("ts" DESC)'],
    },
    // Marketplace de extensiones: favoritas (estrellas) POR administrador de la instancia. Aditiva e idempotente; sin FK (el usuario puede ser
    // una cuenta de gestor sin fila en "User"); se lee y escribe por SQL crudo (lib/admin/extension-stars.ts).
    {
        name: 'ExtensionStar',
        createStatement: `CREATE TABLE IF NOT EXISTS "ExtensionStar" (
            "userId" TEXT NOT NULL,
            "extensionId" TEXT NOT NULL,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        columns: [
            { name: 'userId', definition: 'TEXT NOT NULL' },
            { name: 'extensionId', definition: 'TEXT NOT NULL' },
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
        ],
        constraints: [
            { name: 'ExtensionStar_pkey', statement: 'ALTER TABLE "ExtensionStar" ADD CONSTRAINT "ExtensionStar_pkey" PRIMARY KEY ("userId", "extensionId")' },
        ],
        indexes: ['CREATE INDEX IF NOT EXISTS "ExtensionStar_extensionId_idx" ON "ExtensionStar" ("extensionId")'],
    },
];

let ensureSchemaPromise: Promise<void> | null = null;

type Queryable = Pick<Pool, 'query'>;

// Clave del candado consultivo que serializa el DDL entre instancias (varios arranques serverless / build + runtime).
// Sin el, dos CREATE TABLE IF NOT EXISTS simultaneos fallan con 23505 en pg_type_typname_nsp_index (verificado en
// Postgres real, ver src/lib/__tests__/schema.pg.test.ts). Es un candado de TRANSACCION: funciona tambien tras el
// pooler de Neon (pgbouncer en modo transaccion), donde los candados de sesion no son fiables.
const DDL_LOCK_KEY = 7_262_016_001;

async function withDdlLock(pool: Pool, fn: (q: Queryable) => Promise<void>) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [DDL_LOCK_KEY]);
        await fn(client);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

async function ensureConstraint(pool: Queryable, tableName: string, constraint: ConstraintSpec) {
    await pool.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint constraint_def
                JOIN pg_class table_def ON table_def.oid = constraint_def.conrelid
                WHERE constraint_def.conname = $constraint_name$${constraint.name}$constraint_name$
                  AND table_def.relname = $table_name$${tableName}$table_name$
            ) AND NOT EXISTS (
                SELECT 1
                FROM pg_class relation_def
                WHERE relation_def.relname = $constraint_name$${constraint.name}$constraint_name$
            ) THEN
                BEGIN
                    ${constraint.statement};
                EXCEPTION
                    WHEN duplicate_object OR duplicate_table THEN
                        NULL;
                END;
            END IF;
        END $$;
    `);
}

async function ensureTable(pool: Queryable, table: TableSpec) {
    await pool.query(table.createStatement);

    for (const column of table.columns) {
        const tableName = table.name === 'push_subscriptions' ? table.name : `"${table.name}"`;
        const columnName = table.name === 'push_subscriptions' ? column.name : `"${column.name}"`;
        await pool.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} ${column.definition}`);
    }

    for (const constraint of table.constraints || []) {
        await ensureConstraint(pool, table.name, constraint);
    }

    for (const fn of table.functions || []) {
        await pool.query(fn);
    }

    for (const indexStatement of table.indexes || []) {
        await pool.query(indexStatement);
    }

    for (const statement of table.after || []) {
        await pool.query(statement);
    }
}

async function cleanupLegacyEmailAccountField(pool: Queryable) {
    // Remove legacy artifacts from previous mailbox-account implementation.
    await pool.query('DROP INDEX IF EXISTS "Email_accountEmail_idx"');
    await pool.query('ALTER TABLE "Email" DROP COLUMN IF EXISTS "accountEmail"');
}

export async function ensureDatabaseSchema() {
    if (!ensureSchemaPromise) {
        ensureSchemaPromise = (async () => {
            const pool = getDbPool();
            // Una transaccion por tabla (no una gigante): el candado se retiene poco tiempo y un fallo deja las demas intactas.
            for (const table of TABLES) {
                await withDdlLock(pool, (q) => ensureTable(q, table));
            }
            await withDdlLock(pool, (q) => cleanupLegacyEmailAccountField(q));
        })().catch((error) => {
            ensureSchemaPromise = null;
            throw error;
        });
    }

    return ensureSchemaPromise;
}

/** Nombres de las tablas que `ensureDatabaseSchema` garantiza (para comprobar el esquema desde la consola/CLI de administracion). */
export function expectedSchemaTables(): string[] {
    return TABLES.map((t) => t.name);
}
