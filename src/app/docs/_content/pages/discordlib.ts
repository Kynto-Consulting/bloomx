import type { Block, DocPageContent } from '../types';

const portalEx = `Application ID        General Information  -> DISCORD_APPLICATION_ID (Bot ID)
Public Key            General Information  -> DISCORD_PUBLIC_KEY   (64 hex)
Bot token             Bot > Reset Token    -> DISCORD_BOT_TOKEN    (se muestra una sola vez)
Invitación            OAuth2 > URL Generator: scope "bot" (+ "applications.commands")
Interactions URL      https://<instancia>/api/ext/core-discordlib/interactions`;

const portalExEn = `Application ID        General Information  -> DISCORD_APPLICATION_ID (Bot ID)
Public Key            General Information  -> DISCORD_PUBLIC_KEY   (64 hex)
Bot token             Bot > Reset Token    -> DISCORD_BOT_TOKEN    (shown only once)
Invite                OAuth2 > URL Generator: scope "bot" (+ "applications.commands")
Interactions URL      https://<instance>/api/ext/core-discordlib/interactions`;

const usageEx = `const d = ctx.libs.discord;
const guild = await d.guilds.fetch("123456789012345678");
const [general] = await guild.channels.list();

const sent = await d.channels.send(general.id, {
  content: "Nuevo correo de Ana",
  embeds: [{ title: "Asunto", description: "Resumen sin cuerpo" }],
});
await d.reactions.add(general.id, sent.id, "👍");

const last = await d.messages.list(general.id, { limit: 50 });          // limit <= 100
const found = await d.members.search(guild.id, { query: "ana", limit: 5 });

const thread = await d.threads.create(general.id, { name: "Seguimiento", messageId: sent.id });
await d.threads.send(thread.id, "Primer mensaje");

await d.commands.register({ name: "estado", description: "Estado del buzón" });                       // global
await d.commands.register({ name: "estado", description: "Estado del buzón" }, { guildId: guild.id }); // de un servidor`;

const usageExEn = usageEx
    .replace('"Nuevo correo de Ana"', '"New mail from Ana"')
    .replace('"Resumen sin cuerpo"', '"Summary without body"')
    .replace('"Seguimiento"', '"Follow-up"')
    .replace('"Primer mensaje"', '"First message"')
    .replace(/"Estado del buzón"/g, '"Mailbox status"')
    .replace('// de un servidor', '// one server');

const errorsEx = `try {
  await ctx.libs.discord.channels.send(channelId, "Hola");
} catch (e) {
  // Fachada: DISCORD_INVALID_ID, DISCORD_INVALID_ARGUMENT, DISCORD_CONTENT_TOO_LONG,
  //          DISCORD_TOO_MANY_EMBEDS, DISCORD_MENTIONS_NOT_ALLOWED, DISCORD_API_ERROR (+ discordCode)
  // Núcleo:  OAUTH_ERROR con reason: forbidden | rate_limited (retryAfter) | not_configured | quota_exceeded
  if (e.code === "OAUTH_ERROR" && e.reason === "rate_limited") return { retryAfter: e.retryAfter };
  throw e;
}`;

const errorsExEn = errorsEx
    .replace('"Hola"', '"Hello"')
    .replace('Fachada:', 'Facade:')
    .replace('Núcleo:  OAUTH_ERROR con reason', 'Core:    OAUTH_ERROR with reason');

const manifestEx = `{
  "id": "acme-discord-commands",
  "version": "1.0.0",
  "permissions": ["OAUTH_SHARED:discord", "OAUTH_ACCOUNT:discord:bot-write"],
  "requires": {
    "clientApi": 12,
    "capabilities": ["oauth.broker.v1", "oauth.provider.v3"],
    "extensions": { "core-discordlib": "^1.1.0" }
  },
  "api": { "functions": { "onInteraction": { "handler": "onInteraction" } } },
  "hooks": [{ "point": "DISCORD_INTERACTION", "handler": "onInteraction" }]
}`;

