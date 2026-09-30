import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertLocalPg, createEmail, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';

let sessionUser: { id: string; email: string; name: string } | null = null;
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => sessionUser }));
vi.mock('@/lib/resend', () => ({ resend: { emails: { send: vi.fn() } } }));

beforeAll(() => {
    assertLocalPg();
    if (!process.env.DEBUG_PG) for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterAll(async () => { await prisma.$disconnect(); });

const req = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost${url}`, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const as = async (u: { id: string; email: string } | null) => { sessionUser = u ? { id: u.id, email: u.email, name: 'T' } : null; };
const call = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => null) });

async function routes() {
    return {
        labels: await import('../../app/api/labels/route'),
        label: await import('../../app/api/labels/[id]/route'),
        reorder: await import('../../app/api/labels/reorder/route'),
        move: await import('../../app/api/labels/[id]/move-emails/route'),
        rules: await import('../../app/api/rules/route'),
        rule: await import('../../app/api/rules/[id]/route'),
        preview: await import('../../app/api/rules/preview/route'),
        apply: await import('../../app/api/rules/apply/route'),
        undo: await import('../../app/api/rules/batches/[id]/undo/route'),
        batches: await import('../../app/api/rules/batches/route'),
        rreorder: await import('../../app/api/rules/reorder/route'),
        emailPatch: await import('../../app/api/emails/[id]/route'),
        fwd: await import('../../app/api/rules/forward-targets/route'),
    };
}

describe('API de etiquetas jerarquicas', () => {
    it('crea por ruta, anida, edita, reordena, mueve correos y borra (propiedad estricta)', async () => {
        const r = await routes();
        const u = await createUser(prisma);
        const other = await createUser(prisma);
        await as(u);

        const created = await call(await r.labels.POST(req('POST', '/api/labels', { name: 'Trabajo/Proyecto A', behavior: 'folder' })));
        expect(created.status).toBe(200);
        expect(created.body).toMatchObject({ name: 'Proyecto A', fullPath: 'Trabajo/Proyecto A', behavior: 'folder' });
        expect(created.body.userId).toBeUndefined();
        const list = await call(await r.labels.GET());
        expect(list.body.map((l: any) => l.fullPath)).toEqual(['Trabajo', 'Trabajo/Proyecto A']);
        const parent = list.body.find((l: any) => l.name === 'Trabajo');
        expect((await call(await r.labels.POST(req('POST', '/api/labels', { name: 'Trabajo' })))).status).toBe(409);
        expect((await call(await r.labels.POST(req('POST', '/api/labels', { name: 'X', color: 'rojo' })))).status).toBe(400);
        expect((await call(await r.labels.POST(req('POST', '/api/labels', { name: 'X', behavior: 'nope' })))).status).toBe(400);
        expect((await call(await r.labels.POST(req('POST', '/api/labels', { name: 'X', icon: 'rm-rf' })))).status).toBe(400);
        expect((await call(await r.labels.POST(req('POST', '/api/labels', { name: 'Y', parentId: 'inexistente' })))).status).toBe(400);

        // el otro usuario no ve ni toca nada (ni puede colgar su etiqueta de la mia)
        await as(other);
        expect((await call(await r.labels.GET())).body).toEqual([]);
        expect((await call(await r.label.PATCH(req('PATCH', '/x', { name: 'hack' }), ctx(parent.id)))).status).toBe(404);
        expect((await call(await r.label.DELETE(req('DELETE', '/x'), ctx(parent.id)))).status).toBe(404);
        expect((await call(await r.labels.POST(req('POST', '/api/labels', { name: 'Hija', parentId: parent.id })))).status).toBe(400);
        expect((await call(await r.reorder.POST(req('POST', '/x', { items: [{ id: parent.id, sortOrder: 9 }] })))).status).toBe(404);
        await as(null);
        expect((await call(await r.labels.GET())).status).toBe(401);

        // ciclo, renombre y reorden
        await as(u);
        expect((await call(await r.label.PATCH(req('PATCH', '/x', { parentId: created.body.id }), ctx(parent.id)))).body.code).toBe('cycle');
        const ren = await call(await r.label.PATCH(req('PATCH', '/x', { name: 'Empresa' }), ctx(parent.id)));
        expect(ren.body.fullPath).toBe('Empresa');
        expect((await call(await r.labels.GET())).body.map((l: any) => l.fullPath)).toEqual(['Empresa', 'Empresa/Proyecto A']);
        const ro = await call(await r.reorder.POST(req('POST', '/x', { items: [{ id: created.body.id, parentId: null, sortOrder: 0 }] })));
        expect(ro.body.find((l: any) => l.id === created.body.id).fullPath).toBe('Proyecto A');
        expect((await call(await r.reorder.POST(req('POST', '/x', { items: 'mal' })))).status).toBe(400);

        // mover correos a una etiqueta-carpeta: salen de Entrada; PATCH de etiqueta por el correo tambien
        const e1 = await createEmail(prisma, u.id);
        const e2 = await createEmail(prisma, u.id);
        const foreign = await createEmail(prisma, other.id);
        const mv = await call(await r.move.POST(req('POST', '/x', { ids: [e1.id, foreign.id] }), ctx(created.body.id)));
        expect(mv.body).toMatchObject({ count: 1, ids: [e1.id], behavior: 'folder' });
        expect((await prisma.email.findUnique({ where: { id: e1.id } }))).toMatchObject({ folder: 'archive', previousFolder: 'inbox' });
        expect((await prisma.email.findUnique({ where: { id: foreign.id } }))!.folder).toBe('inbox');
        const tog = await call(await r.emailPatch.PATCH(req('PATCH', '/x', { toggleLabelId: created.body.id }), ctx(e2.id)));
        expect(tog.body.folder).toBe('archive');
        const untog = await call(await r.emailPatch.PATCH(req('PATCH', '/x', { toggleLabelId: created.body.id }), ctx(e2.id)));
        expect(untog.body.folder).toBe('inbox');
        // volver a Entrada por accion explicita saca de la etiqueta-carpeta
        await call(await r.emailPatch.PATCH(req('PATCH', '/x', { folder: 'inbox' }), ctx(e1.id)));
        expect(await prisma.$queryRawUnsafe(`SELECT 1 FROM "_EmailToLabel" WHERE "A"=$1`, e1.id)).toHaveLength(0);
        expect((await call(await r.move.POST(req('POST', '/x', { ids: [] }), ctx(created.body.id)))).status).toBe(400);

        // borrar: el subarbol y los correos de la carpeta vuelven a Entrada
        await r.move.POST(req('POST', '/x', { ids: [e1.id] }), ctx(created.body.id));
        const del = await call(await r.label.DELETE(req('DELETE', '/x?children=delete'), ctx(created.body.id)));
        expect(del.body).toMatchObject({ success: true, released: 1 });
        expect((await prisma.email.findUnique({ where: { id: e1.id } }))).toMatchObject({ folder: 'inbox' });
        const gone = await call(await r.label.DELETE(req('DELETE', '/x'), ctx(created.body.id)));
        expect(gone.status).toBe(404);
    });
});

describe('API de reglas v2', () => {
    const cond = { v: 2, root: { type: 'group', op: 'and', children: [{ field: 'fromDomain', op: 'equals', value: 'empresa.com', subdomains: true }, { field: 'subject', op: 'contains', value: 'factura' }] } };

    it('reglas vinculadas a etiqueta: propiedad, accion implicita, validacion estricta y reenvio desactivado', async () => {
        const r = await routes();
        const u = await createUser(prisma);
        const other = await createUser(prisma);
        await as(u);
        const lab = (await call(await r.labels.POST(req('POST', '/api/labels', { name: 'Facturas', behavior: 'folder' })))).body;
        await as(other);
        const foreignLabel = (await call(await r.labels.POST(req('POST', '/api/labels', { name: 'Ajena' })))).body;
        await as(u);

        const made = await call(await r.rules.POST(req('POST', '/api/rules', { name: 'F', conditions: cond, actions: [], labelId: lab.id })));
        expect(made.status).toBe(200);
        expect(made.body.actions).toEqual([{ type: 'addLabel', labelId: lab.id }]);
        expect(made.body.labelId).toBe(lab.id);
        expect(made.body.conditions.v).toBe(2);
        expect((await call(await r.rules.GET(req('GET', `/api/rules?labelId=${lab.id}`)))).body).toHaveLength(1);

        expect((await call(await r.rules.POST(req('POST', '/api/rules', { name: 'F', conditions: cond, actions: [{ type: 'star' }], labelId: foreignLabel.id })))).status).toBe(400);
        expect((await call(await r.rules.POST(req('POST', '/api/rules', { name: 'F', conditions: cond, actions: [{ type: 'addLabel', labelId: foreignLabel.id }] })))).status).toBe(400);
        expect((await call(await r.rules.POST(req('POST', '/api/rules', { name: 'F', conditions: { v: 2, root: { type: 'group', op: 'and', children: [{ field: 'body', op: 'regex', value: '(a+)+$' }] } }, actions: [{ type: 'star' }] })))).status).toBe(400);
        expect((await call(await r.rules.POST(req('POST', '/api/rules', { name: 'F', conditions: cond, actions: [{ type: 'forwardTo', address: 'x@y.com' }] })))).body.error).toMatch(/reenvio/i);
        expect((await call(await r.fwd.GET())).body).toEqual({ enabled: false, targets: [] });
        // v1 sigue aceptandose y se guarda en v2
        const v1 = await call(await r.rules.POST(req('POST', '/api/rules', { name: 'v1', conditions: { match: 'any', items: [{ field: 'from', op: 'contains', value: 'a' }] }, actions: [{ type: 'star' }] })));
        expect(v1.body.conditions).toMatchObject({ v: 2, root: { op: 'or' } });

        // otro usuario: ni lee, ni edita, ni borra, ni ordena, ni deshace
        await as(other);
        expect((await call(await r.rules.GET(req('GET', '/api/rules')))).body).toEqual([]);
        expect((await call(await r.rule.PATCH(req('PATCH', '/x', { name: 'h', conditions: cond, actions: [{ type: 'star' }] }), ctx(made.body.id)))).status).toBe(404);
        expect((await call(await r.rule.DELETE(req('DELETE', '/x'), ctx(made.body.id)))).status).toBe(404);
        expect((await call(await r.rreorder.POST(req('POST', '/x', { order: [made.body.id] })))).body.updated).toBe(0);
        expect((await call(await r.apply.POST(req('POST', '/x', { ruleId: made.body.id })))).status).toBe(404);
        await as(null);
        expect((await call(await r.rules.GET(req('GET', '/api/rules')))).status).toBe(401);
        expect((await call(await r.preview.POST(req('POST', '/x', {})))).status).toBe(401);
    });

    it('probar (preview) sin efectos, aplicar por paginas con progreso y deshacer; el lote ajeno no se puede deshacer', async () => {
        const r = await routes();
        const u = await createUser(prisma);
        const other = await createUser(prisma);
        await as(u);
        const lab = (await call(await r.labels.POST(req('POST', '/api/labels', { name: 'Facturas', behavior: 'folder' })))).body;
        const rule = (await call(await r.rules.POST(req('POST', '/api/rules', { name: 'F', conditions: cond, actions: [], labelId: lab.id })))).body;
        const mk = (i: number, from: string) => createEmail(prisma, u.id, { from, subject: `Su factura ${i}`, createdAt: new Date(Date.now() - i * 1000) });
        const hits = [await mk(1, 'a@empresa.com'), await mk(2, 'b@mail.empresa.com'), await mk(3, 'c@empresa.com')];
        await mk(4, 'x@otra.com');
        await createEmail(prisma, u.id, { from: 'a@empresa.com', subject: 'hola' });

        const pv = await call(await r.preview.POST(req('POST', '/x', { conditions: cond, limit: 50 })));
        expect(pv.body).toMatchObject({ limit: 50, evaluated: 5, matched: 3, unknown: 0 });
        expect(pv.body.samples.map((s: any) => s.id).sort()).toEqual(hits.map((h) => h.id).sort());
        expect((await prisma.email.findMany({ where: { userId: u.id, folder: 'inbox' } })).length).toBe(5); // nada cambio
        expect((await call(await r.preview.POST(req('POST', '/x', { conditions: { v: 2, root: { type: 'group', op: 'and', children: [{ field: 'nope' }] } } })))).status).toBe(400);
        expect((await call(await r.preview.POST(req('POST', '/x', { conditions: cond, mode: 'count', cursor: 'basura' })))).status).toBe(400);
        expect((await call(await r.preview.POST(new NextRequest('http://localhost/x', { method: 'POST', body: 'x'.repeat(70_000) })))).status).toBe(413);

        // cuenta por paginas de 2
        let cursor: string | null = null; let matched = 0; let processed = 0; let pages = 0;
        do {
            const p: any = await call(await r.preview.POST(req('POST', '/x', { conditions: cond, mode: 'count', cursor, pageSize: 2 })));
            matched += p.body.matched; processed += p.body.processed; cursor = p.body.nextCursor; pages++;
        } while (cursor && pages < 10);
        expect({ matched, processed }).toMatchObject({ matched: 3 });
        expect(processed).toBeGreaterThanOrEqual(3);

        // dry run y aplicacion
        const dry = await call(await r.apply.POST(req('POST', '/x', { ruleId: rule.id, dryRun: true })));
        expect(dry.body).toMatchObject({ matched: 3, changed: 0, done: true });
        const ap = await call(await r.apply.POST(req('POST', '/x', { ruleId: rule.id })));
        expect(ap.body).toMatchObject({ changed: 3, matched: 3, done: true });
        expect(ap.body.batchId).toMatch(/^rb_/);
        expect(await prisma.email.count({ where: { userId: u.id, folder: 'archive' } })).toBe(3);
        expect((await call(await r.batches.GET())).body[0]).toMatchObject({ id: ap.body.batchId, changed: 3, status: 'applied' });
        expect((await call(await r.rules.GET(req('GET', '/api/rules')))).body[0].matchedCount).toBe(3);

        await as(other);
        expect((await call(await r.undo.POST(req('POST', '/x'), ctx(ap.body.batchId)))).status).toBe(404);
        expect((await call(await r.apply.POST(req('POST', '/x', { ruleId: rule.id, batchId: ap.body.batchId })))).status).toBe(404);
        await as(u);
        const un = await call(await r.undo.POST(req('POST', '/x'), ctx(ap.body.batchId)));
        expect(un.body).toEqual({ restored: 3 });
        expect(await prisma.email.count({ where: { userId: u.id, folder: 'inbox' } })).toBe(5);
        expect((await call(await r.undo.POST(req('POST', '/x'), ctx(ap.body.batchId)))).status).toBe(404); // solo una vez
    });

    it('el reenvio solo va a direcciones verificadas del usuario y solo si esta habilitado', async () => {
        const r = await routes();
        const u = await createUser(prisma);
        await as(u);
        const linked = `${uid('v')}@verified.test`;
        await prisma.account.create({ data: { userId: u.id, type: 'oauth', provider: 'google', providerAccountId: linked } });
        process.env.RULES_FORWARD_ENABLED = 'true';
        try {
            expect((await call(await r.fwd.GET())).body).toEqual({ enabled: true, targets: [linked] });
            const ok = await call(await r.rules.POST(req('POST', '/api/rules', { name: 'fw', conditions: cond, actions: [{ type: 'forwardTo', address: linked }] })));
            expect(ok.status).toBe(200);
            const bad = await call(await r.rules.POST(req('POST', '/api/rules', { name: 'fw', conditions: cond, actions: [{ type: 'forwardTo', address: 'tercero@ext.test' }] })));
            expect(bad.status).toBe(400);
            const self = await call(await r.rules.POST(req('POST', '/api/rules', { name: 'fw', conditions: cond, actions: [{ type: 'forwardTo', address: u.email }] })));
            expect(self.status).toBe(400);

            const { runForwards } = await import('../rules/forward');
            const sent: any[] = [];
            const base = { userId: u.id, userEmail: u.email, from: 'a@b.com', subject: 'Hola', text: 't', html: '', hdrs: {} as Record<string, string> };
            expect(await runForwards(base, [linked, 'tercero@ext.test'], async (p) => { sent.push(p); })).toEqual([linked]);
            expect(sent[0]).toMatchObject({ to: linked, headers: { 'Auto-Submitted': 'auto-forwarded' } });
            expect(await runForwards({ ...base, hdrs: { 'auto-submitted': 'auto-generated' } }, [linked], async () => undefined)).toEqual([]);
            expect(await runForwards({ ...base, subject: 'Fwd: algo' }, [linked], async () => undefined)).toEqual([]);
        } finally {
            delete process.env.RULES_FORWARD_ENABLED;
        }
        const { runForwards } = await import('../rules/forward');
        expect(await runForwards({ userId: u.id, userEmail: u.email, from: 'a@b.com', subject: 'x', text: '', html: '', hdrs: {} }, [linked], async () => { throw new Error('no debe enviar'); })).toEqual([]);
    });
});
