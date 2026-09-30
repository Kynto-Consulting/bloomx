# Guía simple de DNS para que tus correos no caigan en spam

Esta guía está pensada para Bloomx usando Resend como proveedor de envío y recepción.

Objetivo:
- autenticar tu dominio
- alinear el dominio visible del remitente
- habilitar recepción en Bloomx
- reducir la probabilidad de spam por mala configuración DNS

Importante:
- no inventes registros manualmente si Resend ya te muestra valores concretos en su dashboard
- publica exactamente los registros que Resend te entrega para tu dominio
- la entregabilidad no depende solo de DNS, pero sin DNS bien configurado casi siempre terminarás en spam

## 1. Usa un dominio real y estable

Lo mínimo recomendable:
- no enviar desde dominios recién comprados
- no enviar desde un dominio sin web o sin reputación mínima
- usar la misma familia de dominio para producto, web y correo

Ejemplos válidos:
- `example.com`
- `mail.example.com`

En Bloomx, el valor de `TOP_DOMAIN` debe coincidir con el dominio principal con el que vas a operar y desde el que Bloomx generará correos del sistema como `noreply@tudominio.com`.

## 2. Configura el dominio en Resend

En Resend, agrega el dominio que usarás para enviar correo.

Después publica todos los registros que Resend te pida. Normalmente verás una combinación de estos tipos:
- `TXT` para SPF o verificación
- `CNAME` para DKIM
- `CNAME` para tracking o return-path, si Resend lo ofrece para tu plan o flujo
- `MX` si también usarás inbound email

Regla práctica:
- si Resend te muestra un registro, publícalo tal cual
- no cambies nombres, puntos finales, prioridades ni valores

## 3. SPF: deja solo uno

SPF le dice a otros servidores qué proveedor puede enviar correo por tu dominio.

Qué hacer:
- revisa si tu dominio ya tiene un registro SPF
- si ya existe, no crees otro; combina proveedores dentro del mismo SPF
- incluye a Resend usando el mecanismo que Resend te indique en su panel

Qué no hacer:
- no publiques dos registros SPF separados en el mismo dominio
- no uses demasiados `include` innecesarios

Ejemplo de forma correcta:

```txt
TXT @  v=spf1 include:lo-que-indique-resend ~all
```

Si también usas Google Workspace, Microsoft 365 u otro proveedor, el SPF debe quedar unificado en un solo registro.

## 4. DKIM: obligatorio

DKIM firma criptográficamente los correos salientes. Es uno de los factores más importantes para salir de spam.

Qué hacer:
- publica todos los registros DKIM que Resend te entregue
- espera a que Resend los marque como verificados antes de enviar tráfico real

Qué no hacer:
- no edites el selector
- no conviertas un `CNAME` en `TXT` ni al revés

Si DKIM no pasa, la reputación del dominio cae rápido y DMARC no va a alinear correctamente.

## 5. DMARC: empieza en modo monitoreo

DMARC le dice a otros servidores qué hacer cuando SPF o DKIM fallan y además ayuda a alinear el dominio visible del remitente.

Empieza así:

```txt
TXT _dmarc  v=DMARC1; p=none; adkim=r; aspf=r; pct=100
```

Recomendación simple:
- empieza con `p=none` y alineación **relajada** (`adkim=r; aspf=r`). No uses alineación estricta (`s`) al inicio: Resend firma/enruta con un subdominio (return-path), y con `aspf=s` el SPF nunca alinea y todo dependería solo de DKIM
- cuando confirmes durante 2 a 4 semanas (con los reportes `rua`) que SPF y/o DKIM alinean, sube a `p=quarantine; pct=25`, luego `pct=100`
- finalmente `p=reject`. Añade `sp=reject` para proteger subdominios que no envían correo
- DMARC pasa si **SPF o DKIM** pasan *y alinean* con el dominio del `From:`; mantén DKIM siempre correcto

Si quieres reportes, añade una casilla real:

```txt
TXT _dmarc  v=DMARC1; p=none; rua=mailto:dmarc@tudominio.com; adkim=r; aspf=r; pct=100
```

Necesitas crear ese buzón o alias si vas a recibir reportes.

## 6. MX: necesario si Bloomx va a recibir correos

Si quieres inbound email en Bloomx, no basta con enviar. También debes configurar los MX del dominio o subdominio que Resend usa para recepción.

Qué hacer:
- activa inbound en Resend
- publica exactamente los registros `MX` que Resend te muestre
- configura el webhook de recepción hacia Bloomx

Endpoints de Bloomx (se registran en Resend como **dos webhooks distintos**):

```txt
https://tu-dominio-publico/api/webhooks/resend          # correo entrante (email.received) y estados de entrega
https://tu-dominio-publico/api/webhooks/resend-events   # rebotes y quejas (email.bounced, email.complained, email.delivery_delayed)
```