const handlerEx = `// server.js
export async function onInteraction(ctx) {
  const { interaction, phase } = ctx; // sin ctx.libs ni ctx.services (modo público)
  if (phase === "deferred") return { respond: { content: "Listo (respuesta diferida)" } };
  if (interaction.kind === "command" && interaction.command.name === "estado") {
    return { respond: { content: "Buzón al día", ephemeral: true } };
  }
  if (interaction.kind === "component") return { update: { content: "Pulsado" } };
  if (interaction.kind === "autocomplete") return { choices: [{ name: "Entrada", value: "inbox" }] };
  if (interaction.kind === "command") return { defer: true, ephemeral: true }; // responde en la fase 2 (hasta 20 s)
}`;

const handlerExEn = handlerEx
    .replace('"Listo (respuesta diferida)"', '"Done (deferred reply)"')
    .replace('"Buzón al día"', '"Mailbox up to date"')
    .replace('"Pulsado"', '"Pressed"')
    .replace('"Entrada"', '"Inbox"')
    .replace('responde en la fase 2', 'reply in phase 2')
    .replace('sin ctx.libs ni ctx.services (modo público)', 'no ctx.libs or ctx.services (public mode)');

const es: Block[] = [
    { t: 'p', text: '**DiscordLib** (`core-discordlib`, versión 1.1.0) es el proveedor `discord` del núcleo y el SDK `ctx.libs.discord` para otras extensiones. Cubre tres piezas independientes: el **OAuth de usuario** (cada usuario conecta su Discord y, con `webhook.incoming`, elige su canal), el **bot del dominio** (una fachada estilo discord.js sobre la API REST de Discord, sin gateway) y las **Interactions por HTTP** (slash commands, botones, modales y autocompletar). El token del bot **nunca sale del núcleo**. Sigue el patrón de GoogleLib y los demás proveedores de [Proveedores OAuth como extensión](/docs/oauth-providers).' },
    { t: 'h2', id: 'portal', text: 'Crear la aplicación y el bot (Developer Portal)' },
    { t: 'ol', items: [
        'En discord.com/developers/applications pulsa **New Application**. Copia el **Application ID** y la **Public Key** (General Information).',
        'En **Bot** pulsa **Reset Token** y copia el token (solo se muestra una vez). **No hace falta activar ningún Privileged Gateway Intent**: no hay gateway.',
        'Excepción: para LEER el `content` de mensajes ajenos por REST, Discord exige el intent **Message Content** en el portal. Sin él, `content` llega vacío salvo en mensajes del propio bot, mensajes directos y menciones.',
        'En **OAuth2 > URL Generator** marca el scope `bot` (y `applications.commands` si registras comandos) con los permisos justos (p. ej. Send Messages y Read Message History). Abre la URL e invita el bot al servidor.',
        'En los ajustes de la extensión guarda Bot ID, Bot Token, y servidor por defecto y/o servidores permitidos. Aprueba los permisos de cada extensión consumidora.',
        '(Opcional, Interactions) Guarda la Public Key y pega la URL de Interactions en el portal; Discord envía un PING firmado y, si responde 200, queda validada.',
    ] },
    { t: 'code', lang: 'text', title: 'Dónde está cada dato', code: portalEx },
    { t: 'h2', id: 'settings', text: 'Ajustes' },
    { t: 'table', head: ['Clave', 'Tipo y formato', 'Notas'], rows: [
        ['`DISCORD_APPLICATION_ID`', 'Texto (snowflake)', 'Bot ID. Rellena `{applicationId}` de los comandos; nunca lo elige quien llama.'],
        ['`DISCORD_BOT_TOKEN`', 'Secreto, forma `A.B.C` (tres segmentos base64url separados por puntos)', 'Write-only; cifrado en el núcleo y anclado a `discord.com`. Se valida la FORMA al guardar y en cada uso, no su validez (la documentación oficial no define el formato). Un token revocado devuelve 401 y se informa como "no configurado".'],
        ['`DISCORD_PUBLIC_KEY`', 'Secreto, 64 hex', 'Verifica la firma Ed25519 de las Interactions.'],
        ['`DISCORD_DEFAULT_GUILD_ID`', 'Texto (snowflake)', 'Servidor usado si no hay lista.'],
        ['`allowedGuildIds`', 'Lista de snowflakes', 'El núcleo rechaza cualquier acción en otro servidor. Vacía = solo el servidor por defecto; sin ninguno = nada.'],
        ['`allowModeration`', 'Booleano (apagado)', 'Activa las acciones `bot-mod`.'],
        ['`DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`', 'Texto / secreto', 'Solo para el OAuth de usuario (redirect `https://<instancia>/api/oauth/discord/callback`).'],
    ] },
    { t: 'h2', id: 'permissions', text: 'Permisos del consumidor y riesgo' },
    { t: 'p', text: 'Una extensión consumidora declara `OAUTH_SHARED:discord` y los grupos `OAUTH_ACCOUNT:discord:<grupo>` que necesite. **El administrador aprueba cada uno** (siempre aprobación explícita para `bot-*`). Requiere la capacidad `oauth.provider.v3` y la clave de dominio de la instancia (ver [Requisito: la clave de dominio](/docs/oauth-providers#domain-key)).' },
    { t: 'table', head: ['Grupo', 'Riesgo', 'Acciones (`ctx.libs.discord...`)'], rows: [
        ['`bot-read`', 'Medio', '`guilds.list/fetch`, `channels.listIn/fetch`, `guilds.threads`, `roles.list`, `members.list/fetch/search`, `messages.list/fetch`, `reactions.list`, `webhooks.list` (sin token), `users.fetch`, `commands.list`.'],
        ['`bot-write`', 'Alto', '`messages.send/edit` (sin menciones), `reactions.add/remove`, `threads.create/send/join`, `commands.register`.'],
        ['`bot-mod`', 'Crítico, **apagado por defecto**', '`members.kick/ban/unban`, `roles.add/remove`, `messages.remove`, `commands.remove`. Requiere además `allowModeration`.'],
    ] },
    { t: 'h2', id: 'usage', text: 'Ejemplos de uso' },
    { t: 'p', text: 'La fachada valida antes de llamar: snowflakes, `limit` (mensajes <= 100, miembros <= 200), `content` <= 2000, <= 10 embeds (6000 caracteres en total) y comandos (`^[-_a-z0-9]{1,32}$`, descripción 1..100, <= 25 opciones). Las respuestas se **filtran a campos conocidos** (sin tokens ni datos del bot).' },
    { t: 'code', lang: 'js', title: 'Servidores, canales, mensajes, hilos y comandos', code: usageEx },
    { t: 'h3', id: 'errors', text: 'Manejo de errores' },
    { t: 'p', text: 'Errores de la fachada: `DISCORD_INVALID_ID`, `DISCORD_INVALID_ARGUMENT`, `DISCORD_CONTENT_TOO_LONG`, `DISCORD_TOO_MANY_EMBEDS`, `DISCORD_MENTIONS_NOT_ALLOWED` y `DISCORD_API_ERROR` (con `discordCode`). Los del núcleo llegan como `OAUTH_ERROR` con `reason`: `forbidden`, `rate_limited`, `not_configured` o `quota_exceeded`.' },
    { t: 'code', lang: 'js', title: 'Capturar errores', code: errorsEx },
    { t: 'h2', id: 'guarantees', text: 'Garantías de seguridad del núcleo' },
    { t: 'p', text: 'Las aplica el **núcleo**, no la extensión:' },
    { t: 'ul', items: [
        '**El token nunca sale**: `Authorization: Bot` se inyecta en el núcleo y jamás se devuelve; las claves `token` y `secret` se eliminan de toda respuesta.',
        '**Host fijo** `discord.com` (API v10).',
        '**Ids validados**: snowflakes `^[0-9]{17,20}$`, sin traversal de rutas.',
        '**Servidores permitidos**: servidor, canal e hilo deben pertenecer a `allowedGuildIds` (los canales se resuelven a su servidor con `GET /channels/{id}`; los mensajes directos se rechazan).',
        '**Sin menciones**: `allowed_mentions.parse = []` fijo en todo mensaje saliente.',
        '**Moderación apagada** por defecto (`allowModeration`).',
        '**Cuotas por hora** por acción (200-600/h en mensajes, 60/h en moderación) además de la cuota por minuto.',
        '**Límites de tasa de Discord**: se respetan los cubos `X-RateLimit-*`; un 429 con `retry_after` <= 3 s se espera y se reintenta una vez; si es mayor se devuelve `rate_limited` con `retryAfter`.',
        '**Respuestas filtradas** y con tope de tamaño.',
        '**Auditoría sin contenido**: `oauth.action` registra acción, grupo, servidor, estado y duración, nunca el contenido de los mensajes ni los parámetros.',
    ] },
    { t: 'h2', id: 'interactions', text: 'Interactions por HTTP' },
    { t: 'p', text: 'Pega `https://<instancia>/api/ext/core-discordlib/interactions` como **Interactions Endpoint URL** en el portal. La ruta es `POST /interactions` con `auth: hmac`, `algorithm: ed25519` y `signedPayload: timestamp+body`.' },
    { t: 'ul', items: [
        '**Firma**: se verifica Ed25519 sobre **timestamp + cuerpo crudo** (cabeceras `X-Signature-Ed25519` y `X-Signature-Timestamp`) con `DISCORD_PUBLIC_KEY`; se rechazan timestamps fuera de +-5 min y firmas repetidas. Sin clave configurada responde 503 (nunca acepta sin verificar). Cuerpo máximo 64 KB.',
        '**PING** (`type 1`): se responde con `{ type: 1 }`.',
        '**Entrega**: comandos, componentes, autocompletar y modales llegan al hook `DISCORD_INTERACTION` de las extensiones con `OAUTH_SHARED:discord` aprobado, con una vista saneada **sin el token de la interacción**, en modo público (sin `ctx.services` ni `ctx.libs`) y con 2,5 s de presupuesto (Discord exige responder en 3 s). El primer handler que responde gana.',
        '**Respuestas**: `{ respond }` (type 4), `{ update }` (type 7), `{ choices }` (type 8) o `{ defer: true }` (type 5/6).',
        '**Fase diferida**: tras `defer` el núcleo contesta de inmediato y, en una segunda fase (`ctx.phase === "deferred"`, hasta 20 s, vía `after()` de Next), envía el `respond` como edición del mensaje original en `discord.com` (el token de la interacción solo lo usa el núcleo y caduca a los 15 min). Todo mensaje saliente se sanea (sin menciones, <= 2000 caracteres, <= 10 embeds, solo el flag `ephemeral`).',
    ] },
    { t: 'code', lang: 'json', title: 'Manifest de un consumidor', code: manifestEx },
    { t: 'code', lang: 'js', title: 'Handler del hook', code: handlerEx },
    { t: 'callout', kind: 'note', text: 'Dentro del hook no hay `ctx.libs`. Lo que necesites consultar a Discord hazlo antes con un handler normal, o devuelve `defer` y responde en la fase 2.' },
    { t: 'h2', id: 'limits', text: 'Qué NO se puede hacer en serverless' },
    { t: 'p', text: 'Discord entrega los eventos en vivo (mensajes nuevos, presencia, reacciones, entradas a servidores, voz) por el **gateway**, una conexión **websocket persistente** con heartbeat e intents. Una función serverless nace, responde y muere en segundos: no puede mantener esa conexión. Por eso `core-discordlib` **no implementa gateway, voz ni presencia en tiempo real**, y `ctx.libs.discord` no tiene eventos (`client.on(...)`). Alternativas:' },
    { t: 'ul', items: [
        '**Interacciones de usuario en tiempo real**: Interactions por HTTP (arriba).',
        '**Estado y mensajes**: consultas bajo demanda (`messages.list` con `after`, `members.list`, `guilds.threads`) desde un handler `CRON` o una acción del usuario (polling acotado).',
        '**Eventos continuos** (moderación automática de cada mensaje, presencia, voz): necesitan un proceso persistente externo a esta plataforma que llame al bot; no es posible aquí.',
    ] },
    { t: 'h2', id: 'sources', text: 'Fuentes oficiales' },
    { t: 'ul', items: [
        '[Referencia de la API](https://docs.discord.com/developers/reference): formato `Authorization: Bot <token>`, snowflakes como cadenas, `User-Agent`.',
        '[Límites de tasa](https://docs.discord.com/developers/topics/rate-limits): cabeceras `X-RateLimit-*`, 429 con `retry_after` y `global`.',
        '[Interactions](https://docs.discord.com/developers/interactions/overview): firma Ed25519, PING y respuestas.',
        '[OAuth2](https://docs.discord.com/developers/topics/oauth2): authorize, token, revoke y scopes `identify`, `guilds`, `webhook.incoming`.',
    ] },
    { t: 'p', text: 'Compatibilidad: la 1.1.0 solo **añade** campos de manifest bajo `oauth.provider.v3`; las instancias sin esa capacidad siguen recibiendo la 1.0.0. Los tipos exactos están en [TSDocs: referencia del SDK](/docs/extension-tools/tsdocs).' },
];

