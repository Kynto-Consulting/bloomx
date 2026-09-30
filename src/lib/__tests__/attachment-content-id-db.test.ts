import { describe, expect, it, vi } from 'vitest';

// El modulo importa '@/lib/prisma' (no se usa cuando se pasa un cliente propio, como hace scripts/reprocess-attachments.ts).
vi.mock('../prisma', () => ({ prisma: { $executeRaw: vi.fn(async () => { throw new Error('no debe usarse el prisma global'); }) } }));

import { saveAttachmentContentIds, __resetContentIdWarning } from '../attachment-content-id';

describe('saveAttachmentContentIds con cliente propio (scripts/reprocess-attachments, ruta admin)', () => {
    it('usa el cliente recibido, normaliza el Content-ID y omite placeholders', async () => {
        const calls: any[][] = [];
        const db = { $executeRaw: vi.fn(async (_s: TemplateStringsArray, ...v: any[]) => { calls.push(v); return 1; }) };
        const n = await saveAttachmentContentIds([
            { emailId: 'e1', key: 'emails/a/1.png', contentId: '<ii_1@mail.gmail.com>' },
            { emailId: 'e1', key: 'PENDING', contentId: 'x' },
            { emailId: 'e1', key: 'emails/a/2.png', contentId: '' },
            { emailId: 'e1', key: 'emails/a/3.png', contentId: undefined },
        ], db);
        expect(n).toBe(1);
        expect(calls).toEqual([['ii_1@mail.gmail.com', 'e1', 'emails/a/1.png']]);
    });

    it('columna ausente: no lanza y devuelve 0', async () => {
        __resetContentIdWarning();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const db = { $executeRaw: vi.fn(async () => { throw new Error('column "contentId" does not exist'); }) };
        await expect(saveAttachmentContentIds([{ emailId: 'e', key: 'k', contentId: 'a@b' }], db)).resolves.toBe(0);
    });
});
