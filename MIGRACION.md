# FullGuia · Pasar todo a las cuentas del cliente

Cuando Edi apruebe la demo, todo pasa a **sus** cuentas: Supabase (base de datos), GitHub (código) y Hostinger (su dominio).
**Edi no necesita instalar nada**: solo crea sus cuentas, acepta invitaciones y usa su panel `/admin`. Todos los comandos los ejecuta el desarrollador.

Tiempo estimado: 1 a 2 horas. Hazlo en un horario de poco tráfico.

---

## Paso 0 · Lo que Edi hace (una sola vez)

1. Crear cuenta en **https://supabase.com** (con su correo) y una organización (plan gratis).
   - En la organización: **Team → Invite** → el correo del desarrollador con rol **Owner**.
2. Crear cuenta en **https://github.com** y decirle al desarrollador su **usuario de GitHub**.
3. Darle al desarrollador acceso a **hPanel de Hostinger** (o hacer él mismo el paso 3 siguiendo esta guía).
4. Decir el **número de WhatsApp** de FullGuia para "Publica tu negocio" (celular de Colombia).

---

## Paso 1 · Base de datos (Supabase)

### Opción A (recomendada): transferir el proyecto
No cambia nada: misma URL, mismas llaves, mismos datos y fotos. `config.js` **no** se toca.

1. Aceptar la invitación de Edi (llega al correo del desarrollador).
2. Supabase → proyecto `biajiyiyjtqocqrabrnu` → **Project Settings → General → Transfer project** → elegir la organización de Edi → confirmar.
3. Comprobar: `node qa/qa.js --solo=rls,busqueda` → 0 fallos.
4. Edi puede quitar al desarrollador de su organización cuando quiera (Team → ⋯ → Remove).

> Si Supabase no deja transferir (por ejemplo, la organización de Edi ya tiene 2 proyectos gratis), usa la opción B.

### Opción B (plan B): recrear desde cero en la cuenta de Edi
Todo lo necesario está en `supabase/migrations/` y `scripts/`.

1. En la organización de Edi: **New project** (región *East US* o la más cercana a Colombia). Anota el **ref** y la **contraseña de la base**.
2. En `.env` cambia `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_HOST`, `SUPABASE_DB_USER` por los del proyecto nuevo (la publishable key: `npx supabase projects api-keys --project-ref <ref>`).
3. Base de datos y función:
   ```
   npx supabase link --project-ref <ref-nuevo>
   npx supabase db push --remote --password "<contraseña>"
   npx supabase functions deploy usuarios --use-api
   npx supabase functions deploy youtube --use-api
   ```
4. Auth (Dashboard → Authentication): desactivar *Allow new users to sign up*, contraseña mínima **10**, *Site URL* `https://fullguia.com/admin/`, *Redirect URLs* `https://fullguia.com/**`.
5. Fotos: copiar del proyecto viejo al nuevo (las llaves secretas solo como variables de entorno, en la misma línea):
   ```
   FG_ORIGEN_URL=https://biajiyiyjtqocqrabrnu.supabase.co FG_ORIGEN_SECRET=<secret viejo> \
   FG_DESTINO_URL=https://<ref-nuevo>.supabase.co FG_DESTINO_SECRET=<secret nuevo> \
   node scripts/subir-fotos.js copiar
   ```
   (También sirve `respaldar <carpeta>` y después `restaurar <carpeta>`.)
6. Negocios, categorías y ofertas (conserva todo tal cual; las cadenas de conexión están en Supabase → *Connect → Session pooler*):
   ```
   FG_ORIGEN_DB="postgresql://postgres.biajiyiyjtqocqrabrnu:<contraseña>@aws-1-us-east-1.pooler.supabase.com:5432/postgres" \
   FG_DESTINO_DB="postgresql://postgres.<ref-nuevo>:<contraseña>@<host-nuevo>:5432/postgres" \
   NODE_PATH=qa/node_modules node scripts/copiar-datos.js
   ```
   (Con `--sin-demo` no copia los negocios ni los videos de ejemplo. La galería de videos se copia junto con lo demás.) Hazlo **antes** del paso 5 o después, da igual: las fotos y los datos usan las mismas rutas.
7. Usuarios: `node scripts/crear-usuario.js videosait.2026@gmail.com admin` (muestra la contraseña una vez) y los editores que hagan falta desde el panel → Usuarios.
8. `public/js/config.js`: cambiar `SUPABASE_URL` y `SUPABASE_KEY` por los nuevos. Hacer commit y push.
9. Comprobar: `node qa/qa.js` → 0 fallos (crea primero los 3 usuarios de prueba del QA con `scripts/crear-usuario.js` y sus contraseñas en `.env`).

