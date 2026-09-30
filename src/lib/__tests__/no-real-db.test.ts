import { describe, it, expect } from 'vitest';

describe('aislamiento de la suite', () => {
    it('DATABASE_URL apunta a un destino inalcanzable, nunca a la base real', () => {
        expect(process.env.DATABASE_URL).toContain('127.0.0.1:1');
        expect(process.env.DATABASE_URL).not.toMatch(/neon|amazonaws|supabase/i);
    });
});