const en: Block[] = [
    { t: 'p', text: '**DiscordLib** (`core-discordlib`, version 1.1.0) is the core `discord` provider and the `ctx.libs.discord` SDK for other extensions. It covers three independent pieces: **user OAuth** (each user connects their Discord and, with `webhook.incoming`, picks their channel), the **domain bot** (a discord.js-style facade over the Discord REST API, with no gateway) and **Interactions over HTTP** (slash commands, buttons, modals and autocomplete). The bot token **never leaves the core**. It follows the GoogleLib pattern and the other providers in [OAuth providers as extensions](/docs/oauth-providers).' },
    { t: 'h2', id: 'portal', text: 'Create the application and bot (Developer Portal)' },
    { t: 'ol', items: [
        'At discord.com/developers/applications press **New Application**. Copy the **Application ID** and the **Public Key** (General Information).',
        'Under **Bot** press **Reset Token** and copy the token (shown only once). **No Privileged Gateway Intent is needed**: there is no gateway.',
        'Exception: to READ the `content` of other people\'s messages over REST, Discord requires the **Message Content** intent in the portal. Without it, `content` arrives empty except in the bot\'s own messages, direct messages and mentions.',
        'Under **OAuth2 > URL Generator** tick the `bot` scope (and `applications.commands` if you register commands) with the minimum permissions (e.g. Send Messages and Read Message History). Open the URL and invite the bot to the server.',
        'In the extension settings store Bot ID, Bot Token, and the default server and/or allowed servers. Approve the permissions of each consumer extension.',
        '(Optional, Interactions) Store the Public Key and paste the Interactions URL in the portal; Discord sends a signed PING and, if it answers 200, it is validated.',
    ] },
    { t: 'code', lang: 'text', title: 'Where each value lives', code: portalExEn },
    { t: 'h2', id: 'settings', text: 'Settings' },
    { t: 'table', head: ['Key', 'Type and format', 'Notes'], rows: [
        ['`DISCORD_APPLICATION_ID`', 'Text (snowflake)', 'Bot ID. Fills `{applicationId}` in commands; the caller never chooses it.'],
        ['`DISCORD_BOT_TOKEN`', 'Secret, `A.B.C` shape (three base64url segments separated by dots)', 'Write-only; encrypted in the core and pinned to `discord.com`. Only the SHAPE is checked on save and on every use, not its validity (the official docs define no format). A revoked token returns 401 and is reported as "not configured".'],
        ['`DISCORD_PUBLIC_KEY`', 'Secret, 64 hex', 'Verifies the Ed25519 signature of Interactions.'],
        ['`DISCORD_DEFAULT_GUILD_ID`', 'Text (snowflake)', 'Server used when there is no list.'],
        ['`allowedGuildIds`', 'List of snowflakes', 'The core rejects any action on another server. Empty = default server only; none at all = nothing.'],
        ['`allowModeration`', 'Boolean (off)', 'Enables the `bot-mod` actions.'],
        ['`DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`', 'Text / secret', 'User OAuth only (redirect `https://<instance>/api/oauth/discord/callback`).'],
    ] },
    { t: 'h2', id: 'permissions', text: 'Consumer permissions and risk' },
    { t: 'p', text: 'A consumer extension declares `OAUTH_SHARED:discord` and the `OAUTH_ACCOUNT:discord:<group>` groups it needs. **The administrator approves each one** (explicit approval is always required for `bot-*`). It requires the `oauth.provider.v3` capability and the instance domain key (see [Requirement: the instance domain key](/docs/oauth-providers#domain-key)).' },
    { t: 'table', head: ['Group', 'Risk', 'Actions (`ctx.libs.discord...`)'], rows: [
        ['`bot-read`', 'Medium', '`guilds.list/fetch`, `channels.listIn/fetch`, `guilds.threads`, `roles.list`, `members.list/fetch/search`, `messages.list/fetch`, `reactions.list`, `webhooks.list` (no token), `users.fetch`, `commands.list`.'],
        ['`bot-write`', 'High', '`messages.send/edit` (no mentions), `reactions.add/remove`, `threads.create/send/join`, `commands.register`.'],
        ['`bot-mod`', 'Critical, **off by default**', '`members.kick/ban/unban`, `roles.add/remove`, `messages.remove`, `commands.remove`. Also requires `allowModeration`.'],
    ] },
    { t: 'h2', id: 'usage', text: 'Usage examples' },
    { t: 'p', text: 'The facade validates before calling: snowflakes, `limit` (messages <= 100, members <= 200), `content` <= 2000, <= 10 embeds (6000 characters in total) and commands (`^[-_a-z0-9]{1,32}$`, description 1..100, <= 25 options). Responses are **filtered to known fields** (no tokens or bot data).' },
    { t: 'code', lang: 'js', title: 'Servers, channels, messages, threads and commands', code: usageExEn },
    { t: 'h3', id: 'errors', text: 'Error handling' },
    { t: 'p', text: 'Facade errors: `DISCORD_INVALID_ID`, `DISCORD_INVALID_ARGUMENT`, `DISCORD_CONTENT_TOO_LONG`, `DISCORD_TOO_MANY_EMBEDS`, `DISCORD_MENTIONS_NOT_ALLOWED` and `DISCORD_API_ERROR` (with `discordCode`). Core errors arrive as `OAUTH_ERROR` with a `reason`: `forbidden`, `rate_limited`, `not_configured` or `quota_exceeded`.' },
    { t: 'code', lang: 'js', title: 'Catching errors', code: errorsExEn },
    { t: 'h2', id: 'guarantees', text: 'Core security guarantees' },
    { t: 'p', text: 'Enforced by the **core**, not by the extension:' },
    { t: 'ul', items: [
        '**The token never leaves**: `Authorization: Bot` is injected in the core and never returned; the `token` and `secret` keys are stripped from every response.',
        '**Fixed host** `discord.com` (API v10).',
        '**Validated ids**: snowflakes `^[0-9]{17,20}$`, no path traversal.',
        '**Allowed servers**: server, channel and thread must belong to `allowedGuildIds` (channels are resolved to their server with `GET /channels/{id}`; direct messages are rejected).',
        '**No mentions**: `allowed_mentions.parse = []` is fixed on every outgoing message.',
        '**Moderation off** by default (`allowModeration`).',
        '**Hourly quotas** per action (200-600/h for messages, 60/h for moderation) on top of the per-minute quota.',
        '**Discord rate limits**: `X-RateLimit-*` buckets are honoured; a 429 with `retry_after` <= 3 s is awaited and retried once; if larger, `rate_limited` is returned with `retryAfter`.',
        '**Filtered responses** with a size cap.',
        '**Content-free audit**: `oauth.action` records action, group, server, status and duration, never message content or parameters.',
    ] },
    { t: 'h2', id: 'interactions', text: 'Interactions over HTTP' },
    { t: 'p', text: 'Paste `https://<instance>/api/ext/core-discordlib/interactions` as the **Interactions Endpoint URL** in the portal. The route is `POST /interactions` with `auth: hmac`, `algorithm: ed25519` and `signedPayload: timestamp+body`.' },
    { t: 'ul', items: [
        '**Signature**: Ed25519 is verified over **timestamp + raw body** (headers `X-Signature-Ed25519` and `X-Signature-Timestamp`) with `DISCORD_PUBLIC_KEY`; timestamps outside +-5 min and replayed signatures are rejected. With no key configured it answers 503 (it never accepts unverified). Body limit 64 KB.',
        '**PING** (`type 1`): answered with `{ type: 1 }`.',
        '**Delivery**: commands, components, autocomplete and modals reach the `DISCORD_INTERACTION` hook of extensions with `OAUTH_SHARED:discord` approved, as a sanitised view **without the interaction token**, in public mode (no `ctx.services` or `ctx.libs`) and with a 2.5 s budget (Discord requires an answer within 3 s). The first handler that answers wins.',
        '**Responses**: `{ respond }` (type 4), `{ update }` (type 7), `{ choices }` (type 8) or `{ defer: true }` (type 5/6).',
        '**Deferred phase**: after `defer` the core answers at once and, in a second phase (`ctx.phase === "deferred"`, up to 20 s, through Next\'s `after()`), sends the `respond` as an edit of the original message on `discord.com` (the interaction token is only used by the core and expires after 15 min). Every outgoing message is sanitised (no mentions, <= 2000 characters, <= 10 embeds, only the `ephemeral` flag).',
    ] },
    { t: 'code', lang: 'json', title: 'Consumer manifest', code: manifestEx },
    { t: 'code', lang: 'js', title: 'Hook handler', code: handlerExEn },
    { t: 'callout', kind: 'note', text: 'There is no `ctx.libs` inside the hook. Whatever you need to query from Discord, do it earlier in a normal handler, or return `defer` and answer in phase 2.' },
    { t: 'h2', id: 'limits', text: 'What is NOT possible on serverless' },
    { t: 'p', text: 'Discord delivers live events (new messages, presence, reactions, server joins, voice) through the **gateway**, a **persistent websocket** connection with heartbeat and intents. A serverless function is born, answers and dies within seconds: it cannot hold that connection. That is why `core-discordlib` **does not implement the gateway, voice or real-time presence**, and `ctx.libs.discord` has no events (`client.on(...)`). Alternatives:' },
    { t: 'ul', items: [
        '**Real-time user interactions**: Interactions over HTTP (above).',
        '**State and messages**: on-demand queries (`messages.list` with `after`, `members.list`, `guilds.threads`) from a `CRON` handler or a user action (bounded polling).',
        '**Continuous events** (automatic moderation of every message, presence, voice): they need a persistent process outside this platform that calls the bot; not possible here.',
    ] },
    { t: 'h2', id: 'sources', text: 'Official sources' },
    { t: 'ul', items: [
        '[API reference](https://docs.discord.com/developers/reference): `Authorization: Bot <token>` format, snowflakes as strings, `User-Agent`.',
        '[Rate limits](https://docs.discord.com/developers/topics/rate-limits): `X-RateLimit-*` headers, 429 with `retry_after` and `global`.',
        '[Interactions](https://docs.discord.com/developers/interactions/overview): Ed25519 signature, PING and responses.',
        '[OAuth2](https://docs.discord.com/developers/topics/oauth2): authorize, token, revoke and the `identify`, `guilds`, `webhook.incoming` scopes.',
    ] },
    { t: 'p', text: 'Compatibility: 1.1.0 only **adds** manifest fields under `oauth.provider.v3`; instances without that capability keep receiving 1.0.0. The exact types are in [TSDocs: SDK reference](/docs/extension-tools/tsdocs).' },
];

const page: DocPageContent = { es, en };
export default page;
