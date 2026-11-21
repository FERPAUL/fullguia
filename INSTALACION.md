# FullGuia · Cómo está montado

Directorio comercial de FullGuia.com: sitio público, panel de administración y base de datos.
Es un sitio estático que habla directo con Supabase, **sin servidor propio**: cuesta $0 y no hay nada que mantener.

```
Visitante ──(GET, llave pública)──▶ Supabase: funciones RPC  ─┐
Panel /admin ──(supabase-js)──────▶ Auth + tablas + Storage    ├─▶ Postgres con RLS (reglas de seguridad)
Panel (usuarios) ─────────────────▶ Edge Function "usuarios"   │
Panel (canales de YouTube) ────────▶ Edge Function "youtube"    │
GitHub Action cada 2 días ────────▶ consulta real (anti-pausa) ─┘
```

| Pieza | Dónde | Para qué |
|---|---|---|
| Sitio público | `public/index.html`, `categoria.html`, `negocio.html`, `categorias.html` | El diseño de la maqueta, con datos reales |
| Lógica del sitio | `public/js/fullguia.js` + `public/js/config.js` | Buscar, pintar, caché, WhatsApp |
| Panel | `public/admin/` (`app.jsx`, `admin.css`, `cargador.js`, `index.html`) | Negocios, ofertas, categorías, galería de videos, CSV, usuarios, demo |
| Base de datos | `supabase/migrations/*.sql` | Tablas, seguridad, búsqueda, fotos, datos iniciales |
| Edge Function | `supabase/functions/usuarios/index.ts` | Crear / borrar usuarios del panel (necesita la llave secreta) |
| Edge Function | `supabase/functions/youtube/index.ts` | Leer el ID, nombre y foto de un canal de YouTube (`@usuario`) para la galería |
| Pruebas | `qa/qa.js` | Control de calidad completo (debe dar 0 fallos) |
| Despliegue | `.github/workflows/pages.yml`, `.htaccess` | GitHub Pages (demo) y Hostinger (producción) |
| Anti-pausa | `.github/workflows/keepalive.yml` | Supabase gratis se pausa a los 7 días sin uso |

Demo actual: **https://ferpaul.github.io/fullguia/** · Panel: **https://ferpaul.github.io/fullguia/admin/**
Proyecto Supabase de prueba: `biajiyiyjtqocqrabrnu` (cuenta del desarrollador).

---

## 1. Base de datos (Supabase)

Todo lo de la base está en `supabase/migrations/` y se aplica en orden. Con esos archivos se recrea el proyecto desde cero.

| Migración | Qué hace |
|---|---|
| `…01_esquema.sql` | Extensiones (`unaccent`), tablas `categorias`, `negocios`, `ofertas`, `admins`, `meta`; índices; triggers (slug automático, `updated_at`, búsqueda en español sin tildes, versión de datos) |
| `…02_seguridad.sql` | RLS: el público solo lee lo activo y vigente; solo los usuarios de `admins` escriben |
| `…03_rpc.sql` | `pagina_inicio`, `buscar_negocios`, `pagina_negocio`, `version_datos` (una llamada por página) |
| `…04_storage.sql` | Bucket público `negocios` (solo WebP/JPG/PNG, máx. 2 MB); solo admins suben y borran |
| `…05_seed.sql` | 7 categorías y los negocios/ofertas de la maqueta |
| `…06_roles_demo.sql` | Roles `admin` / `editor`, marca `demo`, `cargar_demo()`, `borrar_demo()`, `panel_resumen()`, WhatsApp solo Colombia |
| `…07_endurecer.sql` | Quita a la API el permiso de ejecutar `rls_auto_enable()` (aviso de seguridad de Supabase) |
| `…08_lint.sql` | Corrección menor señalada por `supabase db lint` |
| `…09_fotos_demo.sql` | Fotos demo livianas (mismas metas que las fotos reales) |
| `…10_videos.sql` | Fase 2: tabla `videos` (galería de YouTube del inicio) con RLS, `pagina_inicio()` con los videos, KPI y el video de la maqueta |
| `…11_videos_demo.sql` | 4 videos de ejemplo marcados demo; *Cargar/Borrar datos demo* también los incluye |

**Aplicar migraciones** (con `SUPABASE_ACCESS_TOKEN` y `SUPABASE_DB_PASSWORD` en el entorno o en `.env`):
```
npx supabase link --project-ref <ref>
npx supabase db push --remote --password "<contraseña de la base>"
```

