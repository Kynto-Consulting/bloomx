import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Regresion E2E: sin S3/B2 configurado (modo local) el modulo lanzaba "Region is missing" al importarse,
// asi que el fallback de almacenamiento local nunca funcionaba.
describe('storage sin S3 (fallback local)', () => {
    const cwd = process.cwd();
    let tmp = '';
    afterEach(() => { process.chdir(cwd); if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ } vi.unstubAllEnvs(); vi.resetModules(); });

    it('se puede importar y guardar/leer en disco local', async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomx-storage-'));
        process.chdir(tmp);
        for (const k of ['S3_REGION', 'S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET', 'B2_REGION', 'B2_ENDPOINT', 'B2_ACCESS_KEY', 'B2_SECRET_KEY', 'B2_BUCKET']) vi.stubEnv(k, '');
        vi.stubEnv('RESEND_API_KEY', 're_test');
        vi.stubEnv('NEXTAUTH_SECRET', 'test-secret');
        vi.stubEnv('DATABASE_URL', 'postgresql://x:y@127.0.0.1:1/z');
        vi.resetModules();
        const storage = await import('../storage');
        await storage.uploadToStorage('a/b.txt', 'hola', 'text/plain');
        expect(await storage.getFromStorage('a/b.txt')).toBe('hola');
    });
});
