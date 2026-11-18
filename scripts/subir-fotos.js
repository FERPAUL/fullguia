// Copia, respalda o restaura las fotos del bucket "negocios" de Supabase Storage.
// Sirve para el plan B de la migración (recrear el proyecto en la cuenta del cliente).
//
// Las llaves secretas se pasan SOLO por variables de entorno (nunca quedan en archivos):
//   FG_ORIGEN_URL, FG_ORIGEN_SECRET     proyecto de donde salen las fotos
//   FG_DESTINO_URL, FG_DESTINO_SECRET   proyecto a donde van
//
// Uso:
//   node scripts/subir-fotos.js respaldar <carpeta>     origen  → disco
//   node scripts/subir-fotos.js restaurar <carpeta>     disco   → destino
//   node scripts/subir-fotos.js copiar                  origen  → destino (sin pasar por disco)
// Opcional: --prefijo=negocios/2026  (solo esa carpeta)
//
// La ruta de cada archivo se conserva, así las rutas guardadas en la base siguen sirviendo.
const fs = require('fs');
const path = require('path');

const BUCKET = 'negocios';
const TIPOS = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

function proyecto(cual) {
  const url = process.env['FG_' + cual + '_URL'];
  const llave = process.env['FG_' + cual + '_SECRET'];
  if (!url || !llave) throw new Error('Faltan FG_' + cual + '_URL y FG_' + cual + '_SECRET (variables de entorno).');
  return { url: url.replace(/\/+$/, ''), llave };
}
const cab = (p, extra) => Object.assign({ apikey: p.llave, Authorization: 'Bearer ' + p.llave }, extra || {});

async function listar(p, prefijo) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(p.url + '/storage/v1/object/list/' + BUCKET, {
      method: 'POST', headers: cab(p, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefix: prefijo || '', limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    });
    if (!r.ok) throw new Error('No se pudo listar ' + (prefijo || '/') + ': HTTP ' + r.status + ' ' + await r.text());
    const lista = await r.json();
    for (const o of lista) {
      const ruta = (prefijo ? prefijo + '/' : '') + o.name;
      if (o.id === null) out.push(...await listar(p, ruta));
      else if (!/\.emptyFolderPlaceholder$/.test(o.name)) out.push(ruta);
    }
    if (lista.length < 1000) break;
  }
  return out;
}

async function bajar(p, ruta) {
  const r = await fetch(p.url + '/storage/v1/object/' + BUCKET + '/' + ruta.split('/').map(encodeURIComponent).join('/'), { headers: cab(p) });
  if (!r.ok) throw new Error('No se pudo bajar ' + ruta + ': HTTP ' + r.status);
  return { datos: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') || TIPOS[path.extname(ruta).toLowerCase()] || 'application/octet-stream' };
}

async function subir(p, ruta, datos, tipo) {
  const r = await fetch(p.url + '/storage/v1/object/' + BUCKET + '/' + ruta.split('/').map(encodeURIComponent).join('/'), {
    method: 'POST', headers: cab(p, { 'Content-Type': tipo, 'cache-control': 'max-age=31536000', 'x-upsert': 'false' }), body: datos
  });
  if (r.status === 200) return 'subido';
  const t = await r.text();
  if (r.status === 409 || /Duplicate|already exists/i.test(t)) return 'ya estaba';
  throw new Error('No se pudo subir ' + ruta + ': HTTP ' + r.status + ' ' + t);
}

async function main() {
  const [modo, carpeta] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const prefijo = ((process.argv.find((a) => a.startsWith('--prefijo=')) || '').split('=')[1] || '').replace(/^\/+|\/+$/g, '');
  const cuenta = { subido: 0, 'ya estaba': 0, bajado: 0 };
  if (modo === 'respaldar' && carpeta) {
    const o = proyecto('ORIGEN');
    const rutas = await listar(o, prefijo);
    for (const r of rutas) {
      const { datos } = await bajar(o, r);
      const destino = path.join(carpeta, ...r.split('/'));
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, datos);
      cuenta.bajado++;
    }
    console.log('Respaldo listo: ' + cuenta.bajado + ' archivos en ' + carpeta);
  } else if (modo === 'restaurar' && carpeta) {
    const d = proyecto('DESTINO');
    const archivos = [];
    (function rec(dir) { for (const n of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, n.name); if (n.isDirectory()) rec(f); else archivos.push(f); } })(path.join(carpeta, ...(prefijo ? prefijo.split('/') : [])));
    for (const f of archivos) {
      const ruta = path.relative(carpeta, f).split(path.sep).join('/');
      cuenta[await subir(d, ruta, fs.readFileSync(f), TIPOS[path.extname(f).toLowerCase()] || 'application/octet-stream')]++;
    }
    console.log('Restauración lista: ' + cuenta.subido + ' subidos, ' + cuenta['ya estaba'] + ' ya estaban');
  } else if (modo === 'copiar') {
    const o = proyecto('ORIGEN'), d = proyecto('DESTINO');
    for (const r of await listar(o, prefijo)) { const { datos, tipo } = await bajar(o, r); cuenta[await subir(d, r, datos, tipo)]++; }
    console.log('Copia lista: ' + cuenta.subido + ' subidos, ' + cuenta['ya estaba'] + ' ya estaban');
  } else {
    console.log('Uso: node scripts/subir-fotos.js respaldar <carpeta> | restaurar <carpeta> | copiar   [--prefijo=carpeta]');
    process.exit(2);
  }
}

main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
