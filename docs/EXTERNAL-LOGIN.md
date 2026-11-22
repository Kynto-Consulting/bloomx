# Entrar con Bloomx (apps externas)

La instancia actua como proveedor de identidad para apps como Killio: authorization code + PKCE (S256).

| Endpoint | Para que |
|---|---|
| `GET /api/auth/external` | Dice si la instancia lo tiene activado: `{ "enabled": false }` o `{ "enabled": true, "authorizationEndpoint", "tokenEndpoint", ... }`. Publico, sin secretos. |
| `GET /api/auth/authorize` | `client_id`, `redirect_uri` (coincidencia exacta), `state`, `code_challenge`, `code_challenge_method=S256`. Sin sesion lleva a `/login?next=...` y vuelve; con sesion emite un codigo de un solo uso (60 s) y redirige a `redirect_uri?code&state`. |
| `POST /api/auth/token` | Servidor a servidor: `client_id`, `client_secret` (solo si el cliente tiene secretHash), `code`, `code_verifier`, `redirect_uri` -> `{ sub, email, email_verified, name }`. |

## Activarlo
Variable `BLOOMX_EXTERNAL_CLIENTS` (JSON). Sin clientes validos el flujo esta **apagado**.

```
BLOOMX_EXTERNAL_CLIENTS=[{"clientId":"killio","name":"Killio","redirectUris":["https://backend.killio.dev/auth/social/bloomx/callback"]}]
```

`secretHash` es OPCIONAL: sin el, el cliente es publico y el canje se protege con PKCE y el `redirect_uri` exacto (recomendado para Killio en modo abierto: no hay secreto que filtrar). Para exigir secreto: `"secretHash":"<sha256 hex>"`.

Hash del secreto: `node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" <secreto>`.
El secreto en claro solo lo guarda la app externa. Hace falta la tabla `ExternalAuthCode` (`npm run db:ensure`).

## Seguridad
- El navegador nunca es redirigido a un `redirect_uri` no registrado (error en la instancia, sin redirigir).
- La sesion se emite solo tras el segundo factor, asi que MFA se respeta; cuentas deshabilitadas reciben `access_denied`.
- Codigo: solo su hash en BD, un uso (se borra al canjear, aunque la verificacion falle), 60 s, ligado a cliente, `redirect_uri` y `code_challenge`.
- `/login?next=` solo acepta `/api/auth/authorize...` (sin open redirect). Rate limit en authorize y token; auditoria `auth.external.*`.
- `email_verified` es siempre `true`: el correo es un buzon de esta instancia. Las apps deben aceptar el correo solo para dominios de la propia instancia salvo que confien en ella.
