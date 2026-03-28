import type { Pool } from 'pg';
import { getDbPool } from './pool';

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
    indexes?: string[];
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
        ],
        constraints: [
            { name: 'Account_pkey', statement: 'ALTER TABLE "Account" ADD CONSTRAINT "Account_pkey" PRIMARY KEY ("id")' },
            { name: 'Account_provider_providerAccountId_key', statement: 'ALTER TABLE "Account" ADD CONSTRAINT "Account_provider_providerAccountId_key" UNIQUE ("provider", "providerAccountId")' },
            { name: 'Account_userId_fkey', statement: 'ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
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
        ],
        constraints: [
            { name: 'Email_pkey', statement: 'ALTER TABLE "Email" ADD CONSTRAINT "Email_pkey" PRIMARY KEY ("id")' },
            { name: 'Email_messageId_key', statement: 'ALTER TABLE "Email" ADD CONSTRAINT "Email_messageId_key" UNIQUE ("messageId")' },
            { name: 'Email_userId_fkey', statement: 'ALTER TABLE "Email" ADD CONSTRAINT "Email_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "Email_to_idx" ON "Email" ("to")',
            'CREATE INDEX IF NOT EXISTS "Email_folder_idx" ON "Email" ("folder")',
            'CREATE INDEX IF NOT EXISTS "Email_createdAt_idx" ON "Email" ("createdAt")',
            'CREATE INDEX IF NOT EXISTS "Email_userId_idx" ON "Email" ("userId")',
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
            { name: 'createdAt', definition: 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' },
            { name: 'draftId', definition: 'TEXT' },
        ],
        constraints: [
            { name: 'Attachment_pkey', statement: 'ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")' },
            { name: 'Attachment_draftId_fkey', statement: 'ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
            { name: 'Attachment_emailId_fkey', statement: 'ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
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
            'CREATE INDEX IF NOT EXISTS "EmailEvent_type_idx" ON "EmailEvent" ("type")',
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
        ],
        constraints: [
            { name: 'Label_pkey', statement: 'ALTER TABLE "Label" ADD CONSTRAINT "Label_pkey" PRIMARY KEY ("id")' },
            { name: 'Label_userId_name_key', statement: 'ALTER TABLE "Label" ADD CONSTRAINT "Label_userId_name_key" UNIQUE ("userId", "name")' },
            { name: 'Label_userId_fkey', statement: 'ALTER TABLE "Label" ADD CONSTRAINT "Label_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE' },
        ],
        indexes: [
            'CREATE INDEX IF NOT EXISTS "Label_userId_idx" ON "Label" ("userId")',
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
];

let ensureSchemaPromise: Promise<void> | null = null;

async function ensureConstraint(pool: Pool, constraint: ConstraintSpec) {
    await pool.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = $constraint_name$${constraint.name}$constraint_name$
            ) THEN
                ${constraint.statement};
            END IF;
        END $$;
    `);
}

async function ensureTable(pool: Pool, table: TableSpec) {
    await pool.query(table.createStatement);

    for (const column of table.columns) {
        const tableName = table.name === 'push_subscriptions' ? table.name : `"${table.name}"`;
        const columnName = table.name === 'push_subscriptions' ? column.name : `"${column.name}"`;
        await pool.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} ${column.definition}`);
    }

    for (const constraint of table.constraints || []) {
        await ensureConstraint(pool, constraint);
    }

    for (const indexStatement of table.indexes || []) {
        await pool.query(indexStatement);
    }
}

export async function ensureDatabaseSchema() {
    if (!ensureSchemaPromise) {
        ensureSchemaPromise = (async () => {
            const pool = getDbPool();
            for (const table of TABLES) {
                await ensureTable(pool, table);
            }
        })().catch((error) => {
            ensureSchemaPromise = null;
            throw error;
        });
    }

    return ensureSchemaPromise;
}