# FullGuia — Planificación (P)

> Cuando digas "apruebo", copio este documento tal cual a `C:\Users\LENOVO\Desktop\fullguia\PLAN.md` y es lo primero que va al repo.

## Contexto
Edi Ramos (Colombia) tiene la maqueta de FullGuia.com, un directorio comercial que quiere monetizar con planes "Destacado" desde $29.900 COP/mes. Las maquetas `hoteles.html` e `index (6).html` son **solo frontend**: los datos, la lógica de negocio, la seguridad, el panel admin y la conexión los construyo yo. El diseño público no cambia, porque el cliente sigue editándolo en Dreamweaver. La demo queda en mis cuentas (Supabase `biajiyiyjtqocqrabrnu` y GitHub Pages). Cuando el cliente apruebe, todo pasa a sus cuentas y a su Hostinger, así que la base de datos tiene que poder recrearse desde cero solo con las migraciones.

## Arquitectura
Es un sitio estático que habla directo con Supabase, sin servidor propio: cuesta $0 y no hay nada que mantener.

```
Navegador ──fetch──▶ PostgREST / RPC (anon key)  ─┐
Admin ──supabase-js──▶ Auth + tablas + Storage    ├─▶ Supabase (Postgres + RLS + Storage + Auth)
GitHub Action (cada 2 días) ──select──▶ RPC       ─┘
```

**Herramienta: Supabase CLI (`npx supabase`), sin MCP.**
- Credenciales: `SUPABASE_ACCESS_TOKEN` y `SUPABASE_DB_PASSWORD` van **solo en `.env`**, que entra a `.gitignore` antes del primer commit y nunca aparece en otro archivo ni en commits.
- Enlace: `npx supabase link --project-ref biajiyiyjtqocqrabrnu`. URL y publishable key: `npx supabase projects api-keys`.
- Migraciones: `npx supabase db push`.
- Estado real, consultas de prueba y carga: `npx supabase inspect db …`, `db lint`, REST, y `pg` en `qa/` con conexión directa (la contraseña se lee del `.env`).
- Advisors: endpoint de la Management API `/v1/projects/{ref}/advisors/security|performance` con el access token. Si no responde, uso consultas SQL equivalentes: tablas sin RLS, funciones con `search_path` mutable, FKs sin índice, políticas que reevalúan `auth.uid()`.

**Base de datos.** Todo va en `supabase/migrations/<timestamp>_*.sql` y se aplica con `db push`.
- Tablas:
  - `categorias`: nombre, slug, icono, color, orden, activa.
  - `negocios`: nombre, slug, categoria_id, etiqueta, ciudad, direccion, whatsapp, telefono, precio_desde, amenidades[], rutas de imagen grande, mini y logo, descripcion, rating, num_opiniones, plan, destacado_hasta, activo, created_at, updated_at, busqueda tsvector.
  - `ofertas` (ver supuesto S1).
  - `admins` (user_id).
  - `meta` (versión de datos).
- Triggers:
  - slug automático y único (con `unaccent`);
  - `updated_at`;
  - el tsvector en español sin tildes;
  - un trigger por sentencia que sube `meta.version` en cada insert, update o delete. Así los borrados también invalidan la caché, cosa que un `max(updated_at)` no detecta.
- Índices: GIN para la búsqueda y btree para (categoria_id, activo, nombre) y destacado_hasta.
- RLS:
  - `anon` solo puede hacer `select` de categorías activas, negocios activos y ofertas vigentes.
  - insert, update y delete solo si `auth.uid()` está en `admins`, comprobado con una función `es_admin()` SECURITY DEFINER y `search_path` fijo.
- RPC con una sola llamada por página:
  - `pagina_inicio()` devuelve categorías, destacados vigentes, ofertas y versión.
  - `buscar_negocios(q, cat, ciudad, pagina)` hace full-text en español con unaccent, pone primero los destacados vigentes (`destacado_hasta >= hoy`) y luego ordena A-Z, en páginas de 20 y con el total.
  - `pagina_negocio(slug)` devuelve un negocio.
  - `version_datos()` es liviana.
  - Las de lectura son `STABLE` y `SECURITY INVOKER`, así que respetan RLS.
