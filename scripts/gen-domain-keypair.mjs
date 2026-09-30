#!/usr/bin/env node
// Genera el par Ed25519 de ESTA instancia de BloomX para autenticarse ante el backend compartido SIN secretos compartidos.
//
//   node scripts/gen-domain-keypair.mjs            # imprime el par y las instrucciones
//   node scripts/gen-domain-keypair.mjs --json     # solo JSON { privateKey, publicKey }
//
// 1) Guarde `BLOOMX_DOMAIN_PRIVATE_KEY` en el entorno del frontend (NO la comparta ni la suba a git).
// 2) Registre la clave PUBLICA en el backend (una de dos):
//      - campo opcional `signingPublicKey` en POST {NEXT_PUBLIC_BACKEND_URL}/api/auth/verify-domain al dar de alta el dominio, o
//      - POST {NEXT_PUBLIC_BACKEND_URL}/api/manager/domain-key { "domainId": "...", "signingPublicKey": "<clave publica>" }
//        con la sesion del manager dueño del dominio (sirve tambien para ROTAR la clave).
// Mientras no la registre, el backend le trata en modo LEGADO (privilegios reducidos, cabecera X-BloomX-Auth: legacy).
// Una vez registrada, el backend EXIGE peticiones firmadas para su dominio.
import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const publicPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
const publicB64 = publicKey.export({ format: 'jwk' }).x; // base64url de los 32 bytes: forma canonica que guarda el backend
// Una sola linea, apta para .env / variables de Vercel (los \n se restauran al leerla).
const privateOneLine = privatePem.trim().replace(/\n/g, '\\n');

if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ privateKey: privateOneLine, publicKey: publicB64 }, null, 2));
    process.exit(0);
}

console.log('=== Par Ed25519 de esta instancia de BloomX ===\n');
console.log('1) Variable de entorno del FRONTEND (secreta, no la comparta):\n');
console.log(`BLOOMX_DOMAIN_PRIVATE_KEY="${privateOneLine}"\n`);
console.log('2) Clave PUBLICA a registrar en el backend (no es secreta):\n');
console.log(`signingPublicKey: ${publicB64}\n`);
console.log('   (equivalente PEM SPKI, tambien aceptado)\n');
console.log(publicPem);
console.log('3) Registro (elija uno):');
console.log('   a) En el alta del dominio: enviar `signingPublicKey` en POST /api/auth/verify-domain');
console.log('   b) Con la sesion del manager: POST /api/manager/domain-key { "domainId": "<id>", "signingPublicKey": "' + publicB64 + '" }\n');
console.log('Opcional, en el frontend, para el puente backend->frontend (Organizer / services.mail):');
console.log('   BLOOMX_BACKEND_PUBLIC_KEY=<clave publica del backend>  (o se descubre en NEXT_PUBLIC_BACKEND_URL/.well-known/bloomx-backend-key.json)');
