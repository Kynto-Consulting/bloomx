import { describe, it, expect, vi } from 'vitest';
import { decidePlacement, formatGmailLabels, gmailLabelsFor, parseGmailLabels } from '../mail-transfer/formats';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

describe('importacion/exportacion de jerarquias de etiquetas', () => {
    it('etiquetas de Gmail con "/" se conservan como ruta (jerarquia) y son de comportamiento tag', () => {
        const p = decidePlacement({ 'x-gmail-labels': ['Inbox,Trabajo/Proyecto A,Facturas'] });
        expect(p.labels).toEqual(expect.arrayContaining(['Trabajo/Proyecto A', 'Facturas']));
        expect(p.folderLabels ?? []).toEqual([]);
    });

    it('carpetas de Outlook/Thunderbird/ZIP son etiquetas-carpeta con su jerarquia', () => {
        const p = decidePlacement({}, 'Bandeja de entrada/Clientes/Acme');
        expect(p.folderLabels).toEqual(p.labels.filter((l) => l.includes('Acme')));
        expect(p.labels.join('|')).toContain('Clientes/Acme');
        const q = decidePlacement({}, ['Proyectos', 'Q3']);
        expect(q.folder).toBe('archive');
        expect(q.folderLabels).toEqual(['Proyectos/Q3']);
    });

    it('el borrador de una carpeta Drafts no crea etiqueta-carpeta', () => {
        expect(decidePlacement({}, 'Drafts').folderLabels).toEqual([]);
    });

    it('la exportacion escribe X-Gmail-Labels con la ruta y se puede releer', () => {
        const value = formatGmailLabels(gmailLabelsFor({ folder: 'archive', read: true, starred: false, labels: ['Trabajo/Proyecto A'] }));
        expect(value).toBe('Trabajo/Proyecto A');
        expect(parseGmailLabels(value)).toEqual(['Trabajo/Proyecto A']);
    });

    it('directorio de etiqueta-carpeta seguro en el ZIP', async () => {
        vi.resetModules();
        const { folderLabelDir } = await import('../mail-transfer/export-engine');
        expect(folderLabelDir([{ name: 'Clientes/Acme', folder: true }])).toBe('Clientes/Acme');
        expect(folderLabelDir([{ name: '../../etc/passwd', folder: true }])).toBe('etc/passwd');
        expect(folderLabelDir([{ name: 'A:B/C*?', folder: true }])).toBe('A_B/C__');
        expect(folderLabelDir([{ name: 'Solo tag', folder: false }])).toBeNull();
    }, 60_000);
});