- Storage: el bucket público `negocios` permite leer a cualquiera; subir, cambiar y borrar solo a los admin (políticas sobre `storage.objects`).
- Auth: email y contraseña para el admin.
- Seed: categorías del index y los 8 negocios de la maqueta.
- **Edge Functions: ninguna.** Lectura, búsqueda, permisos y subidas se resuelven con RLS, RPC y Storage. El admin se crea con el registro normal de Auth y se promueve con un script local (ver la parte 2); no hace falta un endpoint.

**Web pública** (`public/`), en HTML y JS vanilla con el mismo markup y CSS que `originales/`:
- `index.html`, `categoria.html` (hoteles generalizado con `?cat=`) y `negocio.html?slug=`.
- `js/config.js` lleva la URL y la publishable key.
- `js/fullguia.js` usa `fetch` directo a `/rest/v1/rpc/*`; supabase-js no se carga.
- Pinta con `<template>` + `textContent`, nunca con `innerHTML` de datos.

**Panel admin** (`public/admin/`): copio el CSS y el JavaScript del kernel r-script. Solo reemplazo `useRead` (l.311), `guardar` (l.337), `optimista` (l.352), `Subir` (l.658), `Login` (l.956) y la llamada `google.script.run` (l.240) por supabase-js, que cargo con versión fija desde CDN. Las firmas se mantienen. Pantallas: Inicio (KPIs de activos, destacados vigentes y por vencer en 7 días), Negocios, Categorías, Ofertas, Importar CSV y Configuración (tema).

## Velocidad
- Caché stale-while-revalidate en localStorage:
  - claves `fg_v1_*`, con un límite de unos 1,5 MB (si se pasa, borra primero las más viejas) y try/catch siempre;
  - pinta al instante lo guardado y luego `version_datos()` decide si hay que refrescar.
- Una sola RPC por vista, en páginas de 20.
- Carga de la página:
  - `preconnect` al dominio de Supabase y scripts con `defer`;
  - esqueletos de carga en lugar de spinners;
  - imágenes con `loading="lazy"`, `width`/`height` fijos y `srcset` mini/grande;
  - YouTube como fachada con miniatura, y el iframe solo se carga al hacer clic.
- Admin: guardado optimista como en r-script; si el servidor rechaza, revierte.

## Imágenes
- Acepta JPG, PNG o WebP de hasta 10 MB; cualquier otro formato se rechaza con un mensaje claro.
- El canvas corrige la orientación EXIF y genera dos WebP: **grande** de 1200 px máx. (≤ 150 KB, S2) y **mini** de 400 px (≤ 30 KB). El logo sale en una sola versión de 200 px. Si el navegador no soporta WebP, se usa JPG.
- Se suben con nombre uuid y `cacheControl` de 1 año. En la base de datos va solo la ruta.
- Al reemplazar o borrar, se borran los archivos viejos. Además, la QA detecta huérfanos.
- Cuenta: 2.000 negocios × ~200 KB ≈ 400 MB, dentro del plan gratis de 1 GB.
- `scripts/subir-fotos.js` vuelve a subir las fotos a otro proyecto. La service_role se le pasa solo por variable de entorno y nunca queda en un archivo.

## Requisitos (los verifica `qa/qa.js`)
**Base de datos y seguridad**

| # | Requisito |
|---|---|
| R1 | Las migraciones recrean la base de datos desde cero (tablas, triggers, RLS, RPC, bucket y seed). |
| R2 | `anon` solo lee activos y vigentes; insert, update y delete fallan. |
| R3 | El admin puede escribir; un usuario autenticado que no es admin no puede. |
| R4 | En Storage, `anon` lee y no puede subir; el admin sube y borra. |
| R5 | Ningún archivo público contiene la service_role ni secretos. |
| R6 | `get_advisors` de seguridad y rendimiento sin avisos críticos. |

**Búsqueda**

