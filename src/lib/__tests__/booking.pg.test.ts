import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Client } from 'pg';
import { assertLocalPg, createUser, uid } from './helpers/pg';
import { prisma } from '../prisma';

// Reserva de citas: route real + Postgres real (pg_advisory_xact_lock, transaccion interactiva, indice unico parcial).
vi.mock('@/lib/resend', () => ({ resend: { emails: { send: vi.fn(async () => ({ data: { id: 'r1' }, error: null })) } } }));
vi.mock('@/lib/storage', () => ({ uploadToStorage: vi.fn(async () => undefined) }));

let host: { id: string; email: string };
let scheduleId: string;
let counter = 0;

const slotAt = (daysAhead: number, hh: number, mm = 0) => {
    const d = new Date(Date.now() + daysAhead * 24 * 3600_000);
    d.setUTCHours(hh, mm, 0, 0);
    return d;
};

async function book(slot: Date, guest = `g${++counter}_${uid('x')}@guest.test`) {
    const { POST } = await import('../../app/api/appointments/book/[scheduleId]/route');
    const req = new NextRequest(`http://localhost/api/appointments/book/${scheduleId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${counter % 250}.${Math.floor(counter / 250) + 1}` },
        body: JSON.stringify({ guestName: 'Invitada', guestEmail: guest, startsAt: slot.toISOString() }),
    });
    const res = await POST(req, { params: Promise.resolve({ scheduleId }) });
    return { status: res.status, body: await res.json() };
}

const confirmedAt = (slot: Date) =>
    prisma.appointmentBooking.count({ where: { scheduleId, startsAt: slot, status: 'confirmed' } });

beforeAll(async () => {
    assertLocalPg();
    for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
    host = await createUser(prisma);
    const s = await prisma.appointmentSchedule.create({
        data: {
            userId: host.id, name: 'Consulta', duration: 30, timezone: 'UTC', isActive: true,
            availability: { create: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:00', isEnabled: true })) },
        },
    });
    scheduleId = s.id;
});
afterAll(async () => { await prisma.$disconnect(); });

describe('reserva de citas concurrente', () => {
    it('una reserva simple crea booking + evento + asistentes', async () => {
        const slot = slotAt(5, 9);
        const r = await book(slot);
        expect(r.status).toBe(201);
        expect(r.body.cancelToken).toBeTruthy();
        const b = await prisma.appointmentBooking.findUnique({ where: { id: r.body.id } });
        expect(b).toMatchObject({ status: 'confirmed', scheduleId });
        const ev = await prisma.calendarEvent.findUnique({ where: { id: b!.calendarEventId! }, include: { attendees: true } });
        expect(ev!.attendees).toHaveLength(2);
        expect(ev!.startsAt.toISOString()).toBe(slot.toISOString());
    });

    it('doble reserva simultanea del mismo hueco: exactamente una 201 y una 409 (Promise.all)', async () => {
        const slot = slotAt(6, 10);
        const [a, b] = await Promise.all([book(slot), book(slot)]);
        expect([a.status, b.status].sort()).toEqual([201, 409]);
        expect(await confirmedAt(slot)).toBe(1);
        expect(await prisma.calendarEvent.count({ where: { userId: host.id, startsAt: slot } })).toBe(1);
    });

    it('rafaga de 8 peticiones al mismo hueco: una sola gana, sin 500', async () => {
        const slot = slotAt(7, 11);
        const results = await Promise.all(Array.from({ length: 8 }, () => book(slot)));
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        expect(results.filter((r) => r.status === 409)).toHaveLength(7);
        expect(results.some((r) => r.status >= 500)).toBe(false);
        expect(await confirmedAt(slot)).toBe(1);
    });

    it('huecos distintos en paralelo se reservan todos', async () => {
        const slots = [12, 13, 14, 15].map((h) => slotAt(8, h));
        const results = await Promise.all(slots.map((s) => book(s)));
        expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    });

    it('un evento del calendario que se solapa bloquea el hueco (409)', async () => {
        const cal = await prisma.calendar.create({ data: { userId: host.id, name: 'Otro', source: 'local' } });
        const slot = slotAt(9, 9);
        await prisma.calendarEvent.create({ data: { userId: host.id, calendarId: cal.id, title: 'ocupado', startsAt: new Date(slot.getTime() - 10 * 60_000), endsAt: new Date(slot.getTime() + 10 * 60_000) } });
        expect((await book(slot)).status).toBe(409);
        expect(await confirmedAt(slot)).toBe(0);
    });

    it('cancelar libera el hueco (el indice unico es parcial: WHERE status = confirmed)', async () => {
        const slot = slotAt(10, 9);
        const first = await book(slot);
        expect(first.status).toBe(201);
        expect((await book(slot)).status).toBe(409);
        // Igual que la ruta de cancelacion: booking -> cancelled y se elimina el evento del calendario
        const b = await prisma.appointmentBooking.update({ where: { id: first.body.id }, data: { status: 'cancelled' } });
        await prisma.calendarEvent.deleteMany({ where: { id: b.calendarEventId! } });
        expect((await book(slot)).status).toBe(201);
        expect(await confirmedAt(slot)).toBe(1);
    });

    it('el candado consultivo serializa: una transaccion externa que lo retiene bloquea la reserva hasta liberarse', async () => {
        const slot = slotAt(11, 9);
        const c = new Client({ connectionString: process.env.DATABASE_URL });
        await c.connect();
        try {
            await c.query('BEGIN');
            await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`appointments:${host.id}`]);
            let done = false;
            const p = book(slot).then((r) => { done = true; return r; });
            await new Promise((r) => setTimeout(r, 1500));
            expect(done).toBe(false); // esperando el candado
            expect(await confirmedAt(slot)).toBe(0);
            await c.query('COMMIT');
            expect((await p).status).toBe(201);
        } finally {
            await c.end();
        }
    });

    it('respaldo: sin candado, el indice unico parcial rechaza el duplicado con P2002 (lo que el route traduce a 409)', async () => {
        const slot = slotAt(12, 9);
        const mk = () => prisma.appointmentBooking.create({
            data: { scheduleId, guestName: 'x', guestEmail: 'x@guest.test', startsAt: slot, endsAt: new Date(slot.getTime() + 1800_000), status: 'confirmed' },
        });
        const results = await Promise.allSettled([mk(), mk(), mk()]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        for (const r of results) if (r.status === 'rejected') expect((r.reason as any).code).toBe('P2002');
    });
});