**Edge Functions** (no necesitan Docker):
```
npx supabase functions deploy usuarios --use-api
npx supabase functions deploy youtube --use-api
```

**Configuración de Auth** (ya aplicada en el proyecto de prueba; repetir en un proyecto nuevo):
- Registro público **desactivado** (solo el administrador crea cuentas): Dashboard → Authentication → Sign In / Providers → *Allow new users to sign up* = apagado.
- Contraseña mínima: **10** caracteres.
- *Site URL*: la dirección del panel (ej. `https://fullguia.com/admin/`) y *Redirect URLs*: `https://fullguia.com/**` (y `http://localhost:5173/**` para pruebas). Lo usa "Olvidé mi contraseña".

### Reglas de negocio importantes
- **Destacado vigente** = `plan = 'destacado'` y `destacado_hasta >= hoy` en **hora de Bogotá**. Al vencer, baja solo con los normales; no hay que tocar nada.
- **Orden**: destacados vigentes primero, luego A-Z sin tildes. 20 por página.
- **Búsqueda**: en español, sin tildes, por prefijos ("cucu" encuentra "Cúcuta"), sobre nombre, categoría, etiqueta, ciudad, dirección, comodidades y descripción.
- **WhatsApp**: solo celulares de Colombia, se guarda como `573XXXXXXXXX`.
- **Versión de datos**: cualquier cambio (incluso borrar) sube `meta.version`; el sitio la usa para saber si su caché sigue vigente.

## 2. Usuarios y roles del panel

| Rol | Puede |
|---|---|
| **Administrador** | Todo: negocios, ofertas, fotos, importar CSV, categorías, usuarios, datos demo |
| **Editor** | Negocios, ofertas, fotos e importar CSV. Ve las categorías pero no las cambia |

- Administrador oficial: **videosait.2026@gmail.com**.
- Nuevos usuarios: panel → **Usuarios** → *Nuevo usuario* (si no se escribe contraseña, se genera una y se muestra una vez).
- Desde la consola: `node scripts/crear-usuario.js correo@x.com admin|editor [contraseña] [nombre]` (usa la API oficial de Auth; la llave secreta se pide en el momento y no se guarda).
- Usuarios de prueba del QA: `qa-admin@fullguia.test`, `qa-editor@fullguia.test`, `qa-noadmin@fullguia.test` (sus contraseñas están solo en `.env`). Se borran al pasar a producción.

## 3. Sitio público

- El **diseño no cambió**: el bloque `<style>` de cada página es idéntico a `originales/` (lo verifica el QA).
- Se agregó: buscador en el hero, la galería de videos (ver 3b), un bloque `<style id="fg-estilos">` con estilos de la parte dinámica (igual en las 4 páginas), `<template>` con el marcado de cada tarjeta, y los enlaces reales.
- **Para editar en Dreamweaver**: se puede cambiar libremente textos, colores y estilos del bloque `<style>` principal. **No borrar** los elementos con `id="fg-…"`, los `<template id="tpl-…">`, los atributos `data-f="…"` ni las dos líneas `<script src="js/…" defer>`.
- `public/js/config.js`: URL y **publishable key** de Supabase (son públicas por diseño) y `WHATSAPP_FULLGUIA` (número para "Publica tu negocio"; vacío = lleva a la sección de planes).
- Velocidad: una sola consulta por página (GET simple, sin consulta previa de CORS), caché en el navegador con claves `fg_v1_*` (máx. ~1,5 MB), esqueletos de carga, fotos `lazy` con tamaño fijo y `srcset`.

## 3b. Galería de videos de YouTube (fase 2)

El recuadro de video del inicio es una **galería deslizable**: en el celular se pasa de un video a otro deslizando el dedo **encima del video**; en el computador, con las flechas ‹ ›, los puntos o las teclas ← →. No se cambia de página.

