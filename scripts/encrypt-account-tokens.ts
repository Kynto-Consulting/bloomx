/**
 * Migracion masiva (OPCIONAL) de los tokens OAuth de Account a cifrado en reposo (AES-256-GCM v3).
 * La migracion normal es perezosa (al leer cada fila, ver src/lib/account-tokens.ts); este script solo acelera el proceso
 * o re-cifra tras rotar DATA_ENCRYPTION_KEY.
 *
 *   node --env-file=.env --import tsx scripts/encrypt-account-tokens.ts            # simulacion (no escribe)
 *   node --env-file=.env --import tsx scripts/encrypt-account-tokens.ts --apply    # escribe
 *
 * Idempotente: solo toca valores en texto plano / formato o clave antigua. Nunca imprime tokens.
 */
import { PrismaClient } from '@prisma/client';
import { encrypt, needsReencrypt, tryDecrypt } from '../src/lib/encryption';

const FIELDS = ['access_token', 'refresh_token', 'id_token'] as const;

async function main() {
    const apply = process.argv.includes('--apply');
    // Cliente BASE (sin la extension): trabajamos con el valor tal cual esta en BD
    const prisma = new PrismaClient();
    let scanned = 0;
    let changed = 0;
    let undecryptable = 0;
    let cursor: string | undefined;

    for (;;) {
        const rows = await prisma.account.findMany({
            take: 200,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { id: 'asc' },
            select: { id: true, access_token: true, refresh_token: true, id_token: true },
        });
        if (rows.length === 0) break;
        cursor = rows[rows.length - 1].id;

        for (const row of rows) {
            scanned++;
            const data: Record<string, string> = {};
            for (const f of FIELDS) {
                const v = row[f];
                if (typeof v === 'string' && v && needsReencrypt(v)) {
                    const plain = tryDecrypt(v);
                    if (plain === null) { undecryptable++; continue; }
                    data[f] = encrypt(plain);
                }
            }
            if (Object.keys(data).length > 0) {
                changed++;
                if (apply) await prisma.account.update({ where: { id: row.id }, data });
            }
        }
    }

    console.log(`[encrypt-account-tokens] ${apply ? 'APLICADO' : 'SIMULACION'}: filas=${scanned}, a_cifrar=${changed}, no_descifrables=${undecryptable}`);
    await prisma.$disconnect();
}

main().catch((e) => {
    console.error('[encrypt-account-tokens] error:', e?.message || 'unknown');
    process.exit(1);
});
