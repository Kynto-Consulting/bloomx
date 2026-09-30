// Calcula el codigo TOTP actual con src/lib/totp.ts. Uso: npx tsx scripts/e2e-totp.ts "<clave base32 con o sin espacios>"
import { totp } from '../src/lib/totp';
const secret = process.argv.slice(2).join('').replace(/\s+/g, '');
console.log(totp(secret));