---

## Paso 2 · Código (GitHub)

1. GitHub → repo `FERPAUL/fullguia` → **Settings → General → Danger Zone → Transfer ownership** → escribir el usuario de Edi → confirmar.
2. Edi acepta la transferencia (le llega un correo de GitHub).
3. En el repo ya transferido (puede hacerlo el desarrollador si Edi lo agrega como colaborador en *Settings → Collaborators*):
   - **Actions** → si aparece "Workflows aren't being run on this repository", pulsar **Enable**.
   - **Actions → Mantener Supabase activo → Enable workflow** (si está desactivado) → **Run workflow** → debe quedar en verde ✔.
   - (Opcional, solo si quieren seguir usando la demo) **Settings → Pages → Source: GitHub Actions**.
4. En el computador del desarrollador: `git remote set-url origin https://github.com/<usuario-de-edi>/fullguia.git`

---

## Paso 3 · Sitio en Hostinger con su dominio

El repositorio se publica completo en `public_html`; el archivo **`.htaccess`** de la raíz hace que solo se vea la carpeta `public/` (el resto queda bloqueado).

1. **Respaldar** lo que hay hoy en `public_html` (hPanel → Archivos → Administrador de archivos → seleccionar todo → Comprimir → Descargar). Hostinger exige la carpeta **vacía** para conectar Git: después del respaldo, borrar su contenido.
2. hPanel → **Sitios web → fullguia.com → Avanzado → GIT**:
   - *Repositorio*: `https://github.com/<usuario-de-edi>/fullguia.git`
   - *Rama*: `main`
   - *Directorio*: dejar vacío (= `public_html`)
   - **Crear** y luego **Desplegar**.
   - Si el repo es **privado**: hPanel muestra una clave SSH → GitHub → repo → *Settings → Deploy keys → Add* (solo lectura) y usar la dirección `git@github.com:<usuario-de-edi>/fullguia.git`.
3. **Despliegue automático** (cada push publica): en la misma pantalla, **Auto Deployment** → copiar la URL del webhook → GitHub → repo → *Settings → Webhooks → Add webhook* → pegar en *Payload URL* → *Add webhook*.
4. Comprobar en el navegador: `https://fullguia.com/` (sitio), `https://fullguia.com/admin/` (panel) y que `https://fullguia.com/supabase/` y `https://fullguia.com/.env` **no** abran nada.
5. Supabase → Authentication → URL Configuration: *Site URL* `https://fullguia.com/admin/` y *Redirect URLs* `https://fullguia.com/**` (para "Olvidé mi contraseña").

### Respaldo del anti-pausa en Hostinger (recomendado)
hPanel → **Avanzado → Cron Jobs** → *Personalizado*, cada 2 días (`0 8 */2 * *`), comando:
```
curl -s "https://<ref>.supabase.co/rest/v1/rpc/version_datos?apikey=<publishable key>" > /dev/null
```
Así, si GitHub Actions fallara, Supabase igual recibe una consulta real cada 2 días.

---

## Paso 4 · Ajustes finales

1. `public/js/config.js` → `WHATSAPP_FULLGUIA: '57XXXXXXXXXX'` (número de Edi) → commit y push.
2. Panel → **Configuración → Borrar datos demo** cuando ya estén cargados los negocios reales.
3. Panel → **Usuarios**: eliminar `qa-admin@fullguia.test`, `qa-editor@fullguia.test`; y en Supabase → Authentication → Users eliminar `qa-noadmin@fullguia.test`. (Si se quiere seguir corriendo el QA contra producción, no borrarlos.)
4. Cambiar la contraseña del administrador: panel → avatar → **Mi cuenta → Cambiar contraseña**.
5. Si el desarrollador ya no debe tener acceso: quitarlo de la organización de Supabase, de los colaboradores de GitHub y de hPanel.

## Lista de verificación

- [ ] `https://fullguia.com/` muestra los negocios y el buscador encuentra "cucuta" sin tilde
- [ ] `https://fullguia.com/admin/` entra con el correo del administrador
- [ ] Crear, editar y borrar un negocio de prueba desde el panel (con foto)
- [ ] GitHub → Actions → *Mantener Supabase activo* en verde
- [ ] Cron de respaldo creado en hPanel
- [ ] Un push a `main` se ve publicado en fullguia.com en menos de 1 minuto
- [ ] `node qa/qa.js` → 0 fallos (con el `.env` del proyecto final)
