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
TXT _dmarc  v=DMARC1; p=none; adkim=s; aspf=s; pct=100
```

Recomendación simple:
- empieza con `p=none`
- cuando confirmes que SPF y DKIM pasan de forma consistente, sube a `p=quarantine`
- finalmente considera `p=reject`

Si quieres reportes, añade una casilla real:

```txt
TXT _dmarc  v=DMARC1; p=none; rua=mailto:dmarc@tudominio.com; adkim=s; aspf=s; pct=100
```

Necesitas crear ese buzón o alias si vas a recibir reportes.

## 6. MX: necesario si Bloomx va a recibir correos

Si quieres inbound email en Bloomx, no basta con enviar. También debes configurar los MX del dominio o subdominio que Resend usa para recepción.

Qué hacer:
- activa inbound en Resend
- publica exactamente los registros `MX` que Resend te muestre
- configura el webhook de recepción hacia Bloomx

Endpoint de Bloomx:

```txt
https://tu-dominio-publico/api/webhooks/resend
```

Variables relacionadas:

```env
TOP_DOMAIN="example.com"
RESEND_API_KEY="re_..."
WEBHOOK_SECRET="whsec_..."
NEXT_PUBLIC_APP_URL="https://app.example.com"
```

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
