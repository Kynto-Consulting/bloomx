// Utilidades para los tests *.pg.test.ts (Postgres embebido real). Ver vitest.pg.config.ts.
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

export function pgUrl(database = 'bloomx_test'): string {
    const port = process.env.PG_TEST_PORT;
    if (!port) throw new Error('PG_TEST_PORT no definido: ejecuta estos tests con `npm run test:pg`.');
    return `postgresql://bloomx_test:bloomx_test_pw@127.0.0.1:${port}/${database}`;
}

/** Aborta si DATABASE_URL no es el cluster embebido local (jamas tocar Neon). */
export function assertLocalPg() {
    const u = process.env.DATABASE_URL || '';
    if (!/^postgres(ql)?:\/\/[^@]*@127\.0\.0\.1:\d+\//.test(u) || u !== process.env.PG_TEST_URL) {
        throw new Error('DATABASE_URL no es el Postgres embebido de pruebas; abortando.');
    }
}

/** Crea una BD vacia adicional (p. ej. para probar el DDL desde cero) y devuelve su URL. */
export async function createFreshDatabase(name?: string): Promise<string> {
    const db = name ?? `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const admin = new Pool({ connectionString: pgUrl('postgres'), max: 1 });
    try {
        await admin.query(`CREATE DATABASE "${db}"`);
    } finally {
        await admin.end();
    }
    return pgUrl(db);
}

export function uid(prefix = 'id'): string {
    return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export async function createUser(prisma: any, email?: string) {
    return prisma.user.create({ data: { email: email ?? `${uid('u')}@pg.test`, password: 'x' } });
}

export async function createEmail(prisma: any, userId: string, over: Record<string, unknown> = {}) {
    return prisma.email.create({ data: { userId, messageId: uid('msg'), from: 'a@x.test', to: 'b@x.test', ...over } });
}
