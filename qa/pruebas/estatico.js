// Revisión estática: secretos, innerHTML, ids/plantillas que usa el JS, enlaces internos y compilación del JSX.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { cargarEnv } = require('../lib/env');

function archivos(dir, filtro) {
  const out = [];
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) out.push(...archivos(p, filtro)); else if (!filtro || filtro.test(n.name)) out.push(p);
  }
  return out;
}

function rolDeJwt(t) {
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).role || ''; } catch (e) { return ''; }
}

module.exports = async function (ctx) {
  const PUB = path.join(ctx.RAIZ, 'public');
  const env = cargarEnv();
  const publicos = archivos(PUB);
  const rel = (p) => path.relative(ctx.RAIZ, p).replace(/\\/g, '/');

  // --- R5: secretos ---
  const secretos = [env.SUPABASE_ACCESS_TOKEN, env.SUPABASE_DB_PASSWORD, env.FG_ADMIN_PASSWORD, env.QA_ADMIN_PASSWORD,
    env.QA_EDITOR_PASSWORD, env.QA_NOADMIN_PASSWORD].filter((s) => s && s.length >= 8);
  const rastreados = execSync('git ls-files', { cwd: ctx.RAIZ }).toString().split('\n').filter(Boolean)
    .map((f) => path.join(ctx.RAIZ, f)).filter((f) => fs.existsSync(f) && fs.statSync(f).size < 3e6);
  const conSecreto = [];
  const conServiceRole = [];
  for (const f of new Set(publicos.concat(rastreados))) {
    const t = fs.readFileSync(f, 'utf8');
    if (secretos.some((s) => t.indexOf(s) >= 0)) conSecreto.push(rel(f));
    const jwts = t.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || [];
    if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(t) || jwts.some((j) => rolDeJwt(j) === 'service_role')) conServiceRole.push(rel(f));
  }
  ctx.ok('R5', 'Ningún archivo del repo ni de public/ contiene contraseñas, token de acceso u otras credenciales', !conSecreto.length, conSecreto.join(', '));
  ctx.ok('R5', 'Ninguna llave service_role / secret en archivos públicos ni versionados', !conServiceRole.length, conServiceRole.join(', '));
  const ignorados = execSync('git check-ignore .env', { cwd: ctx.RAIZ }).toString().trim();
  ctx.ok('R5', '.env está ignorado por git', ignorados === '.env');
  const cfg = fs.readFileSync(path.join(PUB, 'js', 'config.js'), 'utf8');
  const llave = (/SUPABASE_KEY:\s*'([^']+)'/.exec(cfg) || [])[1] || '';
  ctx.ok('R5', 'config.js usa una llave pública (publishable/anon)', /^sb_publishable_/.test(llave) || rolDeJwt(llave) === 'anon', llave.slice(0, 16) + '…');

  // --- R13: sin innerHTML con datos ---
  const codigo = publicos.filter((f) => /\.(js|jsx|html)$/.test(f));
  const peligrosos = [];
  for (const f of codigo) {
    const t = fs.readFileSync(f, 'utf8');
    const lineas = t.split('\n');
    lineas.forEach((l, i) => {
      if (/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write\s*\(|dangerouslySetInnerHTML/.test(l)) peligrosos.push(rel(f) + ':' + (i + 1));
    });
  }
  ctx.ok('R13', 'Sin innerHTML / outerHTML / insertAdjacentHTML / document.write / dangerouslySetInnerHTML', !peligrosos.length, peligrosos.join(', '));
  const fg = fs.readFileSync(path.join(PUB, 'js', 'fullguia.js'), 'utf8');
  ctx.ok('R13', 'fullguia.js pinta con textContent y plantillas', /textContent/.test(fg) && /cloneNode\(true\)/.test(fg));

  // --- ids y plantillas que usa el JS existen en cada página ---
  const REQ = {
    'index.html': ['fg-destacados', 'fg-dots', 'fg-ofertas', 'fg-categorias', 'fg-buscador', 'fg-q', 'fg-cat', 'tpl-negocio', 'tpl-categoria', 'tpl-oferta', 'publicar', 'ofertas', 'buscar'],
    'categoria.html': ['fg-lista', 'fg-paginacion', 'fg-total', 'fg-titulo', 'fg-filtro', 'fg-filtro-q', 'fg-filtro-cat', 'fg-nav-cat', 'fg-bottom-cat', 'tpl-seccion', 'tpl-hotel'],
    'negocio.html': ['fg-detalle', 'fg-nombre', 'fg-descripcion', 'fg-miga-cat', 'fg-miga-nombre', 'fg-detalle-ofertas', 'fg-ofertas-lista', 'tpl-hotel', 'tpl-oferta-detalle', 'fg-nav-cat'],
    'categorias.html': ['fg-categorias', 'tpl-categoria']
  };
  const PAG = { 'index.html': 'inicio', 'categoria.html': 'categoria', 'negocio.html': 'negocio', 'categorias.html': 'categorias' };
  for (const [pag, ids] of Object.entries(REQ)) {
    const h = fs.readFileSync(path.join(PUB, pag), 'utf8');
    const faltan = ids.filter((id) => h.indexOf('id="' + id + '"') < 0);
    ctx.ok('R11', pag + ': existen los ids y plantillas que usa fullguia.js', !faltan.length, faltan.join(', '));
    ctx.ok('R11', pag + ': declara data-fg-pagina="' + PAG[pag] + '" y carga config.js + fullguia.js con defer',
      h.indexOf('data-fg-pagina="' + PAG[pag] + '"') > 0 && /<script src="js\/config\.js" defer>/.test(h) && /<script src="js\/fullguia\.js" defer>/.test(h));
  }
  const tplHotel = fs.readFileSync(path.join(PUB, 'categoria.html'), 'utf8');
  const camposHotel = ['enlace', 'imagen', 'etiqueta', 'nombre', 'ubicacion', 'rating', 'opiniones', 'amenidades', 'precio_label', 'precio', 'whatsapp', 'destacado'];
  const faltanCampos = camposHotel.filter((c) => !new RegExp('data-f="[^"]*\\b' + c + '\\b').test(tplHotel));
  ctx.ok('R11', 'La plantilla tpl-hotel tiene todos los campos data-f', !faltanCampos.length, faltanCampos.join(', '));

  // --- el bloque de estilos añadido es idéntico en las 4 páginas ---
  const bloques = Object.keys(REQ).map((pag) => (/<style id="fg-estilos">([\s\S]*?)<\/style>/.exec(fs.readFileSync(path.join(PUB, pag), 'utf8')) || [])[1] || '');
  ctx.ok('R10', 'El bloque <style id="fg-estilos"> es idéntico en las 4 páginas', bloques[0].length > 500 && bloques.every((x) => x === bloques[0]));

  // --- enlaces internos resuelven ---
  const rotos = [];
  for (const f of publicos.filter((x) => /\.html$/.test(x))) {
    const h = fs.readFileSync(f, 'utf8').replace(/<template[\s\S]*?<\/template>/g, '');
    const refs = [...h.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    for (const r of refs) {
      if (/^(https?:|mailto:|tel:|#|data:|javascript:)/i.test(r) || r === '') continue;
      const limpio = r.split('#')[0].split('?')[0];
      if (!limpio) continue;
      let destino = path.resolve(path.dirname(f), limpio);
      if (fs.existsSync(destino) && fs.statSync(destino).isDirectory()) destino = path.join(destino, 'index.html');
      if (!fs.existsSync(destino)) rotos.push(rel(f) + ' → ' + r);
    }
  }
  ctx.ok('R11', 'Todos los enlaces y recursos internos existen', !rotos.length, rotos.join(', '));
  const hotelesRef = publicos.filter((f) => /\.html$/.test(f) && /href="hoteles\.html"/.test(fs.readFileSync(f, 'utf8')));
  ctx.ok('R11', 'Ningún enlace apunta a la maqueta vieja hoteles.html', !hotelesRef.length, hotelesRef.map(rel).join(', '));

  // --- scripts externos con versión exacta ---
  const scriptsExt = [];
  for (const f of publicos.filter((x) => /\.html$/.test(x))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/<script[^>]+src="(https:[^"]+)"/g)) scriptsExt.push(m[1]);
  }
  const sinVersion = scriptsExt.filter((u) => !/@\d+\.\d+\.\d+/.test(u));
  ctx.ok('', 'Los scripts externos fijan versión exacta', !sinVersion.length, sinVersion.join(', '));

  // --- R22: el JSX del panel compila ---
  const Babel = require('@babel/standalone');
  const app = fs.readFileSync(path.join(PUB, 'admin', 'app.jsx'), 'utf8');
  let compilado = '';
  try { compilado = Babel.transform(app, { presets: ['react'], sourceType: 'script', compact: true }).code; } catch (e) { compilado = ''; ctx.info(e.message); }
  ctx.ok('R22', 'El JSX del panel (admin/app.jsx) compila con Babel', compilado.length > 1000, compilado ? (compilado.length / 1024).toFixed(0) + ' KB' : '');
  ctx.ok('R22', 'El panel no contiene google.script.run (capa de datos reemplazada)', app.indexOf('google.script.run') < 0);
  ctx.ok('R22', 'El panel usa supabase-js con la publishable key de config.js', /window\.supabase\.createClient\(CFG\.SUPABASE_URL, CFG\.SUPABASE_KEY/.test(app));
  for (const f of ['fullguia.js', 'config.js']) {
    let ok = true;
    try { new Function(fs.readFileSync(path.join(PUB, 'js', f), 'utf8')); } catch (e) { ok = false; }
    ctx.ok('', 'js/' + f + ' es JavaScript válido', ok);
  }
  let okCarg = true;
  try { new Function(fs.readFileSync(path.join(PUB, 'admin', 'cargador.js'), 'utf8')); } catch (e) { okCarg = false; }
  ctx.ok('R22', 'admin/cargador.js es JavaScript válido', okCarg);

  // --- R28: WhatsApp Colombia en la BD y en el sitio ---
  const mig = archivos(path.join(ctx.RAIZ, 'supabase', 'migrations'), /\.sql$/).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  ctx.ok('R28', 'La BD exige WhatsApp colombiano (^573 + 9 dígitos)', mig.indexOf("whatsapp ~ '^573[0-9]{9}$'") >= 0);
  ctx.ok('R1', 'Hay migraciones versionadas para esquema, seguridad, RPC, storage, seed y roles',
    ['_esquema.sql', '_seguridad.sql', '_rpc.sql', '_storage.sql', '_seed.sql', '_roles_demo.sql'].every((s) => fs.readdirSync(path.join(ctx.RAIZ, 'supabase', 'migrations')).some((f) => f.endsWith(s))));
};