**Cómo se usa (panel → Galería de videos):**
1. **Agregar video** → pegar el enlace de YouTube (en YouTube: *Compartir → Copiar enlace*). El **título y la miniatura se llenan solos**; el título se puede cambiar.
2. Acepta cualquier enlace **público o no listado**: videos, Shorts, transmisiones en vivo (`/live/…`), `youtu.be`, listas de reproducción y **canales** (`/channel/UC…` o `@usuario`). Un canal muestra **su transmisión en vivo actual**, aunque YouTube le cambie el ID (ideal para cámaras 24 h).
3. **Sin límite** de videos. Se ordenan con ↑ ↓; los nuevos van al final. *Visible* apagado = se oculta sin borrarlo.
4. Lo pueden manejar el Administrador y el Editor.

**Cómo se comporta en el sitio:**
- El video del frente **arranca solo y en silencio** (los navegadores no dejan sonar un video antes de que la persona toque la página). Con el **primer toque, clic o tecla** del visitante, **el sonido se activa solo**; el botón *🔊 Silenciar / 🔇 Activar sonido* lo cambia cuando quiera.
- Solo hay **un reproductor a la vez**: al pasar a otro video, el anterior se quita (se corta su audio). Al terminar un video pasa solo al siguiente.
- Se pausa si la galería sale de la pantalla y sigue al volver. Con *ahorro de datos* o *reducir movimiento* activados no hay autoplay: se ve la miniatura con ▶.
- La primera miniatura es la imagen principal de la página y el reproductor se carga después: Lighthouse móvil sigue ≥ 90.
- No se puede mostrar: un video **privado**, uno cuyo dueño **desactivó la inserción** (el panel lo avisa al pegarlo), ni un canal que **no está en vivo** en ese momento (YouTube muestra su aviso).

## 4. Fotos

- El panel acepta JPG, PNG o WebP de hasta 10 MB; corrige la orientación del celular (EXIF) y comprime **en el navegador** antes de subir:
  - foto: **grande** 1200 px (≤ 150 KB) + **mini** 400 px (≤ 30 KB), en WebP;
  - logo: una versión de 200 px (≤ 30 KB).
- En la base solo se guarda la **ruta**. Al reemplazar o borrar, los archivos viejos se borran (sin huérfanos). Si se cancela un formulario, lo subido se borra.
- 2.000 negocios × ~200 KB ≈ 400 MB → caben en el plan gratis (1 GB).
- Respaldo / copia de fotos: `scripts/subir-fotos.js` (ver MIGRACION.md).

## 5. Probar en el computador

```
node scripts/servidor-local.js          → http://localhost:5173/   y   http://localhost:5173/admin/
```
(Se comporta como GitHub Pages/Hostinger: sirve `public/`, comprime con gzip.)

## 6. Control de calidad

```
cd qa && npm install && cd ..
node qa/qa.js                       # todo (≈ 6 minutos)
node qa/qa.js --solo=rls,busqueda   # solo algunos bloques
```
Usa `.env` (credenciales del proyecto), Chrome o Edge instalado, y los `node_modules` de la skill r-script si existen.
Bloques: estático · fidelidad · migraciones (recrea la base desde cero dentro de una transacción que se revierte) · seguridad RLS/Storage/roles · búsqueda · humo del sitio y del panel (jsdom) · carga de 2.000 negocios · imágenes y huérfanos · advisors de Supabase · navegador real + Lighthouse · operación.
Los resultados quedan en `qa/out/` (capturas, informes de Lighthouse, `resultado.json`).

## 7. Publicación y anti-pausa

- **GitHub Pages**: cada `git push` a `main` que toque `public/` publica la demo (`pages.yml`).
- **Hostinger** (producción): despliegue Git de hPanel; el `.htaccess` de la raíz hace que solo se sirva `public/` (ver MIGRACION.md).
- **Anti-pausa** (`keepalive.yml`): cada 2 días hace una consulta real a la base con la llave pública de `config.js`. Si falla, GitHub avisa por correo. También se re-habilita solo para que GitHub no lo apague por inactividad. Se puede correr a mano: pestaña *Actions* → *Mantener Supabase activo* → *Run workflow*.

## 8. Datos demo

Los negocios de la maqueta vienen marcados como **demo**. En el panel → **Configuración**: *Cargar datos demo* (3 por categoría) y *Borrar datos demo* (borra solo los demo, sus ofertas y sus fotos). Los negocios reales no se tocan.

## 9. Archivos que NO van al repositorio

`.env` (credenciales), `qa/node_modules/`, `qa/out/`, `supabase/.temp/`. El QA verifica que ninguna credencial ni llave secreta aparezca en archivos versionados o públicos.
