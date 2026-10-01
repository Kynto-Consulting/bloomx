import type { Block, DocPageContent, Locale } from '../types';
import catalog from '../generated/admin-cli-catalog.json';

/**
 * /docs/admin-cli: consola de comandos (/admin/profile/console) y CLI `bloomx` (@kyntocg/bloomx-cli) sobre el MISMO motor.
 * La tabla de comandos por categoria sale de `generated/admin-cli-catalog.json` (npm run docs:admin-cli), que un test compara con el
 * catalogo real: la documentacion no puede desviarse del codigo.
 */

interface Cmd { name: string; category: { es: string; en: string }; risk: string; minLevel: number; mfaStepUp: boolean; summary: { es: string; en: string }; managerOnly: boolean }
const commands = catalog.commands as unknown as Cmd[];
const levels = catalog.levels as unknown as { permission_level: number; es: { name: string; can: string }; en: { name: string; can: string } }[];
const excluded = catalog.excluded as unknown as Record<string, { es: string; en: string }>;
const limits = catalog.limits;

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function categories(): { key: string; es: string; en: string; cmds: Cmd[] }[] {
    const out: { key: string; es: string; en: string; cmds: Cmd[] }[] = [];
    for (const c of commands) {
        const key = slug(c.category.en);
        let g = out.find((x) => x.key === key);
        if (!g) { g = { key, es: c.category.es, en: c.category.en, cmds: [] }; out.push(g); }
        g.cmds.push(c);
    }
    return out;
}