| # | Requisito |
|---|---|
| R7 | Sin tildes y en español: "hotel cucuta" encuentra "Cúcuta". |
| R8 | Orden de resultados: primero los negocios con `plan = 'destacado'` y `destacado_hasta >= hoy` (zona horaria de Bogotá), después los demás en orden alfabético sin tildes. Un destacado vencido baja automáticamente con los normales y no hay que tocarlo a mano. En el index solo aparecen destacados vigentes. |
| R9 | Paginado de 20 con total; con 2.000 registros responde en **< 300 ms**. |

**Web pública**

| # | Requisito |
|---|---|
| R10 | El diseño es idéntico a `originales/` (CSS y markup) salvo los cambios permitidos. |
| R11 | Index, categoría y detalle funcionan, con un mensaje cuando no hay resultados. |
| R12 | Caché stale-while-revalidate en localStorage. Claves `fg_v1_<vista>_<parámetros>` y un límite total de ~1,5 MB: si se pasa, borra primero las más viejas. Toda lectura y escritura va en try/catch, y si localStorage no existe la página funciona igual. Al abrir pinta lo guardado al instante y llama a `version_datos()`: si la versión cambió, vuelve a pedir la vista y repinta; si no cambió, no pide nada más. |
| R13 | Sin `innerHTML` con datos. |
| R14 | Lighthouse en móvil ≥ 90 en rendimiento. |
| R15 | Imágenes lazy con tamaño fijo y srcset, y fachada de YouTube. |

**Panel admin**

| # | Requisito |
|---|---|
| R16 | Login con Supabase Auth; un usuario que no es admin no entra. |
| R17 | CRUD optimista de negocios, categorías y ofertas, con reversión si el servidor rechaza. |
| R18 | Compresión de imágenes según la sección Imágenes, con formato y tamaño validados. |
| R19 | Sin archivos huérfanos al reemplazar o borrar. |
| R20 | Importar CSV con validación por fila y reporte de errores. |
| R21 | KPIs de vencimiento de destacados. |
| R22 | El JSX compila con Babel. |

**Operación**

| # | Requisito |
|---|---|
| R23 | GitHub Pages publica la demo. |
| R24 | El keepalive corre cada 2 días con un select real. |
| R25 | `INSTALACION.md` y `MIGRACION.md` están completos. |

## Orden de construcción (H, con un commit al final de cada parte)
0. **Preparación.** No hay MCP ni reinicio de sesión.
   - Creo `Desktop\fullguia`, copio las maquetas a `originales/` sin tocarlas y escribo `PLAN.md` y `.gitignore` (con `.env` y `node_modules`).
   - Hago `git init` y `gh repo create fullguia --public` con FERPAUL (S3). `gh` ya tiene sesión; si fallara, te pido `! gh auth login`.
   - ⛔ **Te pido en un solo mensaje:** `SUPABASE_ACCESS_TOKEN` y la contraseña de la base de datos. Los guardo en `.env` y hago `npx supabase init` y `link`.
1. **Estado real.** Con `pg` consulto las tablas, extensiones, buckets, políticas y el historial de migraciones; con `inspect db` y `projects api-keys` saco el resto. No supongo nada: si algo ya existe, las migraciones lo respetan o lo ajustan.
2. **Base de datos.**
   - Migraciones y seed con `db push`.
   - **Admin:** ⛔ te pido el correo en una línea. Lo registro con el flujo normal de Auth (`POST /auth/v1/signup` con la publishable key) y una contraseña aleatoria fuerte que solo te entrego a ti.
   - Si el proyecto exige confirmar el correo, te pido en una línea que hagas clic en el enlace del email o que lo confirmes en Dashboard → Authentication → Users.
   - Lo promuevo con `node scripts/hacer-admin.js <correo>`, que busca el id por correo e inserta en `admins` usando `pg` y el `.env`. No es una migración, porque el correo y el uid cambian en el proyecto del cliente. El script sirve también para la migración.
   - **Nunca** se inserta directo en `auth.users`.
3. **Web pública.**
4. **Panel admin.**
5. **Workflows.** `pages.yml` y `keepalive.yml`; activo Pages con `gh api`.
6. **QA** (V), correcciones (A) y otra pasada completa de V. Después, `/code-review`.

