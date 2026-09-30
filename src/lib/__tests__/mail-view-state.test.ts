import { describe, it, expect } from 'vitest';
import { mergeEmailPatchResponse, applyEmailPatch, optimisticEmailPatch } from '../mail-view-state';

const att = [{ id: 'a1', filename: 'f.pdf', url: 'https://signed/f.pdf' }];

describe('mergeEmailPatchResponse', () => {
    it('conserva adjuntos firmados y replyTo resuelto al alternar una etiqueta', () => {
        const previous = { id: 'e1', subject: 'Hola', attachments: att, replyTo: 'r@x.com', labels: [] as any[] };
        const server = { id: 'e1', subject: 'Hola', replyTo: null, labels: [{ id: 'l1', name: 'Work' }], rawMimeUrl: 'https://provider/raw' };
        const merged = mergeEmailPatchResponse(previous, server);
        expect(merged.attachments).toBe(att);
        expect(merged.replyTo).toBe('r@x.com');
        expect(merged.labels).toEqual([{ id: 'l1', name: 'Work' }]);
        expect((merged as any).rawMimeUrl).toBeUndefined();
    });

    it('sin respuesta valida devuelve el original', () => {
        const previous = { id: 'e1', attachments: att };
        expect(mergeEmailPatchResponse(previous, null)).toBe(previous);
    });
});

describe('applyEmailPatch', () => {
    const data = {
        email: { id: 'e1', starred: false, attachments: att },
        thread: [{ email: { id: 'e1', starred: false } }, { email: { id: 'e2', starred: false } }],
    };

    it('actualiza correo y su entrada del hilo sin mutar el original', () => {
        const next = applyEmailPatch(data, 'e1', { starred: true });
        expect(next.email.starred).toBe(true);
        expect(next.thread![0].email.starred).toBe(true);
        expect(next.thread![1].email.starred).toBe(false);
        expect(data.email.starred).toBe(false);
        expect(data.thread[0].email.starred).toBe(false);
        expect(next.email.attachments).toBe(att);
    });

    it('usa el merge indicado y conserva adjuntos', () => {
        const next = applyEmailPatch(data, 'e1', { id: 'e1', labels: [] }, mergeEmailPatchResponse);
        expect(next.email.attachments).toBe(att);
    });
});

describe('optimisticEmailPatch', () => {
    const labels = [{ id: 'l1', name: 'A' }, { id: 'l2', name: 'B' }];
    it('anade y quita etiquetas al alternar sin dejar la clave de UI', () => {
        expect(optimisticEmailPatch({ toggleLabelId: 'l2' }, [labels[0]], labels)).toEqual({ labels });
        expect(optimisticEmailPatch({ toggleLabelId: 'l1' }, [labels[0]], labels)).toEqual({ labels: [] });
    });
    it('mantiene otros campos', () => {
        expect(optimisticEmailPatch({ starred: true })).toEqual({ starred: true });
    });
});
