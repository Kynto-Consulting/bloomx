// Postgres embebido para E2E local (puerto fijo 127.0.0.1:54329, BD bloomx_e2e). Ctrl+C / SIGTERM lo detiene y borra los datos.
import { startPgTestServer } from './pg-test-server.mjs';
const s = await startPgTestServer({ port: 54329, database: 'bloomx_e2e', quiet: true });
console.log(`READY ${s.url.replace(/:[^:@]+@/, ':***@')}`);
const bye = async () => { await s.stop(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
setInterval(() => {}, 1 << 30);
