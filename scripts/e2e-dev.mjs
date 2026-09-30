// Arranca `next dev` SOLO con el entorno de .env.e2e. NUNCA usa el .env real:
// Next carga .env sin pisar variables ya definidas, asi que se definen (vacias) todas las claves que aparecen en .env*
// (solo los NOMBRES; los valores reales no se leen). Ademas se aborta si DATABASE_URL no es local.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of fs.readFileSync(path.join(root, '.env.e2e'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
}
if (new URL(env.DATABASE_URL).hostname !== '127.0.0.1') { console.error('DATABASE_URL no es 127.0.0.1. Abortando.'); process.exit(1); }

const blank = {};
for (const f of fs.readdirSync(root).filter((n) => n.startsWith('.env') && n !== '.env.e2e')) {
    for (const line of fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
        if (m && !(m[1] in env)) blank[m[1]] = '';
    }
}
const port = env.NEXT_PUBLIC_APP_URL.split(':').pop();
const child = spawn(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', port, '-H', '127.0.0.1'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, ...blank, ...env },
});
const bye = () => { try { child.kill(); } catch { /* */ } };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
child.on('exit', (c) => process.exit(c ?? 0));