function build(l: Locale): Block[] {
    const T = <A, B>(es: A, en: B) => (l === 'es' ? es : en) as A | B;
    const t = (es: string, en: string) => T(es, en) as string;
    const riskText = (r: string) => ({ read: t('lectura', 'read'), write: t('escritura', 'write'), destructive: t('destructivo', 'destructive'), security: t('seguridad', 'security') }[r] ?? r);
    const b: Block[] = [];

    b.push({ t: 'p', text: t(
        'La administración de BloomX se puede hacer también **con comandos**: una **terminal en el navegador** (`/admin/profile/console`) y una **CLI por API** (`bloomx`, paquete `@kyntocg/bloomx-cli`) que se conecta por HTTPS a la misma instancia. Ambas usan el **mismo motor**: un catálogo de comandos tipado cuyos handlers llaman a las MISMAS rutas `/api/admin/*` que la consola gráfica (misma validación, límites y auditoría), así que nada se duplica y nada queda fuera.',
        'BloomX administration can also be done **with commands**: a **terminal in the browser** (`/admin/profile/console`) and an **API-based CLI** (`bloomx`, package `@kyntocg/bloomx-cli`) that connects over HTTPS to the same instance. Both use the **same engine**: a typed command catalogue whose handlers call the SAME `/api/admin/*` routes as the graphical console (same validation, limits and audit), so nothing is duplicated and nothing is left out.',
    ) });
    b.push({ t: 'callout', kind: 'warn', title: t('SSH real: no en Vercel', 'Real SSH: not on Vercel'), text: t(
        'Vercel solo sirve HTTP(S): **no puede exponer el puerto 22**. `bloomx ssh` es una experiencia equivalente (un shell interactivo con autocompletado e historial) **sobre HTTPS**, no el protocolo SSH. Cómo ofrecer SSH de verdad con una pasarela está descrito en [SSH real (opcional)](#ssh), sin implementarlo.',
        'Vercel only serves HTTP(S): it **cannot expose port 22**. `bloomx ssh` is an equivalent experience (an interactive shell with completion and history) **over HTTPS**, not the SSH protocol. How to offer real SSH with a gateway is described in [Real SSH (optional)](#ssh), not implemented.',
    ) });

    b.push({ t: 'h2', id: 'install', text: t('Instalación', 'Installation') });
    b.push({ t: 'code', lang: 'bash', code: 'npm i -g @kyntocg/bloomx-cli     # Node >= 18, sin dependencias\n# o sin instalar:\nnpx @kyntocg/bloomx-cli login https://mail.example.com' });

    b.push({ t: 'h2', id: 'login', text: t('Iniciar sesión y dominio acotado', 'Logging in and the scoped domain') });
    b.push({ t: 'p', text: t(
        '`bloomx login https://mail.example.com` pide correo, **contraseña (sin eco)** y el **código MFA** si aplica, y guarda un **token** (nunca la contraseña) en tu almacén de usuario con permisos `0600` (`~/.config/bloomx/credentials.json`, `%APPDATA%\\bloomx` en Windows; jamás en el repositorio). La cuenta debe ser un **administrador de esa instancia** (`permission_level` ≥ 1) o la **manager dueña del dominio** de la instancia en el backend compartido. Tras el login la CLI muestra el dominio al que quedó acotada la sesión y **todos los comandos operan solo sobre ese dominio**: no existe una bandera `--domain`.',
        '`bloomx login https://mail.example.com` asks for email, **password (no echo)** and the **MFA code** if applicable, and stores a **token** (never the password) in your user store with `0600` permissions (`~/.config/bloomx/credentials.json`, `%APPDATA%\\bloomx` on Windows; never in the repository). The account must be an **administrator of that instance** (`permission_level` ≥ 1) or the **manager that owns the instance domain** on the shared backend. After login the CLI shows the domain the session is scoped to and **every command operates only on that domain**: there is no `--domain` flag.',
    ) });
    b.push({ t: 'code', lang: 'bash', code: [
        'bloomx login https://mail.example.com            # interactivo',
        'bloomx login https://mail.example.com --token bxa_...   # con un token creado en la consola web (tokens create)',
        'bloomx whoami                                    # cuenta, rol, permission_level, dominio y ámbitos',
        'bloomx profiles | bloomx use mail.acme.com       # varias instancias (perfiles)',
        'bloomx logout [--all]                            # revoca el token en el servidor',
    ].join('\n') });

    b.push({ t: 'h2', id: 'usage', text: t('Uso', 'Usage') });
    b.push({ t: 'code', lang: 'bash', code: [
        'bloomx help                                      # catálogo (solo lo que tu nivel permite)',
        'bloomx help users sessions revoke                # un comando',
        'bloomx users list --status disabled --json | jq .',
        'bloomx users create ana@example.com --name "Ana"  # contraseña temporal, se muestra UNA vez',
        'bloomx audit --event "admin.users.*" --from 2026-01-01',
        'bloomx theme export > theme.json && bloomx theme import --file theme.json --dry-run',
        'bloomx shell                                      # REPL (alias: bloomx ssh): Tab, ↑/↓, Ctrl+C, Ctrl+L',
    ].join('\n') });
    b.push({ t: 'ul', items: [
        t('**Salida**: tablas y texto con los colores de tu terminal (o del tema en la web); `--json` entrega datos en bruto para pipes; los comandos que devuelven CSV lo escriben a stdout (`> users.csv`) o con `--out`.', '**Output**: tables and text with your terminal colours (or the theme on the web); `--json` returns raw data for pipes; commands that return CSV write it to stdout (`> users.csv`) or with `--out`.'),
        t('**Entrada**: `--file ruta.json` o `--stdin` (pipe) para comandos con JSON/CSV; en la consola web, `--stdin` abre un modo pegado (termina con una línea `EOF`).', '**Input**: `--file path.json` or `--stdin` (pipe) for commands taking JSON/CSV; in the web console `--stdin` opens a paste mode (finish with an `EOF` line).'),
        t('**Códigos de salida**: 0 ok · 1 error del comando · 2 uso incorrecto · 3 sin permiso o sin sesión · 4 falta confirmación o step-up · 5 límite de tasa/tiempo · 6 red · 127 comando desconocido.', '**Exit codes**: 0 ok · 1 command error · 2 usage · 3 denied or not logged in · 4 needs confirmation or step-up · 5 rate limit/timeout · 6 network · 127 unknown command.'),
        t('**Consola web** (`/admin/profile/console`, enlazada en el menú y en «Mi perfil»): historial con ↑/↓ (solo en la pestaña), Tab (comandos, subcomandos, banderas, valores y correos de usuarios), `help`, `clear`/Ctrl+L, `exit`, Ctrl+C que cancela, copiar salida, región `role="log"` accesible y diseño adaptable.', '**Web console** (`/admin/profile/console`, linked from the menu and "My profile"): history with ↑/↓ (tab only), Tab (commands, subcommands, flags, values and user emails), `help`, `clear`/Ctrl+L, `exit`, Ctrl+C to cancel, copy output, accessible `role="log"` region and a responsive layout.'),
        t('Importar archivos de correo: `bloomx transfer import <archivo>` sube por trozos con hash y reanudación (`--resume`); `transfer download <job> --out` baja una exportación. El navegador no puede leer archivos locales desde la terminal: para eso está el asistente de `/admin/transfer`.', 'Importing mail files: `bloomx transfer import <file>` uploads in hashed, resumable chunks (`--resume`); `transfer download <job> --out` fetches an export. The browser cannot read local files from the terminal: use the `/admin/transfer` wizard for that.'),
    ] });

    // ---- niveles ----
    b.push({ t: 'h2', id: 'permission-levels', text: t('Niveles de permisos (permission_level)', 'Permission levels (permission_level)') });
    b.push({ t: 'p', text: t(
        'El rol de administrador ya no es un sí/no: cada cuenta tiene un **`permission_level` de 0 a 4** (columna `"permission_level"` de la tabla `UserPermission`, el mismo nombre en la API, la CLI y el JSON). El **nivel efectivo** es el **máximo** entre el del entorno y el de la base de datos. Cada ruta, comando y sección del menú declara su nivel mínimo en un único sitio (`src/lib/admin-levels.ts`); la comprobación vive en `requireLevel(n)` (rutas) y en el motor de comandos, de modo que **ocultar un botón nunca es la única barrera** (las rutas responden 403 aunque se llamen directamente). `requireAdmin` equivale a nivel ≥ 3.',
        'The administrator role is no longer yes/no: every account has a **`permission_level` from 0 to 4** (the `"permission_level"` column of the `UserPermission` table, the same name in the API, the CLI and JSON). The **effective level** is the **maximum** of the environment level and the database level. Every route, command and menu section declares its minimum level in a single place (`src/lib/admin-levels.ts`); the check lives in `requireLevel(n)` (routes) and in the command engine, so **hiding a button is never the only barrier** (routes answer 403 even when called directly). `requireAdmin` equals level ≥ 3.',
    ) });
    b.push({ t: 'table', head: [t('Nivel', 'Level'), t('Nombre', 'Name'), t('Qué permite', 'What it allows')], rows: levels.map((x) => [String(x.permission_level), `\`${x.es.name}\``, l === 'es' ? x.es.can : x.en.can]) });
    b.push({ t: 'ul', items: [
        t('**`ADMIN_EMAILS` es semilla y rescate**: esos correos son nivel 4 «fijado por entorno»; la consola y la CLI **no** pueden degradarlos (solo quitándolos de la variable). Compatibilidad total: quien hoy es admin queda en 4. `ADMIN_EMAILS_LOCKED=true` = modo solo-entorno (la gestión por consola/CLI se desactiva: nivel 4 si está en el entorno, 0 si no). La manager dueña del dominio se trata como nivel 4 en su instancia.', '**`ADMIN_EMAILS` is the seed and rescue**: those emails are level 4 "fixed by environment"; the console and CLI **cannot** demote them (only by removing them from the variable). Fully backwards compatible: whoever is an admin today stays at 4. `ADMIN_EMAILS_LOCKED=true` = environment-only mode (console/CLI management is disabled: level 4 if in the environment, 0 otherwise). The domain-owner manager is treated as level 4 on its instance.'),
        t('**Quién asigna qué**: solo un nivel **estrictamente menor al propio** (un superadmin asigna 0-4; conceder el 4 exige confirmación explícita `--confirm-super`). Nadie modifica a alguien de nivel igual o superior (un superadmin sí puede revocar a otro superadmin de consola, nunca al del entorno) **ni a sí mismo**: nadie se auto-escala ni se auto-degrada, y la instancia nunca se queda sin superadmin.', '**Who assigns what**: only a level **strictly lower than your own** (a super admin assigns 0-4; granting 4 needs the explicit `--confirm-super`). Nobody modifies an account at or above their level (a super admin may revoke another console-granted super admin, never an environment one) **nor themselves**: nobody self-escalates or self-demotes, and the instance is never left without a super admin.'),
        t('**Cada cambio** exige **step-up con MFA** (un código TOTP reciente; la manager usa su contraseña), exige que la cuenta exista y tenga MFA (o que el MFA sea obligatorio y se enrole en su primer acceso), respeta un máximo de 25 cuentas con nivel ≥ 3, tiene rate limit, se **audita** (`admin.permissions.changed`: quién, a quién, nivel anterior → nuevo, IP; historial inmutable en `UserPermissionHistory`) y avisa por correo a la cuenta y a los superadmins. Los cambios aplican a las sesiones abiertas en ≤ 30 s y **bajar o quitar el nivel invalida de inmediato sus tokens de CLI** (a nivel 0 también su sesión privilegiada).', '**Every change** needs an **MFA step-up** (a recent TOTP code; the manager uses their password), requires the account to exist and have MFA (or MFA to be mandatory and enrolled at first access), respects a maximum of 25 accounts at level ≥ 3, is rate limited, is **audited** (`admin.permissions.changed`: who, whom, previous → new level, IP; immutable history in `UserPermissionHistory`) and notifies the account and the super admins by email. Changes apply to open sessions within ≤ 30 s and **lowering or removing the level immediately invalidates their CLI tokens** (at level 0 also their privileged session).'),
        t('**Acciones sobre otras cuentas** (deshabilitar, restablecer, cuotas, sesiones, desvincular...): el actor debe tener un nivel mayor que el de la cuenta objetivo (`cannot_modify_peer_or_higher`).', '**Actions on other accounts** (disable, reset, quotas, sessions, unlink...): the actor must have a higher level than the target account (`cannot_modify_peer_or_higher`).'),
        t('**Menú y vistas**: el menú oculta lo que tu nivel no permite; la vista **Permisos** (`/admin/permissions`) muestra la escala, las cuentas con nivel ≥ 1 (origen entorno/consola, quién lo concedió y cuándo), el selector «Asignar nivel» con step-up y el historial; la ficha de usuario muestra «Nivel de permisos: N · nombre» con un selector de solo los niveles que puedes asignar.', '**Menu and views**: the menu hides what your level does not allow; the **Permissions** view (`/admin/permissions`) shows the scale, accounts with level ≥ 1 (environment/console source, who granted it and when), the "Set level" selector with step-up and the history; the user detail shows "Permission level: N · name" with a selector listing only the levels you can assign.'),
        t('**Tokens de CLI**: heredan el nivel de la cuenta como **tope** (nunca más; si la cuenta baja, el token baja) y además tienen su ámbito: `read` desde el nivel 1, `write` y `security` desde el 2 (los comandos de seguridad siguen exigiendo su propio nivel).', '**CLI tokens**: inherit the account level as a **cap** (never more; if the account drops, so does the token) and also have their scope: `read` from level 1, `write` and `security` from 2 (security commands still require their own level).'),
    ] });
    b.push({ t: 'code', lang: 'bash', code: [
        'bloomx perms levels                              # la escala 0-4',
        'bloomx perms list [--json]                       # cuentas con nivel >= 1, origen y estado',
        'bloomx perms set ana@example.com 2 --note "helpdesk"   # step-up con código MFA',
        'bloomx perms set cto@example.com 4 --confirm-super     # conceder superadmin',
        'bloomx perms history --email ana@example.com',
        'bloomx perms unlock ana@example.com              # solo superadmin (ver sesión privilegiada)',
    ].join('\n') });

    // ---- sesion privilegiada ----
    b.push({ t: 'h2', id: 'privileged-session', text: t('Una sola sesión privilegiada', 'A single privileged session') });
    b.push({ t: 'p', text: t(
        'Para toda cuenta con `permission_level` ≥ 1 solo puede haber **una sesión privilegiada abierta a la vez**, contando juntas la **consola web de administración** (`/admin/**`, incluida la consola de comandos) y el **CLI interactivo** (tokens de CLI). No afecta al correo web normal de la cuenta (que conserva sus sesiones habituales mientras no entre al admin).',
        'Every account with `permission_level` ≥ 1 can have only **one privileged session open at a time**, counting together the **web administration console** (`/admin/**`, including the command console) and the **interactive CLI** (CLI tokens). It does not affect the account\'s normal web mail (which keeps its usual sessions as long as it does not enter the admin).',
    ) });
    b.push({ t: 'ul', items: [
        t('**La sesión nueva gana**: en el primer uso de admin de una sesión web (su `jti`) o de un token interactivo que no es el dueño del slot (tabla `PrivilegedSession`, una fila por cuenta), la anterior se **revoca en el acto en servidor** (jti en `RevokedSession` o token revocado) y, al volver a usarse, recibe **401 `superseded`** con un mensaje claro («Tu sesión se cerró porque iniciaste otra desde <dispositivo> (<IP>) a las <hora>»); la web redirige al login y el CLI explica qué hacer. Dos entradas simultáneas se serializan con un candado por cuenta: gana una y la otra queda revocada. Las renovaciones y refrescos conservan el `jti`: **no** son una sesión nueva.', '**The new session wins**: on the first admin use of a web session (its `jti`) or of an interactive token that does not own the slot (`PrivilegedSession` table, one row per account), the previous one is **revoked immediately on the server** (jti in `RevokedSession` or token revoked) and, when used again, gets **401 `superseded`** with a clear message ("Your session was closed because you started another from <device> (<IP>) at <time>"); the web redirects to login and the CLI explains what to do. Two simultaneous entries are serialised with a per-account lock: one wins and the other is revoked. Renewals and refreshes keep the `jti`: they are **not** a new session.'),
        t('**Decisión sobre los tokens**: por defecto **todo token interactivo ocupa el slot, sin excepciones** (también los de solo lectura creados desde la consola web). Los tokens **«machine»** (`tokens create --machine`: cron/CI) son la única clase que no lo ocupa: solo lectura, **24 h por defecto (máx. 7 d)**, nunca nivel 4 (tope 3), acotados por el nivel de la cuenta, emitidos solo con step-up MFA, listados y revocables (`tokens list|revoke`), con **cada uso auditado** e invalidados si la cuenta baja de nivel; respetan el bloqueo de la cuenta.', '**Decision on tokens**: by default **every interactive token takes the slot, with no exceptions** (including read-only ones created from the web console). **"Machine"** tokens (`tokens create --machine`: cron/CI) are the only class that does not: read-only, **24 h by default (max 7 d)**, never level 4 (cap 3), bounded by the account level, issued only with an MFA step-up, listed and revocable (`tokens list|revoke`), with **every use audited** and invalidated if the account level drops; they respect the account lockout.'),
        t('**Aviso al cerrar la anterior**: correo transaccional de la instancia (con la marca del dominio, es/en) y notificación **push PWA** a la cuenta, con qué sesión se cerró (web o CLI), IP, dispositivo, hora y qué hacer si no fuiste tú (cambiar contraseña y cerrar todas las sesiones). Dedupe: como mucho 1 aviso por minuto y cuenta; sin tokens ni datos sensibles. Si el reemplazo viene de una **IP o dispositivo distinto**, el aviso lo destaca y se envía además una alerta inmediata (correo + push) a **todos los superadmins**, con el evento de seguridad `admin.session.superseded.suspicious`.', '**Notice when the previous one is closed**: the instance\'s transactional email (with the domain brand, es/en) and a **PWA push** notification to the account, saying which session was closed (web or CLI), IP, device, time and what to do if it was not you (change password and sign out of all sessions). Dedupe: at most one notice per minute per account; no tokens or sensitive data. If the replacement comes from a **different IP or device**, the notice highlights it and an immediate alert (email + push) is also sent to **all super admins**, with the `admin.session.superseded.suspicious` security event.'),
        t('**Inactividad y tope**: la sesión privilegiada se cierra tras **15 min sin actividad** (configurable por instancia entre 5 y 60: `session policy set --idle-minutes N`, nivel 4 con MFA) y tiene un **tope absoluto de 12 h**; el siguiente uso recibe **401 `expired`** (distinto de `superseded`). Los sondeos de estado de la cabecera no cuentan como actividad. La web revalida al volver a la pestaña, así que lo detecta al instante y redirige al login con el mensaje.', '**Inactivity and cap**: the privileged session closes after **15 min without activity** (configurable per instance between 5 and 60: `session policy set --idle-minutes N`, level 4 with MFA) and has an **absolute 12 h cap**; the next use gets **401 `expired`** (different from `superseded`). The header\'s status polling does not count as activity. The web re-validates when you return to the tab, so it detects it immediately and redirects to login with the message.'),
        t('**«Pelea de sesiones»**: **3 reemplazos en 10 min** (umbral y ventana configurables con `session policy set --lock-threshold/--lock-window`) **bloquean** el acceso privilegiado de la cuenta (web y CLI, también los tokens machine; el correo web normal no se toca) hasta que un **superadmin** la desbloquee (`perms unlock <correo>` o el botón de la vista Permisos, con step-up MFA). Al bloquear: correo + push al afectado (qué pasó y qué hacer), alerta a los demás superadmins y evento `admin.session.lockout`. **Rescate**: si queda bloqueado el único superadmin, define `ADMIN_LOCKOUT_RESET=<correo>` en el entorno, vuelve a desplegar, accede (el bloqueo se levanta) y **quita la variable**; con una manager dueña del dominio también hay desbloqueo desde su consola.', '**"Session fight"**: **3 replacements within 10 min** (threshold and window configurable with `session policy set --lock-threshold/--lock-window`) **lock** the account\'s privileged access (web and CLI, machine tokens too; normal web mail is untouched) until a **super admin** unlocks it (`perms unlock <email>` or the Permissions view button, with an MFA step-up). On lock: email + push to the affected account (what happened and what to do), an alert to the other super admins and the `admin.session.lockout` event. **Rescue**: if the only super admin gets locked, set `ADMIN_LOCKOUT_RESET=<email>` in the environment, redeploy, sign in (the lock is lifted) and **remove the variable**; a domain-owner manager can also unlock from its console.'),
        t('Los **cierres normales** (logout, «Cerrar sesión privilegiada», `bloomx logout`, caducidad) liberan el slot; bajar a nivel 0 revoca la sesión privilegiada. Las managers dueñas del dominio usan una cookie del backend compartido que esta instancia no puede revocar: el slot aplica a sus tokens de CLI, no a su sesión web de manager. La vista **Permisos** y «Mi perfil» muestran tu sesión privilegiada (dónde, desde cuándo, cuándo caduca) con el botón **Cerrar sesión privilegiada** (`session show` / `session close`).', '**Normal closures** (logout, "Close privileged session", `bloomx logout`, expiry) free the slot; dropping to level 0 revokes the privileged session. Domain-owner managers use a shared-backend cookie that this instance cannot revoke: the slot applies to their CLI tokens, not to their manager web session. The **Permissions** view and "My profile" show your privileged session (where, since when, when it expires) with the **Close privileged session** button (`session show` / `session close`).'),
    ] });
    b.push({ t: 'table', head: [t('Control', 'Control'), t('Referencia', 'Reference')], rows: [
        [t('Una sesión privilegiada por cuenta, el reemplazo revoca', 'One privileged session per account, replacement revokes'), 'NIST AC-10, ASVS V3.3, ISO 27001 A.8.5'],
        [t('Inactividad 15 min y tope de 12 h', 'Idle 15 min and 12 h cap'), 'NIST AC-11 / AC-12, ASVS V3.3.2, CIS 5.x'],
        [t('Niveles 0-4, mínimo privilegio, sin auto-escalada', 'Levels 0-4, least privilege, no self-escalation'), 'NIST AC-6 / AC-5, ASVS V4, ISO 27001 A.5.15 / A.8.2, CIS 6.8'],
        [t('Step-up MFA para cambios críticos', 'MFA step-up for critical changes'), 'NIST IA-2(1) / IA-11, ASVS V2.8, CIS 6.5'],
        [t('Auditoría de cada comando y cambio, avisos al titular y a superadmins', 'Audit of every command and change, notices to the owner and super admins'), 'NIST AU-2 / AU-3 / AU-6, ISO 27001 A.8.15'],
        [t('Bloqueo ante peleas de sesión', 'Lockout on session fights'), 'NIST AC-7 / SI-4, ASVS V3.3'],
    ] });

    // ---- seguridad ----
    b.push({ t: 'h2', id: 'security', text: t('Seguridad del motor', 'Engine security') });
    b.push({ t: 'ul', items: [
        t('**Solo administradores**: la consola web usa la cookie de admin (con la cabecera `X-Requested-With` como defensa CSRF adicional); la CLI usa **tokens** `Authorization: Bearer bxa_...`. Cualquier otro caso es 401/403 (falla cerrado); el rol del token se revalida en **cada** petición.', '**Administrators only**: the web console uses the admin cookie (with the `X-Requested-With` header as an extra CSRF defence); the CLI uses **tokens** `Authorization: Bearer bxa_...`. Anything else is 401/403 (fail closed); the token\'s role is re-validated on **every** request.'),
        t('**Sin ejecución arbitraria**: el analizador de línea (comillas y escapes) **no es un shell** (sin variables, pipes, globbing ni sustitución) y nunca ejecuta comandos del sistema; no lee archivos del servidor y los comandos **nunca** devuelven variables de entorno ni claves privadas (`config get` solo muestra una lista blanca y los secretos solo indican si existen).', '**No arbitrary execution**: the line parser (quotes and escapes) **is not a shell** (no variables, pipes, globbing or substitution) and never runs system commands; it does not read server files and commands **never** return environment variables or private keys (`config get` only shows an allow-list and secrets only report presence).'),
        t(`**Límites**: línea de ${limits.maxLineBytes / 1024} KB, entrada de ${limits.maxInputBytes / 1024} KB, salida de ${limits.maxOutputBytes / 1024 / 1024} MB, ${limits.timeoutMs / 1000} s por comando síncrono y ${limits.perMinute} comandos/min por administrador (límite asíncrono, Redis si está configurado) más un límite por IP.`, `**Limits**: ${limits.maxLineBytes / 1024} KB line, ${limits.maxInputBytes / 1024} KB input, ${limits.maxOutputBytes / 1024 / 1024} MB output, ${limits.timeoutMs / 1000} s per synchronous command and ${limits.perMinute} commands/min per administrator (async limiter, Redis if configured) plus a per-IP limit.`),
        t('**Riesgo, confirmación y step-up**: cada comando es `read`, `write`, `destructive` o `security`. Los `destructive` y `security` exigen **confirmación explícita** (`--yes` o un `y` interactivo) **y step-up** (contraseña, código MFA o de recuperación; prueba HMAC de 10 min atada a tu cuenta; los de permisos y tokens exigen un **código MFA**).', '**Risk, confirmation and step-up**: every command is `read`, `write`, `destructive` or `security`. `destructive` and `security` ones require **explicit confirmation** (`--yes` or an interactive `y`) **and a step-up** (password, MFA code or recovery code; a 10-minute HMAC proof tied to your account; permission and token commands require an **MFA code**).'),
        t('**Auditoría**: cada comando ejecutado (y cada rechazo) se registra con el sistema de auditoría existente (usuario, **comando saneado**, riesgo, resultado, IP, agente, token por su id corto). Se redactan banderas y valores sensibles (contraseñas, tokens, claves, volcados JSON/CSV): nunca se registran. Se consulta con `bloomx audit --event "admin.cli.*"`.', '**Audit**: every executed command (and every rejection) is recorded with the existing audit system (user, **sanitised command**, risk, result, IP, agent, token by its short id). Sensitive flags and values (passwords, tokens, keys, JSON/CSV dumps) are redacted: they are never recorded. Query it with `bloomx audit --event "admin.cli.*"`.'),
        t('**Aislamiento**: funciona en cualquier instancia (nada fijado a un dominio) y no usa secretos globales del backend compartido; los tokens y los niveles son por instancia.', '**Isolation**: it works on any instance (nothing hard-coded to a domain) and uses no global secrets of the shared backend; tokens and levels are per instance.'),
    ] });

    // ---- tokens ----
    b.push({ t: 'h2', id: 'tokens', text: t('Tokens de CLI', 'CLI tokens') });
    b.push({ t: 'p', text: t(
        'Se emiten tras iniciar sesión con contraseña y MFA, o desde la consola web con `tokens create --name mi-equipo`. En la base de datos solo vive el **SHA-256** (tabla `AdminCliToken`); el valor se muestra **una sola vez**. Tienen nombre, **ámbitos** (`read`, `write`, `security`), **caducidad** (12 h por defecto, 30 d máximo), última IP/uso y se revocan al instante (`tokens list`, `tokens revoke <id>`, `tokens revoke-all`, `bloomx logout`). Máximo 10 activos por cuenta. Los de una manager guardan su cookie de sesión del backend **cifrada** para que los comandos que hablan con el backend funcionen igual que en la web.',
        'They are issued after logging in with password and MFA, or from the web console with `tokens create --name my-machine`. Only the **SHA-256** lives in the database (`AdminCliToken` table); the value is shown **once**. They have a name, **scopes** (`read`, `write`, `security`), **expiry** (12 h default, 30 d maximum), last IP/use and are revoked instantly (`tokens list`, `tokens revoke <id>`, `tokens revoke-all`, `bloomx logout`). At most 10 active per account. A manager\'s tokens store its backend session cookie **encrypted** so commands that talk to the backend work like on the web.',
    ) });
    b.push({ t: 'table', head: [t('Ámbito', 'Scope'), t('Permite', 'Allows'), t('Nivel mínimo', 'Minimum level')], rows: [
        ['`read`', t('comandos `read`', '`read` commands'), '1'],
        ['`write`', t('`read` + `write` y `destructive`', '`read` + `write` and `destructive`'), '2'],
        ['`security`', t('todo (los comandos `security` exigen además step-up y su propio nivel)', 'everything (`security` commands also require step-up and their own level)'), '2'],
    ] });

    // ---- comandos ----
    b.push({ t: 'h2', id: 'commands', text: t('Comandos por categoría', 'Commands by category') });
    b.push({ t: 'p', text: t(
        `Generado del catálogo real (${commands.length} comandos). Cada uno tiene descripción es/en, **nivel mínimo**, riesgo y permisos; \`bloomx help <comando>\` muestra sus argumentos y banderas. Globales: \`--json\`, \`--yes\`/\`-y\`, \`--help\`. Los comandos de este catálogo cubren todas las acciones de las vistas del admin (ver [cobertura](#coverage)).`,
        `Generated from the real catalogue (${commands.length} commands). Each has an es/en description, a **minimum level**, a risk and permissions; \`bloomx help <command>\` shows its arguments and flags. Globals: \`--json\`, \`--yes\`/\`-y\`, \`--help\`. The commands in this catalogue cover every action of the admin views (see [coverage](#coverage)).`,
    ) });
    for (const g of categories()) {
        b.push({ t: 'h3', id: `cmds-${g.key}`, text: l === 'es' ? g.es : g.en });
        b.push({ t: 'table', head: [t('Comando', 'Command'), t('Nivel', 'Level'), t('Riesgo', 'Risk'), t('Descripción', 'Description')], rows: g.cmds.map((c) => [`\`${c.name}\``, `≥ ${c.minLevel}`, riskText(c.risk) + (c.mfaStepUp ? ' + MFA' : '') + (c.managerOnly ? ` (${t('manager', 'manager')})` : ''), l === 'es' ? c.summary.es : c.summary.en]) });
    }

    // ---- cobertura ----
    b.push({ t: 'h2', id: 'coverage', text: t('Cobertura de la consola gráfica', 'Coverage of the graphical console') });
    b.push({ t: 'p', text: t(
        'Un test comprueba que **cada ruta `/api/admin/**`** está cubierta por un comando o excluida con un motivo técnico concreto. Excluidas:',
        'A test verifies that **every `/api/admin/**` route** is covered by a command or excluded with a concrete technical reason. Excluded:',
    ) });
    b.push({ t: 'table', head: [t('Ruta', 'Route'), t('Motivo y equivalente', 'Reason and equivalent')], rows: Object.entries(excluded).map(([k, v]) => [`\`${k}\``, l === 'es' ? v.es : v.en]) });

    // ---- ssh ----
    b.push({ t: 'h2', id: 'ssh', text: t('SSH real (opcional, no implementado)', 'Real SSH (optional, not implemented)') });
    b.push({ t: 'p', text: t(
        'Si necesitas el protocolo SSH de verdad, la opción es una **pasarela** en un VPS (o contenedor) con el puerto 22 abierto que **proxea a esta API**: nunca expone el shell del sistema, solo traduce SSH a llamadas HTTPS autenticadas.',
        'If you need the real SSH protocol, the option is a **gateway** on a VPS (or container) with port 22 open that **proxies to this API**: it never exposes the system shell, it only translates SSH into authenticated HTTPS calls.',
    ) });
    b.push({ t: 'ol', items: [
        t('Servidor SSH con [`ssh2`](https://github.com/mscdex/ssh2) en el VPS: solo autenticación por **clave pública** (sin contraseñas), una clave por administrador, asociada a su cuenta y a un **token de CLI** guardado en el almacén del gateway (cifrado).', 'SSH server with [`ssh2`](https://github.com/mscdex/ssh2) on the VPS: **public-key** authentication only (no passwords), one key per administrator, tied to their account and to a **CLI token** kept in the gateway\'s (encrypted) store.'),
        t('Cada sesión abre un **pseudo-terminal** que ejecuta el REPL de `bloomx` en proceso (sin `/bin/sh`): cada línea se envía a `POST /api/admin/cli/exec` con el token del administrador; el autocompletado usa `GET /api/admin/cli/complete`.', 'Each session opens a **pseudo-terminal** running the `bloomx` REPL in-process (no `/bin/sh`): each line is sent to `POST /api/admin/cli/exec` with the administrator\'s token; completion uses `GET /api/admin/cli/complete`.'),
        t('Hereda **todas** las garantías del servidor (niveles, ámbitos, step-up, auditoría, slot único de sesión privilegiada, inactividad): el gateway no decide nada. El step-up se pide en el terminal y se reenvía a `POST /api/admin/cli/reauth`.', 'It inherits **all** the server guarantees (levels, scopes, step-up, audit, single privileged-session slot, inactivity): the gateway decides nothing. The step-up is asked in the terminal and forwarded to `POST /api/admin/cli/reauth`.'),
        t('Endurecimiento: `ForceCommand`/shell fijo, sin reenvío de puertos ni de agente, límites de conexiones por IP, `fail2ban`, registros enviados a tu SIEM y rotación de tokens (el slot único cierra el anterior al reconectar).', 'Hardening: fixed `ForceCommand`/shell, no port or agent forwarding, per-IP connection limits, `fail2ban`, logs sent to your SIEM and token rotation (the single slot closes the previous one on reconnect).'),
    ] });
    b.push({ t: 'code', lang: 'javascript', title: t('Esqueleto de la pasarela (ilustrativo)', 'Gateway skeleton (illustrative)'), code: [
        "import { Server } from 'ssh2';",
        "import { readFileSync } from 'node:fs';",
        '',
        "const API = process.env.BLOOMX_URL; // https://mail.example.com",
        'const keys = loadAuthorizedKeys();   // { publicKey -> { email, token } } (token en un almacén cifrado)',
        '',
        "new Server({ hostKeys: [readFileSync('/etc/bloomx-gw/host_ed25519')] }, (client) => {",
        "  client.on('authentication', (ctx) => {",
        "    const entry = ctx.method === 'publickey' && keys.match(ctx.key);",
        "    entry ? ((client.entry = entry), ctx.accept()) : ctx.reject(['publickey']);",
        '  });',
        "  client.on('session', (accept) => {",
        '    const session = accept();',
        "    session.on('pty', (a) => a()).on('shell', (a) => {",
        '      const stream = a();',
        '      runBloomxRepl(stream, async (line) => {',
        "        const res = await fetch(`${API}/api/admin/cli/exec`, {",
        "          method: 'POST',",
        "          headers: { Authorization: `Bearer ${client.entry.token}`, 'Content-Type': 'application/json' },",
        "          body: JSON.stringify({ line }),",
        '        });',
        '        return res.json();   // { output, text, needs, ... } -> se imprime en el terminal',
        '      });',
        '    });',
        '  });',
        "}).listen(22, '0.0.0.0');",
    ].join('\n') });

    // ---- api ----
    b.push({ t: 'h2', id: 'api', text: t('API', 'API') });
    b.push({ t: 'table', head: [t('Endpoint', 'Endpoint'), t('Descripción', 'Description')], rows: [
        ['`POST /api/admin/cli/login`', t('Público (con rate limit): correo, contraseña y código MFA → token. Solo emite a administradores de esta instancia.', 'Public (rate limited): email, password and MFA code → token. Only issues to administrators of this instance.')],
        ['`POST /api/admin/cli/exec`', t('`{ line }` o `{ argv }` (+ `input`, `confirm`, `stepUp`, `locale`) → `{ ok, exitCode, output, text|json, needs }`.', '`{ line }` or `{ argv }` (+ `input`, `confirm`, `stepUp`, `locale`) → `{ ok, exitCode, output, text|json, needs }`.')],
        ['`GET /api/admin/cli/complete?line=`', t('Autocompletado (comandos, banderas, valores, usuarios, extensiones).', 'Completion (commands, flags, values, users, extensions).')],
        ['`GET /api/admin/cli/commands`', t('Catálogo (sin handlers) para `help` y la documentación.', 'Catalogue (without handlers) for `help` and the documentation.')],
        ['`POST /api/admin/cli/reauth`', t('Step-up: `{ password }` o `{ code }` → prueba `stepUp` de 10 min.', 'Step-up: `{ password }` or `{ code }` → a 10-minute `stepUp` proof.')],
        ['`POST /api/admin/cli/logout`', t('Revoca el token que hace la petición y libera el slot.', 'Revokes the requesting token and frees the slot.')],
        ['`PUT|GET /api/admin/cli/transfer/jobs/<id>/…`', t('Transporte binario de importar/exportar (trozos con SHA-256 y descarga firmada).', 'Binary transport for import/export (SHA-256 chunks and signed download).')],
        ['`GET|POST /api/admin/permissions`', t('Niveles de permisos (lista y asignación con step-up MFA); `/history` y `/unlock`.', 'Permission levels (list and assignment with MFA step-up); `/history` and `/unlock`.')],
        ['`GET|DELETE|PUT /api/admin/privileged-session`', t('Tu sesión privilegiada (estado, cierre) y la política de la instancia.', 'Your privileged session (state, close) and the instance policy.')],
    ] });
    b.push({ t: 'code', lang: 'bash', code: [
        'curl -s https://mail.example.com/api/admin/cli/exec \\',
        '  -H "Authorization: Bearer $BLOOMX_TOKEN" -H "Content-Type: application/json" \\',
        "  -d '{\"argv\":[\"users\",\"list\",\"--json\"]}'",
    ].join('\n') });

    return b;
}

const page: DocPageContent = { es: build('es'), en: build('en') };
export default page;
