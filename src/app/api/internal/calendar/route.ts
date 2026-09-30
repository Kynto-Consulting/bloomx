import { createBridgeHandler } from '@/lib/expansions/host-services/bridge-route';
import { calendarRequest, defaultCalendarDeps, handleCalendar } from '@/lib/expansions/host-services/calendar';

/** Puente `services.calendar.*` del sandbox de extensiones. Ver src/lib/expansions/host-services/bridge-route.ts. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createBridgeHandler({
    service: 'calendar',
    schema: calendarRequest,
    handle: async (req) => handleCalendar(await defaultCalendarDeps(), req),
});