## Cómo voy a probar (V): `node qa/qa.js` tiene que dar 0 fallos
Reutilizo `jsdom`, `@babel/standalone` y `react` de `C:\Users\LENOVO\.claude\skills\r-script\tools\node_modules`. Con `npm i` en `qa/` agrego lo que falta: `puppeteer-core` (usa el Chrome instalado), `lighthouse` y `exifr` para las pruebas.
1. **Estático:** service_role o secretos, `innerHTML` con datos, que existan los ids y `<template>` que usa el JS, que los enlaces internos resuelvan y que el JSX compile (R5, R13, R22).
2. **Fidelidad:** diff normalizado de `<style>` y DOM contra `originales/`, con una lista blanca de cambios permitidos (R10).
3. **RLS:** pruebas por REST con la anon key, con un usuario no admin y con el admin, sobre tablas y Storage (R2–R4).
4. **Búsqueda:** "cucuta", destacado vencido y paginado (R7, R8).
5. **Humo de interfaz** en jsdom con fetch y Supabase simulados: index, categoría, detalle, caché SWR, login del admin, alta optimista y reversión (R11, R12, R16, R17, R20, R21).
6. **Carga:** inserto 2.000 registros sintéticos, mido la RPC (p95 < 300 ms) y los borro (R9).
7. **Imágenes**, en Chrome real con puppeteer:
   - un JPG de 8 MB con EXIF rotado da grande ≤ 150 KB y mini ≤ 30 KB, en WebP y con la orientación correcta;
   - un `.gif` o `.bmp`, o un archivo de 11 MB, se rechazan;
   - después de reemplazar o borrar no quedan huérfanos (R18, R19).
8. **Advisors:** Management API `advisors/security` y `advisors/performance` (o las consultas SQL equivalentes), más `npx supabase db lint`. No puede quedar ningún aviso ERROR ni WARN de seguridad (R6).
9. **Navegador real:** Lighthouse en móvil ≥ 90, capturas en escritorio y móvil al lado de los originales y consola sin errores (R14, R15).
10. **Operación:** el workflow de Pages queda en verde, la URL responde 200 y el keepalive corre a mano con `gh workflow run` (R23, R24).

**A:** cada fallo se corrige en su causa y se repite V completo. No entrego nada con fallos.

## Entrega
- La URL local con `npx serve public`, el usuario admin, el enlace de GitHub Pages y la salida del QA.
- `INSTALACION.md`.
- `MIGRACION.md`: invitaciones, transfer del proyecto Supabase (con un plan B: recrearlo con las migraciones y `scripts/subir-fotos.js`), transfer del repo de GitHub, Git en el hPanel de Hostinger, cambios en `config.js`, crear de nuevo al admin y activar el keepalive en el repo del cliente.

## Supuestos (confírmalos)
- **S1.** Incluyo la tabla `ofertas`: la pediste para el panel, aunque en esta lista solo aparecen categorias y negocios.
- **S2.** El límite de la imagen grande se cortó en tu mensaje. Asumo ≤ 150 KB, y el logo ≈ 200 px.
- **S3.** El repo será `fullguia`, **público** y en la cuenta FERPAUL. GitHub Pages gratis exige que el repo sea público. Que sea público no es un riesgo, porque solo lleva la publishable key.
- **S4.** No existe `categorias.html`. Saco las categorías del index (las que muestra la maqueta) y uso `categoria.html?cat=` como plantilla única.
- **S5.** El destacado se cobra por fuera en la fase 1: el admin pone `plan` y `destacado_hasta` a mano.
- **S6.** supabase-js v2 con versión fija desde cdnjs o jsDelivr, solo en el admin.
- **S7.** El correo del admin te lo pido en una línea en el paso 2.

*S1–S7 confirmados por el usuario. Al aprobar se construye de corrido de la parte 0 a la 6, y solo me detengo por los ⛔.*

## Al terminar entrego
- La salida de `node qa/qa.js` con 0 fallos.
- `npx serve public` corriendo: la URL local de la web y de `/admin`.
- El usuario admin.
- El enlace de GitHub Pages.
- La lista de supuestos.
- Todo el código en `Desktop\fullguia`.

---

