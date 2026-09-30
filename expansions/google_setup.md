# Configuración de Google OAuth para Bloomx

Para permitir que los usuarios inicien sesión con Google y usen integraciones como **Google Drive** y **Google Calendar**, necesitas configurar un proyecto en Google Cloud Platform.

## 1. Crear Proyecto en Google Cloud

1. Ve a [Google Cloud Console](https://console.cloud.google.com/).
2. Crea un nuevo proyecto (ej. "Bloomx Dev").
3. Selecciona el proyecto.

## 2. Configurar Pantalla de Consentimiento (OAuth Consent Screen)

1. Ve a **APIs & Services** > **OAuth consent screen**.
2. Selecciona **External** (Externo) y haz clic en **Create**.
3. Llena la información básica:
   - **App name**: Bloomx
   - **User support email**: Tu correo.
   - **Developer contact information**: Tu correo.
4. Haz clic en **Save and Continue**.
5. **Scopes (Alcances)**:
   - Haz clic en **Add or Remove Scopes**.
   - Busca y selecciona los alcances que BloomX solicita (`src/app/api/auth/google/route.ts`):
     - `openid`, `.../auth/userinfo.email` y `.../auth/userinfo.profile` (inicio de sesión)
     - `.../auth/drive.readonly` (leer archivos de Drive)
     - `.../auth/calendar` (calendarios y eventos)
     - `.../auth/contacts.readonly` (sincronizar contactos)
     - `.../auth/meetings.space.created` (crear salas de Google Meet)
   - La autorización pide acceso sin conexión (`access_type=offline`, `prompt=consent`): se guarda un *refresh token*, **cifrado** en la tabla `Account`.
   - Haz clic en **Update** y luego **Save and Continue**.
6. **Test Users (Usuarios de prueba)**:
   - Agrega tu propio correo de gmail para poder probar.
   - **Save and Continue**.

## 3. Crear Credenciales (OAuth Client ID)

1. Ve a **APIs & Services** > **Credentials**.
2. Haz clic en **+ CREATE CREDENTIALS** > **OAuth client ID**.
3. **Application type**: Web application.
4. **Name**: Bloomx Local.
5. **Authorized JavaScript origins** (Orígenes autorizados):
   - Agrega: `http://localhost:3000`
   *(Nota: No uses trailing slash / al final)*
6. **Authorized redirect URIs** (URIs de redireccionamiento):
   - Agrega: `http://localhost:3000/api/auth/callback/google`
   *(Esta es la ruta "mágica" que maneja NextAuth automáticamente)*.
7. Haz clic en **Create**.

## 4. Configurar Variables de Entorno (.env)

Copia el **Client ID** y **Client Secret** que te muestra Google y añádelos a tu archivo `.env` en la raíz del proyecto Bloomx:

```env
# Google Auth
GOOGLE_CLIENT_ID=tuid....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=tusecreto...

# NextAuth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=cambia_esto_por_un_string_largo_y_seguro
```

## 5. Habilitar APIs

Para que Drive, Calendar, contactos y Meet funcionen, debes habilitar sus APIs explícitamente:

1. Ve a **APIs & Services** > **Library**.
2. Busca **"Google Drive API"** y haz clic en **Enable**.
3. Busca **"Google Calendar API"** y haz clic en **Enable**.
4. Busca **"People API"** (contactos) y **"Google Meet REST API"** y habilítalas.

## 6. Probar

1. Reinicia tu servidor (`npm run dev`).
2. Ve a Bloomx y abre la expansión de Google Drive (clip).
3. Si no has iniciado sesión, verás el botón "Sign In with Google".
4. Al hacer clic, te llevará a Google, te pedirá permisos y volverá a Bloomx.

---

**Nota sobre Producción**: Cuando despliegues a producción (Vercel, etc.), deberás agregar la URL de producción a los orígenes y redirects en la consola de Google (ej. `https://tu-app.vercel.app/api/auth/callback/google`).

**Notas de seguridad**: el inicio de sesión con Google **no** exige TOTP a un usuario que activó MFA voluntariamente (sí lo bloquea si MFA es obligatorio para su correo). Revocar los permisos de la app en la cuenta de Google es la forma de invalidar el *refresh token*.

Ver también la documentación de la app: `/docs/env-variables` (grupo OAuth) y `/docs/security#limits`.