Variables relacionadas:

```env
TOP_DOMAIN="example.com"
RESEND_API_KEY="re_..."
NEXT_PUBLIC_APP_URL="https://app.example.com"
# OPCIONALES (cada organizador decide). Con ellas se exige firma Svix valida; sin ellas el webhook se acepta sin firma
# y solo se escribe un aviso en el log. Se recomienda definirlas en produccion.
WEBHOOK_SECRET="whsec_..."           # /api/webhooks/resend
RESEND_WEBHOOK_SECRET="whsec_..."    # /api/webhooks/resend-events
```

Cada webhook de Resend tiene su propio secreto `whsec_...`: copia el de cada uno en su variable.
Sin el segundo webhook, los rebotes y quejas **no** alimentan la lista de supresion de Elixir.

## 7. Alinea el dominio visible del remitente

Para pasar mejor los filtros:
- envía desde el mismo dominio que verificaste en Resend
- evita mandar desde `gmail.com`, `outlook.com` o dominios ajenos usando tu propio servidor
- intenta que el `From:` coincida con el dominio autenticado por SPF y DKIM

Buena práctica:
- `From: Equipo <hola@example.com>`

Mala práctica:
- autenticas `example.com` pero envías como `algo@gmail.com`

## 8. Configura reverse path o tracking domain si Resend lo ofrece

Algunos proveedores mejoran la alineación usando un subdominio para tracking, links o return-path.

Si Resend te muestra un `CNAME` adicional para esto:
- publícalo
- espera propagación
- úsalo en lugar de dejar el valor por defecto del proveedor

Eso ayuda a que los enlaces y rebotes queden alineados con tu dominio.

## 9. Checklist mínimo antes de enviar campañas o tráfico real

Tu dominio debería cumplir todo esto:
- SPF válido y único
- DKIM verificado
- DMARC publicado
- MX configurado si vas a recibir correo
- webhook de Resend apuntando a Bloomx
- `TOP_DOMAIN` configurado con el dominio correcto
- `From:` usando el mismo dominio autenticado

## 10. Verifica antes de escalar volumen

Haz estas pruebas:
- envía correos a Gmail, Outlook y una cuenta corporativa
- revisa en el mensaje recibido si aparece `SPF=PASS`, `DKIM=PASS` y `DMARC=PASS`
- usa herramientas como Mail-Tester, MXToolbox o Google Postmaster Tools

Si sigues cayendo en spam aun con DNS bien configurado, normalmente el problema ya no es DNS sino alguno de estos puntos:
- dominio demasiado nuevo
- volumen muy alto de golpe
- contenido con mala reputación
- enlaces sospechosos
- quejas de usuarios o rebotes altos

## 11. Recomendación simple y segura

Si quieres la versión corta:
1. Verifica tu dominio en Resend.
2. Publica exactamente los SPF, DKIM, MX y CNAME que Resend te muestre.
3. Añade DMARC con `p=none`.
4. Configura `TOP_DOMAIN` con tu dominio real.
5. Apunta el webhook a `/api/webhooks/resend`.
6. No envíes volumen alto hasta confirmar `PASS` en SPF, DKIM y DMARC.

## 12. Advertencias importantes sobre MX y coexistencia con otro correo

- Publicar los `MX` de Resend en el dominio raíz **reemplaza** cualquier otro proveedor de correo entrante (Google Workspace, Microsoft 365). Si ya recibes correo en ese dominio, usa un subdominio dedicado para Bloomx (por ejemplo `mail.example.com`) y ajusta `TOP_DOMAIN` en consecuencia.
- Mantén un solo conjunto de `MX` activo por dominio o subdominio. Mezclar proveedores hace que parte del correo se pierda.
- El buzón `rua` de DMARC (`dmarc@tudominio.com`) también depende de tus `MX`: si el dominio apunta a Bloomx, los reportes llegarán como adjuntos `.zip`/`.gz` al usuario `dmarc` (debe existir en Bloomx).

## 13. TLS en tránsito: MTA-STS y TLS-RPT (NIST SP 800-177r1 sec. 5, ISO 27002:2022 8.24)

Bloomx recibe y envía a través de Resend, que negocia TLS oportunista. Para **exigir** TLS a quienes te envían correo:

1. Publica el registro `TXT` de política:

```txt
TXT _mta-sts  v=STSv1; id=20260101000000
```

2. Sirve la política por HTTPS en `https://mta-sts.tudominio.com/.well-known/mta-sts.txt` (certificado válido, sin redirecciones):

```txt
version: STSv1
mode: testing
mx: <host MX exacto que te da Resend>
max_age: 86400
```

