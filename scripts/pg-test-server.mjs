// Servidor Postgres EMBEBIDO y efimero para pruebas de integracion (npm run test:pg).
// NUNCA usa la BD del .env: crea un cluster en un directorio temporal, en un puerto libre de 127.0.0.1.
//
// Uso como modulo:  const s = await startPgTestServer(); s.url; await s.createDatabase('x'); await s.stop();
// Uso como CLI:     node scripts/pg-test-server.mjs   (imprime DATABASE_URL y queda corriendo; Ctrl+C lo detiene)
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

/**
 * @param {{ dataDir?: string, database?: string, port?: number, keep?: boolean, quiet?: boolean }} [opts]
 * dataDir por defecto: prisma/.pgdata/run-<pid>-<ts> (ignorado por git); se borra al detener salvo keep.
 */
export async function startPgTestServer(opts = {}) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const port = opts.port ?? (await getFreePort());
    const baseDir = opts.dataDir ?? path.join(root, 'prisma', '.pgdata', `run-${process.pid}-${Date.now()}`);
    fs.mkdirSync(path.dirname(baseDir), { recursive: true });
    // Limpia restos de ejecuciones interrumpidas (>6 h). Si siguen en uso (Windows bloquea los archivos) se ignoran.
    if (!opts.dataDir) {
        for (const d of fs.readdirSync(path.dirname(baseDir))) {
            const full = path.join(path.dirname(baseDir), d);
            try { if (d.startsWith('run-') && Date.now() - fs.statSync(full).mtimeMs > 6 * 3600_000) fs.rmSync(full, { recursive: true, force: true }); } catch { /* en uso */ }
        }
    }
    const user = 'bloomx_test';
    const password = 'bloomx_test_pw';
    const logs = [];
    const pg = new EmbeddedPostgres({
        databaseDir: baseDir,
        port,
        user,
        password,
        persistent: false,
        initdbFlags: ['--encoding=UTF8', '--locale=C'],
        // fsync off: mas rapido y es un cluster desechable
        postgresFlags: ['-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off', '-c', 'listen_addresses=127.0.0.1', '-c', 'max_connections=100'],
        onLog: (m) => { logs.push(String(m)); if (!opts.quiet && process.env.PG_TEST_VERBOSE) console.log(m); },
        onError: (m) => { logs.push(String(m)); if (!opts.quiet && process.env.PG_TEST_VERBOSE) console.error(m); },
    });
    try {
        await pg.initialise();
        await pg.start();
    } catch (e) {
        e.message += `\n--- postgres log ---\n${logs.slice(-40).join('')}`;
        try { await pg.stop(); } catch { /* ignore */ }
        throw e;
    }
    const cred = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
    const urlFor = (db) => `postgresql://${cred}@127.0.0.1:${port}/${db}`;
    const created = new Set();
    async function createDatabase(name) {
        if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`nombre de BD invalido: ${name}`);
        await pg.createDatabase(name);
        created.add(name);
        return urlFor(name);
    }
    const dbName = opts.database ?? 'bloomx_test';
    const url = await createDatabase(dbName);
    let stopped = false;
    async function stop() {
        if (stopped) return;
        stopped = true;
        let cleanStop = false;
        // 1) parada limpia con pg_ctl (evita procesos huerfanos "io_worker" de Postgres 18 en Windows y el crash recovery)
        try {
            const plat = process.platform === 'win32' ? 'windows' : process.platform;
            const bins = await import(`@embedded-postgres/${plat}-${process.arch}`);
            const pgCtl = path.join(path.dirname(bins.postgres), process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
            const r = spawnSync(pgCtl, ['stop', '-D', baseDir, '-m', 'fast', '-w', '-t', '20'], { stdio: 'ignore', timeout: 30_000 });
            cleanStop = r.status === 0;
        } catch { /* se cae al kill de embedded-postgres */ }
        // 2) respaldo: kill del arbol de procesos
        // (si pg_ctl ya lo detuvo, el evento 'exit' de embedded-postgres ya paso: no esperar indefinidamente)
        // El gancho de salida de embedded-postgres (async-exit-hook) llamaria a stop() y esperaria un 'exit' que ya ocurrio (+10 s de espera)
        if (cleanStop) pg.process = undefined;
        else { try { await Promise.race([pg.stop(), new Promise((r) => setTimeout(r, 5000))]); } catch { /* ya detenido */ } }
        if (!opts.keep) {
            for (let i = 0; i < 5; i++) {
                try { fs.rmSync(baseDir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 300)); }
            }
        }
    }
    return { url, port, dataDir: baseDir, urlFor, createDatabase, stop, logs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const s = await startPgTestServer({ quiet: false });
    console.log(`DATABASE_URL=${s.url}`);
    const bye = async () => { await s.stop(); process.exit(0); };
    process.on('SIGINT', bye);
    process.on('SIGTERM', bye);
    if (process.argv.includes('--selftest')) await bye();
    else setInterval(() => {}, 1 << 30);
}
