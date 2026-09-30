import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertLocalPg, createUser, createEmail, uid } from './helpers/pg';

// El cliente Prisma real contra el DDL real: detecta nombres de columna/tabla que no coinciden.
const prisma = new PrismaClient();
beforeAll(() => assertLocalPg());
afterAll(async () => { await prisma.$disconnect(); });

describe('compatibilidad Prisma <-> DDL de ensureDatabaseSchema', () => {
    const models = Prisma.dmmf.datamodel.models.map((m) => m.name);
    it.each(models)('modelo %s: todas las columnas seleccionables', async (name) => {
        const delegate = (prisma as any)[name.charAt(0).toLowerCase() + name.slice(1)];
        await expect(delegate.findMany({ take: 1 })).resolves.toBeDefined();
    });

    it('CRUD y relaciones basicas (User/Email/Label M:N/Attachment/EmailEvent)', async () => {
        const u = await createUser(prisma);
        const label = await prisma.label.create({ data: { name: 'L1', userId: u.id } });
        const e = await prisma.email.create({
            data: {
                userId: u.id, messageId: uid('m'), from: 'a@x.test', to: 'b@x.test', smartReplies: ['a', 'b'] as any,
                labels: { connect: [{ id: label.id }] },
                attachments: { create: [{ filename: 'f.txt', mimeType: 'text/plain', size: 3, key: 'k/f.txt' }] },
            },
            include: { labels: true, attachments: true },
        });
        expect(e.labels).toHaveLength(1);
        expect(e.attachments).toHaveLength(1);
        expect(e.smartReplies).toEqual(['a', 'b']);
        const ev = await prisma.emailEvent.create({ data: { emailId: e.id, type: 't', data: { a: { b: 1 } } } });
        const found = await prisma.emailEvent.findFirst({ where: { id: ev.id, data: { path: ['a', 'b'], equals: 1 } } });
        expect(found?.id).toBe(ev.id);
        // Fechas: TIMESTAMPTZ se lee como instante correcto
        const sched = new Date('2031-05-05T12:34:56.789Z');
        const e2 = await createEmail(prisma, u.id, { scheduledAt: sched });
        expect((await prisma.email.findUnique({ where: { id: e2.id } }))!.scheduledAt!.toISOString()).toBe(sched.toISOString());
        // Cascada: al borrar el usuario desaparece todo
        await prisma.user.delete({ where: { id: u.id } });
        expect(await prisma.email.count({ where: { userId: u.id } })).toBe(0);
        expect(await prisma.attachment.count({ where: { emailId: e.id } })).toBe(0);
    });

    it('violacion de unicidad => P2002 (messageId, Label userId+name)', async () => {
        const u = await createUser(prisma);
        const m = uid('dup');
        await createEmail(prisma, u.id, { messageId: m });
        await expect(createEmail(prisma, u.id, { messageId: m })).rejects.toMatchObject({ code: 'P2002' });
        await prisma.label.create({ data: { name: 'X', userId: u.id } });
        await expect(prisma.label.create({ data: { name: 'X', userId: u.id } })).rejects.toMatchObject({ code: 'P2002' });
    });
});