3. Empieza con `mode: testing`; cuando los reportes no muestren fallos, pasa a `mode: enforce` y sube `max_age` a 604800 o más. **Cada vez que cambies la política, cambia el `id`.**
4. Habilita reportes de TLS:

```txt
TXT _smtp._tls  v=TLSRPTv1; rua=mailto:tlsrpt@tudominio.com
```

Bloomx **no sirve** `/.well-known/mta-sts.txt` ni ninguna ruta MTA-STS/TLS-RPT: el archivo de política debe alojarlo quien gestione tu DNS/web (por ejemplo un host estático en `mta-sts.tudominio.com`). La única ruta `/.well-known` de BloomX es `bloomx-backend-key.json` del backend (clave pública de firma) y no tiene relación con esto.

Si no puedes alojar el archivo de política en `mta-sts.tudominio.com`, omite MTA-STS (un `id` publicado sin política accesible causa fallos de entrega en algunos emisores). TLS-RPT sí puede publicarse siempre.

## 14. Otros registros recomendados

- **DNSSEC** en el dominio (habilítalo en tu registrador o DNS): protege SPF/DKIM/DMARC/MTA-STS contra falsificación de respuestas DNS.
- **CAA**: limita qué autoridades pueden emitir certificados para tu dominio, por ejemplo `CAA 0 issue "letsencrypt.org"`.
- **SPF**: máximo 10 consultas DNS (`include`, `a`, `mx`, `redirect`). Pasar de 10 produce `permerror` y DMARC falla. Usa `-all` (o `~all` mientras pruebas) y nunca `+all` ni `?all`.
- **DKIM**: claves de 2048 bits. Rota el selector periódicamente (cada 6 a 12 meses) y publica el selector nuevo antes de retirar el antiguo.
- **ARC**: solo aplica si reenvías o alojas listas. Bloomx no firma ARC; no lo necesitas para envío directo.
- **BIMI** (opcional): requiere DMARC con `p=quarantine` o `p=reject`.
- **Reverse DNS / IP dedicada**: solo aplica si tu plan de Resend usa IP dedicada; en ese caso configura el PTR con el proveedor.

## 15. Autenticación de correos entrantes en Bloomx

- Bloomx lee la cabecera `Authentication-Results` (SPF/DKIM/DMARC) añadida por Resend, la usa para puntuar spam (`dmarc=fail`, `spf=fail`, `dkim=fail` suben el puntaje) y **no envía rebotes** a remitentes con fallos de autenticación (evita backscatter).
- `GET /api/emails/[id]` devuelve el campo `authentication` (`spf`, `dkim`, `dmarc`, `summary`) para mostrarlo en la interfaz.
- Verifica en un correo real recibido que la cabecera exista. Si Resend no la incluye para tu región o plan, no habrá veredicto y `authentication` será `null`.
- No confíes en el nombre visible del remitente: un `From:` con `dmarc=fail` puede ser suplantación.

## 16. Envíos masivos (Elixir) y baja (RFC 8058)

Gmail y Yahoo exigen a remitentes de volumen (más de 5000 correos al día) SPF, DKIM y DMARC alineados, tasa de quejas menor a 0,3 % y baja de un clic.

- Los envíos masivos de Elixir incluyen `List-Unsubscribe` y `List-Unsubscribe-Post: List-Unsubscribe=One-Click` y omiten a quienes ya se dieron de baja.
- Requisitos: `NEXT_PUBLIC_APP_URL` con `https://` público y un secreto (`UNSUBSCRIBE_SECRET`, o `NEXTAUTH_SECRET` como respaldo). Sin estos, la cabecera no se añade.
- Endpoint público de baja: `https://tu-dominio-publico/api/webhooks/unsubscribe`.
- Variables de operación relacionadas: `MAX_SENDS_PER_HOUR` (por defecto 200, envíos normales por hora y usuario), `ELIXIR_BATCH_MAX` (filas por petición, por defecto 50, tope 100), `ELIXIR_MAX_ROWS_PER_HOUR` (cuota por hora, por defecto 5000; `MAX_BULK_ROWS` es un alias antiguo con el mismo significado), `ELIXIR_MAX_CAMPAIGN_ROWS` (filas por campaña, por defecto 20000), `WEBHOOK_SECRET` y `RESEND_WEBHOOK_SECRET` (opcionales). `INTERNAL_SECRET` ya no es necesario: la clave interna se deriva de `NEXTAUTH_SECRET`.
- Los rebotes permanentes y las quejas llegan por `/api/webhooks/resend-events` y se añaden a la lista de supresión; la lista de Elixir los omite en envíos posteriores.
- Calienta el dominio: sube el volumen de forma gradual durante 2 a 4 semanas.
