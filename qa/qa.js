#!/usr/bin/env node
// FullGuia · control de calidad (fase V del ciclo P-H-V-A). Debe terminar con 0 fallos.
//
//   node qa/qa.js                 todo
//   node qa/qa.js --solo=rls,busqueda
//   node qa/qa.js --sin=lighthouse
//
// Usa los node_modules de qa/ y, si falta algo, los de la skill r-script (jsdom, babel, react).
// Necesita .env con las credenciales del proyecto de prueba (nunca se imprimen).
const fs = require('fs');
const path = require('path');
const Module = require('module');

const RAIZ = path.resolve(__dirname, '..');
const TOOLS = path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'skills', 'r-script', 'tools', 'node_modules');
process.env.NODE_PATH = [path.join(__dirname, 'node_modules'), TOOLS, process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module._initPaths();

const BLOQUES = [
  ['estatico', 'Revisión estática'],
  ['fidelidad', 'Fidelidad de diseño contra originales/'],
  ['migraciones', 'Migraciones: recrear desde cero'],
  ['rls', 'Seguridad (RLS, Storage, roles)'],
  ['busqueda', 'Búsqueda y orden'],
  ['humo-publico', 'Humo de interfaz del sitio (jsdom)'],
  ['humo-admin', 'Humo de interfaz del panel (jsdom)'],
  ['carga', 'Carga: 2.000 negocios'],
  ['imagenes', 'Imágenes: compresión, EXIF y huérfanos'],
  ['advisors', 'Advisors de Supabase'],
  ['navegador', 'Navegador real y Lighthouse'],
  ['operacion', 'Operación: Pages, keepalive y documentos'],
];

const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=')[1].split(',') : null; };
const solo = opt('solo'), sin = opt('sin') || [];

const resultados = [];
let actual = '';
const ctx = {
  RAIZ,
  OUT: path.join(__dirname, 'out'),
  ok(req, nombre, cond, detalle) {
    const r = { bloque: actual, req, nombre, ok: !!cond, detalle: detalle == null ? '' : String(detalle) };
    resultados.push(r);
    console.log((r.ok ? '  ✔ ' : '  ✘ ') + (req ? '[' + req + '] ' : '') + nombre + (r.detalle ? ' — ' + r.detalle : ''));
    return r.ok;
  },
  info(msg) { console.log('    · ' + msg); },
};
fs.mkdirSync(ctx.OUT, { recursive: true });

(async () => {
  const t0 = Date.now();
  const { iniciar } = require(path.join(RAIZ, 'scripts', 'servidor-local.js'));
  const srv = await iniciar(0);
  ctx.BASE = 'http://localhost:' + srv.address().port;
  console.log('FullGuia QA · ' + new Date().toISOString() + ' · sitio local ' + ctx.BASE + '\n');

  for (const [clave, titulo] of BLOQUES) {
    if (solo && solo.indexOf(clave) < 0) continue;
    if (sin.indexOf(clave) >= 0) continue;
    actual = clave;
    console.log('▶ ' + titulo);
    const t = Date.now();
    try {
      await require('./pruebas/' + clave)(ctx);
    } catch (e) {
      ctx.ok('', 'El bloque terminó sin errores inesperados', false, (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
    }
    console.log('    (' + ((Date.now() - t) / 1000).toFixed(1) + ' s)\n');
  }
  srv.close();

  const fallos = resultados.filter((r) => !r.ok);
  const reqs = Array.from(new Set(resultados.map((r) => r.req).filter(Boolean))).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  console.log('================================================================');
  console.log('Comprobaciones: ' + resultados.length + ' · Fallos: ' + fallos.length + ' · Requisitos cubiertos: ' + reqs.join(' ') +
    ' · ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  if (fallos.length) {
    console.log('\nFALLOS:');
    fallos.forEach((f) => console.log('  ✘ [' + f.bloque + '] ' + (f.req ? f.req + ' ' : '') + f.nombre + (f.detalle ? ' — ' + f.detalle : '')));
  } else {
    console.log('RESULTADO: 0 fallos ✔');
  }
  fs.writeFileSync(path.join(ctx.OUT, 'resultado.json'), JSON.stringify({ fecha: new Date().toISOString(), total: resultados.length, fallos: fallos.length, resultados }, null, 2));
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error('QA interrumpido:', e); process.exit(2); });