## Ajustes acordados durante la construcción (2026-11-17)
- **Herramienta:** Supabase CLI (`npx supabase`) + `pg`, sin MCP. Credenciales solo en `.env` (ignorado por git).
- **Admin oficial:** `videosait.2026@gmail.com` (rol admin). Usuarios creados con la API oficial de administración de Auth (`scripts/crear-usuario.js`), nunca insertando en `auth.users`.
- **Roles del panel:** `admin` (todo: categorías, usuarios, datos demo, negocios, ofertas, fotos) y `editor` (negocios, ofertas, fotos, importar CSV).
- **Edge Function `usuarios` (justificada):** crear, borrar, cambiar rol y cambiar contraseña de usuarios de Auth exige la llave secreta, que no puede estar en el navegador. Solo responde a usuarios con rol admin. Es la única Edge Function.
- **WhatsApp:** solo Colombia, `57` + 10 dígitos que empiezan por 3 (restricción en la BD). El número de Edi queda vacío en `config.js` hasta que lo tenga.
- **Datos demo:** los negocios de la maqueta vienen marcados `demo = true`. En Configuración, el panel tiene **Cargar datos demo** (3 por categoría) y **Borrar datos demo** (borra negocios y ofertas demo, y sus fotos en Storage).

| # | Requisito nuevo |
|---|---|
| R26 | Usuarios y roles: el admin crea, cambia de rol, cambia la contraseña y elimina usuarios desde el panel. El editor no ve ni puede usar la pantalla Usuarios (la función responde 403), no puede editar categorías y no puede cargar ni borrar demo. |
| R27 | Datos demo: cargar agrega negocios demo sin duplicar; borrar elimina solo `demo = true` y sus archivos, sin tocar los negocios reales. |
| R28 | WhatsApp solo con formato colombiano (+57 3XX XXX XXXX); el panel normaliza 10 dígitos a 57XXXXXXXXXX. |

---

## Fase 2 · Galería de videos de YouTube (acordada en la 2.ª reunión, 2026-11-18)
- El recuadro de video del inicio pasa a ser una **galería deslizable** en el mismo lugar: swipe con el dedo encima del video (capa táctil sobre el iframe), flechas, puntos y teclado; sin cambiar de página.
- Panel → **Galería de videos**: pegar enlaces sin límite; título y miniatura automáticos (oEmbed de YouTube; canales con la Edge Function `youtube`); ordenar ↑ ↓; ocultar; Administrador y Editor.
- **Reproducción** (decisión del cliente: "todos en autoplay y el del frente con sonido"): arranca solo en silencio y el sonido se activa con el primer toque/clic/tecla del visitante (límite de los navegadores); un solo reproductor a la vez; al terminar pasa al siguiente.
- **Enlaces**: cualquier enlace público o no listado (video, Short, /live/, youtu.be, lista, canal `/channel/UC…` o `@usuario` → transmisión en vivo actual del canal).
- BD: migraciones 010 (tabla `videos`, RLS, `pagina_inicio()` con videos, KPI, seed) y 011 (videos demo + Cargar/Borrar demo). Edge Function `youtube` (justificada: la página de un canal no se puede leer desde el navegador por CORS; solo usuarios del panel; URL armada por la función, sin SSRF).

| # | Requisito nuevo |
|---|---|
| R29 | Galería en la BD: `anon` solo lee videos activos; admin y editor escriben; `anon` y usuarios sin rol no; la base rechaza IDs, miniaturas y enlaces no válidos y duplicados; `pagina_inicio()` trae los videos en la misma llamada y en orden; cambiar un video sube la versión de datos; la función `youtube` exige sesión del panel y solo resuelve rutas de canal. |
| R30 | Panel: acepta todos los formatos de enlace de YouTube y rechaza los demás; título y miniatura automáticos; avisa si el video es privado o no se puede insertar; alta, edición, orden y borrado optimistas con reversión; sin duplicados; el editor también lo usa. |
| R31 | Sitio: una diapositiva por video, deslizable sobre el video en un celular real; arranca solo en silencio y suena con el primer toque (YouTube lo confirma); un solo reproductor a la vez; flechas, puntos, teclado y contador; 0, 1 y 30 videos; títulos como texto; sin desbordes; Lighthouse móvil ≥ 90. |

