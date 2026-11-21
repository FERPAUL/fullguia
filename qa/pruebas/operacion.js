// Operación: R23 GitHub Pages publicado y al día · R24 keepalive corre y consulta de verdad ·
// R25 documentos completos · herramientas del plan B de migración (fotos y datos) probadas de verdad.
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { tokens, pedir, env, mgmt } = require('../lib/supa');
const { conectar } = require('../lib/db');

const REPO = 'FERPAUL/fullguia';
const PAGES = 'https://ferpaul.github.io/fullguia/';
const sh = (c, cwd) => execSync(c, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).trim();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function (ctx) {
  const R = ctx.RAIZ;

  // ---------- R25: documentos ----------
  const doc = (f) => (fs.existsSync(path.join(R, f)) ? fs.readFileSync(path.join(R, f), 'utf8') : '');
  const ins = doc('INSTALACION.md'), mig = doc('MIGRACION.md'), plan = doc('PLAN.md');
  const faltan = (t, claves) => claves.filter((k) => t.indexOf(k) < 0);
  const fi = faltan(ins, ['supabase/migrations', 'db push', 'functions deploy usuarios', 'functions deploy youtube', 'Galería de videos', 'Administrador', 'Editor', 'config.js', 'WHATSAPP_FULLGUIA', 'qa/qa.js', 'keepalive', 'Datos demo', 'servidor-local.js', 'Dreamweaver']);
  ctx.ok('R25', 'INSTALACION.md explica base, función, roles, config, QA, publicación y Dreamweaver', ins && !fi.length, fi.join(', '));
  const fm = faltan(mig, ['functions deploy youtube', 'Transfer project', 'Transfer ownership', 'hPanel', 'GIT', 'Webhook', 'config.js', 'Cron', 'subir-fotos.js', 'copiar-datos.js', '.htaccess', 'Borrar datos demo', 'Redirect URLs']);
  ctx.ok('R25', 'MIGRACION.md cubre invitaciones, transfer Supabase y GitHub, Hostinger Git, config.js, keepalive y plan B', mig && !fm.length, fm.join(', '));
  ctx.ok('R25', 'PLAN.md lista R1…R31', /R1\b/.test(plan) && /R28\b/.test(plan) && /R31\b/.test(plan));
  const ht = doc('.htaccess');
  ctx.ok('R25', '.htaccess (Hostinger): sirve solo public/ y bloquea archivos ocultos y listados', /RewriteRule \^\(\.\*\)\$ public\/\$1/.test(ht) && /\(\^\|\/\)\\\. - \[F,L\]/.test(ht) && /Options -Indexes/.test(ht));

  // ---------- R23: GitHub Pages ----------
  const head = sh('git rev-parse HEAD', R);
  const pendiente = sh('git status --porcelain', R);
  ctx.ok('R23', 'Todo el código está guardado en git (sin cambios sin commit)', !pendiente, pendiente.split('\n').slice(0, 5).join(', '));
  let remoto = '';
  try { remoto = sh('git ls-remote origin refs/heads/main', R).split(/\s+/)[0]; } catch (e) { remoto = ''; }
  ctx.ok('R23', 'El repositorio en GitHub tiene la última versión (push hecho)', remoto === head, remoto.slice(0, 7) + ' vs ' + head.slice(0, 7));
  const ultimoPublicar = sh('git log -1 --format=%H -- public .github/workflows/pages.yml', R);
  let run = null;
  for (let i = 0; i < 40; i++) {
    const lista = JSON.parse(sh('gh run list -R ' + REPO + ' --workflow pages.yml -L 10 --json headSha,status,conclusion,databaseId'));
    run = lista.find((x) => x.headSha === head) || lista.find((x) => x.headSha === ultimoPublicar) || null;
    if (run && run.status === 'completed') break;
    await dormir(10000);
  }
  ctx.ok('R23', 'El workflow de GitHub Pages terminó bien para la versión actual', run && run.conclusion === 'success', run ? run.status + '/' + run.conclusion : 'sin ejecución');
  const pag = await fetch(PAGES + '?v=' + Date.now());
  const html = await pag.text();
  ctx.ok('R23', 'La demo responde en ' + PAGES, pag.status === 200 && html.indexOf('id="fg-destacados"') > 0, 'HTTP ' + pag.status);
  const cfgPub = await (await fetch(PAGES + 'js/config.js?v=' + Date.now())).text();
  ctx.ok('R23', 'La demo usa el mismo config.js que el repositorio', cfgPub.replace(/\r/g, '') === fs.readFileSync(path.join(R, 'public', 'js', 'config.js'), 'utf8').replace(/\r/g, ''));
  const adm = await fetch(PAGES + 'admin/');
  ctx.ok('R23', 'El panel responde en ' + PAGES + 'admin/', adm.status === 200 && /cargador\.js/.test(await adm.text()), 'HTTP ' + adm.status);
  // GitHub Pages a veces responde 503 pasajero (incluso a páginas que no existen): se reintenta hasta tener la respuesta real.
  const estadoReal = async (u) => { let s = 0; for (let i = 0; i < 6; i++) { s = (await fetch(u)).status; if (s !== 503) break; await new Promise((r) => setTimeout(r, 2000)); } return s; };
  const noPublicos = await Promise.all(['supabase/migrations/20261118000001_esquema.sql', 'qa/qa.js', '.env', 'originales/index.html'].map((p) => estadoReal(PAGES + p)));
  ctx.ok('R5', 'La demo no publica migraciones, pruebas, .env ni originales', noPublicos.every((s) => s === 404), noPublicos.join('/'));

  // ---------- R24: keepalive ----------
  const ka = doc('.github/workflows/keepalive.yml');
  ctx.ok('R24', 'Keepalive programado cada 2 días con consulta real (buscar_negocios) y re-habilitación', /cron: '\d+ \d+ \*\/2 \* \*'/.test(ka) && /rpc\/buscar_negocios/.test(ka) && /workflows\/keepalive\.yml\/enable/.test(ka));
  const antes = Date.now();
  sh('gh workflow run keepalive.yml -R ' + REPO + ' --ref main');
  let k = null;
  for (let i = 0; i < 36; i++) {
    await dormir(5000);
    const lista = JSON.parse(sh('gh run list -R ' + REPO + ' --workflow keepalive.yml -L 5 --json status,conclusion,createdAt,databaseId'));
    k = lista.find((x) => new Date(x.createdAt).getTime() >= antes - 60000) || null;
    if (k && k.status === 'completed') break;
  }
  ctx.ok('R24', 'Keepalive ejecutado ahora mismo en GitHub Actions: terminó bien', k && k.conclusion === 'success', k ? k.status + '/' + k.conclusion + ' #' + k.databaseId : 'no arrancó');
  if (k && k.databaseId) {
    const log = spawnSync('gh', ['run', 'view', String(k.databaseId), '-R', REPO, '--log'], { encoding: 'utf8', timeout: 60000 }).stdout || '';
    ctx.ok('R24', 'El keepalive hizo una consulta real a la base ("OK: Supabase respondió")', /OK: Supabase respondió/.test(log));
  }

  // ---------- Plan B de migración: fotos (respaldar → borrar → restaurar) ----------
  const T = await tokens();
  const llaves = await mgmt('/api-keys?reveal=true');
  const secreta = ((llaves.json || []).find((x) => x.type === 'secret' && x.api_key) || {}).api_key;
  const marca = 'qa-respaldo-' + Date.now();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const rutas = [marca + '/a.png', marca + '/sub/b.png'];
  for (const r of rutas) await pedir('POST', '/storage/v1/object/negocios/' + r, { token: T.admin, body: new Uint8Array(png), headers: { 'Content-Type': 'image/png' } });
  const carpeta = path.join(ctx.OUT, 'respaldo-fotos');
  fs.rmSync(carpeta, { recursive: true, force: true });
  const envFotos = Object.assign({}, process.env, { FG_ORIGEN_URL: env.SUPABASE_URL, FG_ORIGEN_SECRET: secreta, FG_DESTINO_URL: env.SUPABASE_URL, FG_DESTINO_SECRET: secreta });
  const correr = (args) => spawnSync(process.execPath, [path.join(R, 'scripts', 'subir-fotos.js')].concat(args), { encoding: 'utf8', env: envFotos, timeout: 120000 });
  const r1 = correr(['respaldar', carpeta, '--prefijo=' + marca]);
  const enDisco = rutas.every((r) => fs.existsSync(path.join(carpeta, ...r.split('/'))));
  ctx.ok('R1', 'subir-fotos.js respaldar: baja las fotos al disco con su ruta', r1.status === 0 && enDisco, (r1.stdout + r1.stderr).trim());
  await pedir('DELETE', '/storage/v1/object/negocios', { token: T.admin, body: { prefixes: rutas } });
  const borradas = (await Promise.all(rutas.map(async (r) => (await fetch(env.SUPABASE_URL + '/storage/v1/object/public/negocios/' + r + '?t=' + Date.now())).status))).every((s) => s >= 400);
  const r2 = correr(['restaurar', carpeta, '--prefijo=' + marca]);
  const vuelven = (await Promise.all(rutas.map(async (r) => (await fetch(env.SUPABASE_URL + '/storage/v1/object/public/negocios/' + r + '?t=' + Date.now())).status))).every((s) => s === 200);
  ctx.ok('R1', 'subir-fotos.js restaurar: vuelve a subir las fotos con la misma ruta', borradas && r2.status === 0 && vuelven, (r2.stdout + r2.stderr).trim());
  const r3 = correr(['restaurar', carpeta, '--prefijo=' + marca]);
  ctx.ok('R1', 'subir-fotos.js es seguro de repetir (no duplica)', r3.status === 0 && /2 ya estaban/.test(r3.stdout), r3.stdout.trim());
  await pedir('DELETE', '/storage/v1/object/negocios', { token: T.admin, body: { prefixes: rutas } });
  const sinLlave = spawnSync(process.execPath, [path.join(R, 'scripts', 'subir-fotos.js'), 'copiar'], { encoding: 'utf8', env: Object.assign({}, process.env, { FG_ORIGEN_SECRET: '', FG_DESTINO_SECRET: '' }) });
  ctx.ok('R5', 'subir-fotos.js exige las llaves por variables de entorno (no las lee de archivos)', sinLlave.status !== 0 && /variables de entorno/.test(sinLlave.stderr));

  // ---------- Plan B de migración: datos (copiar origen → destino; aquí el mismo proyecto, resultado idéntico) ----------
  const db = await conectar();
  try {
    const firma = async () => (await db.query(`select md5(string_agg(x, '|' order by x)) h, count(*)::int n from (
      select 'c' || id || slug || nombre x from public.categorias union all
      select 'n' || id || slug || nombre || coalesce(imagen,'') || coalesce(destacado_hasta::text,'') from public.negocios union all
      select 'o' || id || titulo || descuento from public.ofertas union all
      select 'v' || id || tipo || ref || titulo || orden || activo || demo from public.videos) t`)).rows[0];
    const f1 = await firma();
    const cadena = 'postgresql://' + encodeURIComponent(env.SUPABASE_DB_USER) + ':' + encodeURIComponent(env.SUPABASE_DB_PASSWORD) + '@' + env.SUPABASE_DB_HOST + ':5432/postgres';
    const c = spawnSync(process.execPath, [path.join(R, 'scripts', 'copiar-datos.js')], {
      encoding: 'utf8', timeout: 180000,
      env: Object.assign({}, process.env, { FG_ORIGEN_DB: cadena, FG_DESTINO_DB: cadena, NODE_PATH: path.join(R, 'qa', 'node_modules') })
    });
    const f2 = await firma();
    ctx.ok('R1', 'copiar-datos.js copia categorías, negocios, ofertas y videos sin perder nada', c.status === 0 && f1.h === f2.h && f1.n === f2.n,
      (c.stdout || '').replace(/\n/g, ' · ').trim() + (c.stderr ? ' ERR ' + c.stderr.trim() : '') + ' · ' + f1.n + ' filas');
  } finally {
    await db.end();
  }
};
