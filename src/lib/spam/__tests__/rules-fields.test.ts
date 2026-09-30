import { describe, expect, it } from 'vitest';
import { evaluateLeaf, validateLeaf, type EmailContext } from '../../rules/conditions';

const leafOf = (raw: unknown) => { const r = validateLeaf(raw); if (!r.ok) throw new Error(r.error); return r.leaf; };
// Campos que el filtro de spam expone a las reglas v2: spamScore (numerico) e isExternal (booleano, tres valores).
const email = (over: Partial<EmailContext>): EmailContext => ({ from: 'a@x.test', to: 'b@y.test', subject: 's', body: 'b', hasAttachment: false, labelIds: [], ...over } as EmailContext);

describe('reglas v2: campos del filtro de spam', () => {
    it('spamScore compara el score guardado; sin dato, la condicion es desconocida', () => {
        const leaf = leafOf({ field: 'spamScore', op: 'gte', value: 50 });
        expect(evaluateLeaf(leaf, email({ spamScore: 72 }))).toBe(true);
        expect(evaluateLeaf(leaf, email({ spamScore: 10 }))).toBe(false);
        expect(evaluateLeaf(leaf, email({ spamScore: null }))).toBeNull();
        expect(evaluateLeaf(leaf, email({}))).toBeNull();
    });
    it('isExternal: verdadero, falso y desconocido (nunca coincide si se ignora)', () => {
        const yes = leafOf({ field: 'isExternal', value: true });
        const no = leafOf({ field: 'isExternal', value: false });
        expect(evaluateLeaf(yes, email({ isExternal: true }))).toBe(true);
        expect(evaluateLeaf(yes, email({ isExternal: false }))).toBe(false);
        expect(evaluateLeaf(no, email({ isExternal: false }))).toBe(true);
        expect(evaluateLeaf(yes, email({ isExternal: null }))).toBeNull();
        expect(evaluateLeaf(no, email({}))).toBeNull(); // un correo antiguo no "coincide" con "no es externo"
    });
    it('el validador acepta isExternal y rechaza valores no booleanos', () => {
        expect(validateLeaf({ field: 'isExternal', value: true }).ok).toBe(true);
        expect(validateLeaf({ field: 'isExternal', value: 'si' }).ok).toBe(false);
    });
});
