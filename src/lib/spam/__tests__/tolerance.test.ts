import { beforeEach, describe, expect, it, vi } from 'vitest';

// Sin las tablas/columnas nuevas (despliegue sin `db:ensure`) el filtro NO debe romper la entrada de correo: listas vacias, aprendizaje
// inactivo, registro omitido, configuracion por defecto y, si algo mas falla, el clasificador anterior por cabeceras.
const missing = Object.assign(new Error('relation "SpamList" does not exist'), { code: '42P01' });
vi.mock('@/lib/admin/sql', async (orig) => {
    const actual = await orig<typeof import('@/lib/admin/sql')>();
    return { ...actual, query: vi.fn(async () => { throw missing; }), execute: vi.fn(async () => { throw missing; }) };
});
vi.mock('@/lib/prisma', () => ({
    prisma: {
        contact: { findFirst: vi.fn(async () => { throw missing; }) },
        $transaction: vi.fn(async () => { throw missing; }),
        $queryRawUnsafe: vi.fn(async () => { throw missing; }),
        $executeRawUnsafe: vi.fn(async () => { throw missing; }),
        email: { findMany: vi.fn(async () => { throw missing; }) },
    },
}));

import { applyBlocklist, classifyForRecipient, persistVerdict, resetInternalNamesCache } from '../pipeline';
import { getSpamConfig, getSpamConfigInfo, invalidateSpamConfigCache } from '../config-store';
import { getCompiledList, listEntries, recordHits, addEntries, ListStoreError } from '../lists-store';
import { recordEvent, listEvents, spamStats } from '../events-store';
import { bumpSender, classifyForUser, deleteModel, getUserPrefs, modelStats, train } from '../learning-store';
import { snapshotForLearning } from '../learn-hook';
import { simulate } from '../simulate';
import { identityOf } from '../lists-core';
import { defaultSpamConfig } from '../config-core';

const user = { id: 'u1', email: 'u@pg.test' };
const mail = {
    headers: {}, from: { name: 'Ana', email: 'ana@sender.test' }, subject: 'Hola', text: 'hola', html: '', attachments: [], recipients: ['u@pg.test'],
};

beforeEach(() => { invalidateSpamConfigCache(); resetInternalNamesCache(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });

describe('sin tablas ni columnas nuevas', () => {
    it('configuracion por defecto, listas vacias, registro y modelo vacios', async () => {
        expect((await getSpamConfig({ fresh: true })).level).toBe('balanced');
        expect((await getSpamConfigInfo({ fresh: true })).source).toBe('default');
        expect((await getCompiledList('domain', 'domain', 'block')).match(identityOf('x@y.com'))).toBeNull();
        expect(await listEntries({ scope: 'domain', ownerKey: 'domain', kind: 'block' })).toEqual({ rows: [], total: 0, limit: 10000 });
        expect(await listEvents({})).toEqual({ rows: [], total: 0 });
        expect((await spamStats(7)).totals.spam).toBe(0);
        expect(await modelStats('u1')).toEqual({ spamMessages: 0, hamMessages: 0, tokens: 0 });
        expect(await getUserPrefs('u1')).toEqual({ learn: true, sensitivity: 0 });
        expect(await classifyForUser('u1', { subject: 'x', body: 'y z w', fromDomain: 'a.com' })).toBeNull();
        expect(await snapshotForLearning(['a'], ['u1'], 'spam')).toEqual([]);
        expect(await simulate({}, defaultSpamConfig({}), 'u1')).toMatchObject({ analyzed: 0, skipped: 0 });
    });
    it('las escrituras opcionales no lanzan (registro, aciertos, contadores, entrenamiento, borrado)', async () => {
        await expect(recordEvent({ sender: 'a@b.com', decision: 'spam' })).resolves.toBeUndefined();
        await expect(recordHits(['x'])).resolves.toBeUndefined();
        await expect(bumpSender('u1', 'a@b.com', 'spam')).resolves.toBeUndefined();
        await expect(train('u1', { subject: 'oferta premio', body: 'compra ahora', fromDomain: 'b.com' }, 'spam')).resolves.toBeUndefined();
        await expect(deleteModel('u1')).resolves.toEqual({ tokens: 0, senders: 0 });
    });
    it('el alta de listas falla con un error claro (503 en la ruta), no con un 500', async () => {
        await expect(addEntries([{ matchType: 'domain', value: 'a.com' }], { scope: 'domain', ownerKey: 'domain', kind: 'block', actor: 'a' })).rejects.toBeInstanceOf(ListStoreError);
    });
    it('la blocklist no bloquea nada y el correo entra; la clasificacion sigue funcionando con los valores por defecto', async () => {
        const out = await applyBlocklist(mail, [user]);
        expect(out.survivors).toEqual([user]);
        expect(out.blocked).toEqual([]);
        const v = await classifyForRecipient(user, { ...mail, subject: 'Hola', headers: { 'authentication-results': 'mx; spf=pass; dkim=pass; dmarc=pass' } });
        expect(v.engine).toBe('v2');
        expect(v.folder).toBe('inbox');
        await expect(persistVerdict('e1', user, mail, v)).resolves.toBeUndefined(); // UPDATE de columnas inexistentes: se ignora
    });
    it('si el motor v2 falla por completo, se usa el clasificador anterior y el correo no se pierde', async () => {
        const cs = await import('../config-store');
        const spy = vi.spyOn(cs, 'getSpamConfig').mockRejectedValue(new Error('boom'));
        try {
            const spam = await classifyForRecipient(user, { ...mail, headers: { 'x-spam-flag': 'YES' } });
            expect(spam).toMatchObject({ engine: 'legacy', folder: 'spam', decision: 'spam' });
            const ok = await classifyForRecipient(user, mail);
            expect(ok).toMatchObject({ engine: 'legacy', folder: 'inbox' });
        } finally { spy.mockRestore(); }
    });
    it('el comportamiento anterior respeta SPAM_SCORE_THRESHOLD y ENABLE_AUTO_SPAM_DETECTION', async () => {
        const cs = await import('../config-store');
        const spy = vi.spyOn(cs, 'getSpamConfig').mockRejectedValue(new Error('boom'));
        try {
            vi.stubEnv('ENABLE_AUTO_SPAM_DETECTION', 'false');
            expect((await classifyForRecipient(user, { ...mail, headers: { 'x-spam-flag': 'YES' } })).folder).toBe('inbox');
            vi.stubEnv('ENABLE_AUTO_SPAM_DETECTION', 'true');
            vi.stubEnv('SPAM_SCORE_THRESHOLD', '95');
            expect((await classifyForRecipient(user, { ...mail, headers: { 'x-spam-score': '7.0', 'authentication-results': 'mx; spf=fail' } })).folder).toBe('inbox');
        } finally { spy.mockRestore(); vi.unstubAllEnvs(); }
    });
});
