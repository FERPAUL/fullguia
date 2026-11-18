// R18 compresión en el navegador (EXIF, WebP, pesos) · R19 sin archivos huérfanos en Storage.
// Corre en Chrome/Edge real contra el panel local y el Supabase de prueba.
const fs = require('fs');
const path = require('path');
const { abrir } = require('../lib/navegador');
const { tokens, pedir, listarBucket, env } = require('../lib/supa');
const { conectar } = require('../lib/db');

const MARCA = 'QA-IMG';

// Genera en el navegador un JPG grande (~8 MB) con EXIF orientación 6: mitad izquierda roja, derecha azul.
// Al aplicar la orientación (girar 90° a la derecha) debe quedar vertical, rojo arriba y azul abajo.
async function fotoDePrueba(p) {
  return p.evaluate(async () => {
    const W = 4000, H = 3000, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H), d = img.data;
    let s = 12345;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const r = (s >> 8) % 70, i = (y * W + x) * 4, izq = x < W / 2;
        d[i] = izq ? 185 + r : r; d[i + 1] = r; d[i + 2] = izq ? r : 185 + r; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    let blob = null;
    for (const q of [0.97, 0.94, 0.9, 0.85, 0.8, 0.7, 0.6]) {
      blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', q));
      if (blob.size <= 9.6 * 1024 * 1024) break;
    }
    const jpg = new Uint8Array(await blob.arrayBuffer());
    // APP1 Exif big-endian con una sola entrada: Orientation (0x0112) = 6
    const exif = [0xFF, 0xE1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,
      0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    const out = new Uint8Array(jpg.length + exif.length);
    out.set(jpg.subarray(0, 2), 0); out.set(exif, 2); out.set(jpg.subarray(2), 2 + exif.length);
    window.__fotoPrueba = new File([out], 'foto-celular.jpg', { type: 'image/jpeg' });
    let bin = '';
    for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
    return { tam: out.length, b64: btoa(bin) };
  });
}

module.exports = async function (ctx) {
  const nav = await abrir();
  const T = await tokens();
  const db = await conectar();
  const p = await nav.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  const publica = (r) => env.SUPABASE_URL + '/storage/v1/object/public/negocios/' + r + '?t=' + Date.now();
  const existe = async (r) => (await fetch(publica(r))).status === 200;
  try {
    await db.query('delete from public.negocios where nombre like $1', [MARCA + '%']);
    await p.setViewport({ width: 1366, height: 900 });
    await p.goto(ctx.BASE + '/admin/', { waitUntil: 'networkidle0', timeout: 90000 });
    await p.waitForFunction(() => window.fgFotos && window.rsKit, { timeout: 90000 });

    // ---------- R18: compresión ----------
    const foto = await fotoDePrueba(p);
    const rutaFoto = path.join(ctx.OUT, 'foto-prueba-exif6.jpg');
    fs.writeFileSync(rutaFoto, Buffer.from(foto.b64, 'base64'));
    ctx.ok('R18', 'Foto de prueba: JPG de celular entre 6 y 10 MB con EXIF rotado', foto.tam > 6 * 1024 * 1024 && foto.tam <= 10 * 1024 * 1024, (foto.tam / 1048576).toFixed(1) + ' MB');
    const r = await p.evaluate(async () => {
      const f = window.__fotoPrueba, F = window.fgFotos;
      const o = await F.orientacionExif(f);
      const t0 = performance.now();
      const res = await F.procesarFoto(f, 'foto');
      const ms = performance.now() - t0;
      const color = async (blob, fy) => {
        const b = await createImageBitmap(blob), c = document.createElement('canvas');
        c.width = b.width; c.height = b.height;
        const g = c.getContext('2d'); g.drawImage(b, 0, 0);
        const px = g.getImageData(Math.floor(b.width / 2), Math.floor(b.height * fy), 1, 1).data;
        return [px[0], px[1], px[2]];
      };
      const logo = await F.procesarFoto(f, 'logo');
      return {
        orient: o, ms, webp: F.soportaWebp(),
        grande: { tipo: res.grande.tipo, kb: res.grande.blob.size / 1024, w: res.grande.w, h: res.grande.h, arriba: await color(res.grande.blob, 0.1), abajo: await color(res.grande.blob, 0.9) },
        mini: { tipo: res.mini.tipo, kb: res.mini.blob.size / 1024, w: res.mini.w, h: res.mini.h, arriba: await color(res.mini.blob, 0.1) },
        logo: { tipo: logo.logo.tipo, kb: logo.logo.blob.size / 1024, w: logo.logo.w, h: logo.logo.h }
      };
    });
    ctx.info('Grande ' + r.grande.w + '×' + r.grande.h + ' ' + r.grande.kb.toFixed(0) + ' KB · mini ' + r.mini.w + '×' + r.mini.h + ' ' + r.mini.kb.toFixed(0) + ' KB · logo ' + r.logo.w + '×' + r.logo.h + ' ' + r.logo.kb.toFixed(0) + ' KB · ' + (r.ms / 1000).toFixed(1) + ' s');
    ctx.ok('R18', 'Se lee la orientación EXIF (6 = girar 90°)', r.orient === 6, r.orient);
    ctx.ok('R18', 'La foto queda derecha: vertical, rojo arriba y azul abajo', r.grande.h > r.grande.w && r.grande.arriba[0] > 150 && r.grande.arriba[2] < 100 && r.grande.abajo[2] > 150 && r.grande.abajo[0] < 100,
      JSON.stringify([r.grande.arriba, r.grande.abajo]));
    ctx.ok('R18', 'Versión grande: WebP, lado mayor ≤ 1200 px y ≤ 150 KB', r.grande.tipo === 'image/webp' && Math.max(r.grande.w, r.grande.h) <= 1200 && r.grande.kb <= 150, r.grande.kb.toFixed(0) + ' KB');
    ctx.ok('R18', 'Versión mini: WebP, lado mayor ≤ 400 px y ≤ 30 KB', r.mini.tipo === 'image/webp' && Math.max(r.mini.w, r.mini.h) <= 400 && r.mini.kb <= 30, r.mini.kb.toFixed(0) + ' KB');
    ctx.ok('R18', 'La mini también queda derecha', r.mini.h > r.mini.w && r.mini.arriba[0] > 150);
    ctx.ok('R18', 'Logo: una sola versión WebP de 200 px y ≤ 30 KB', r.logo.tipo === 'image/webp' && Math.max(r.logo.w, r.logo.h) <= 200 && r.logo.kb <= 30, r.logo.kb.toFixed(0) + ' KB');
    ctx.ok('R18', 'Reducción: de ' + (foto.tam / 1048576).toFixed(1) + ' MB a menos de 180 KB en total', r.grande.kb + r.mini.kb < 180, (r.grande.kb + r.mini.kb).toFixed(0) + ' KB');

    const v = await p.evaluate(async () => {
      const F = window.fgFotos;
      const png = await new Promise((ok) => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; c.getContext('2d').fillRect(10, 10, 300, 300); c.toBlob(ok, 'image/png'); });
      const webp = await new Promise((ok) => { const c = document.createElement('canvas'); c.width = 900; c.height = 900; c.toBlob(ok, 'image/webp', 0.9); });
      const pngRes = await F.procesarFoto(new File([png], 'x.png', { type: 'image/png' }), 'foto');
      const webpRes = await F.procesarFoto(new File([webp], 'x.webp', { type: 'image/webp' }), 'logo');
      let falsa = '';
      try { await F.procesarFoto(new File([new Uint8Array(500)], 'falsa.jpg', { type: 'image/jpeg' }), 'foto'); } catch (e) { falsa = e.message || 'error'; }
      return {
        gif: F.validarFoto(new File([new Uint8Array(10)], 'animada.gif', { type: 'image/gif' })),
        bmp: F.validarFoto(new File([new Uint8Array(10)], 'vieja.bmp', { type: 'image/bmp' })),
        heic: F.validarFoto(new File([new Uint8Array(10)], 'iphone.heic', { type: 'image/heic' })),
        pdf: F.validarFoto(new File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' })),
        grande: F.validarFoto(new File([new Uint8Array(11 * 1024 * 1024)], 'enorme.jpg', { type: 'image/jpeg' })),
        okJpg: F.validarFoto(new File([new Uint8Array(10)], 'ok.jpg', { type: 'image/jpeg' })),
        png: pngRes.grande.tipo + ' ' + Math.round(pngRes.grande.blob.size / 1024),
        webp: webpRes.logo.tipo + ' ' + webpRes.logo.w,
        falsa
      };
    });
    ctx.ok('R18', 'Rechaza GIF, BMP, HEIC y PDF con mensaje claro', [v.gif, v.bmp, v.heic, v.pdf].every((m) => /Formato no permitido.*JPG, PNG o WebP/.test(m)), v.gif);
    ctx.ok('R18', 'Rechaza fotos de más de 10 MB con mensaje claro', /máximo es 10 MB/.test(v.grande), v.grande);
    ctx.ok('R18', 'Acepta JPG, PNG y WebP', v.okJpg === '' && /^image\/webp/.test(v.png) && /^image\/webp 200/.test(v.webp), v.png + ' · ' + v.webp);
    ctx.ok('R18', 'Un archivo dañado (no es imagen) se rechaza sin colgarse', !!v.falsa, v.falsa);

    // ---------- R18/R19 por la interfaz real: subir, guardar, borrar; subir y cancelar ----------
    await p.waitForSelector('.login-card input[type=email]', { timeout: 30000 });
    await p.type('.login-card input[type=email]', env.QA_ADMIN_EMAIL);
    await p.type('.login-card input[type=password]', env.QA_ADMIN_PASSWORD);
    await p.click('.login-card button[type=submit]');
    await p.waitForSelector('.sb-nav', { timeout: 30000 });
    const irA = async (txt) => { await p.evaluate((t) => Array.from(document.querySelectorAll('.sb-nav .sb-item')).find((b) => b.textContent.trim() === t).click(), txt); await new Promise((r2) => setTimeout(r2, 800)); };
    await irA('Negocios');
    await p.waitForSelector('button[data-primary]');
    const subidasAntes = new Set(await listarBucket(T.admin));

    // a) subir y CANCELAR: lo subido se borra
    await p.click('button[data-primary]');
    await p.waitForSelector('.modal .up input[type=file]');
    const inputs = await p.$$('.modal .up input[type=file]');
    await inputs[0].uploadFile(rutaFoto);
    await p.waitForFunction(() => /Foto lista/.test((document.querySelector('.toasts') || {}).textContent || ''), { timeout: 60000 });
    const trasSubir = (await listarBucket(T.admin)).filter((x) => !subidasAntes.has(x));
    ctx.ok('R18', 'Interfaz: al subir una foto se guardan 2 archivos WebP (grande y mini)', trasSubir.length === 2 && trasSubir.every((x) => /\.webp$/.test(x)), trasSubir.join(', '));
    await p.evaluate(() => Array.from(document.querySelectorAll('.modal button')).find((b) => b.textContent.trim() === 'Cancelar').click());
    await new Promise((r2) => setTimeout(r2, 2500));
    const trasCancelar = (await listarBucket(T.admin)).filter((x) => !subidasAntes.has(x));
    ctx.ok('R19', 'Interfaz: si se cancela el formulario, las fotos subidas se borran', trasCancelar.length === 0, trasCancelar.join(', '));

    // b) subir y GUARDAR
    await p.click('button[data-primary]');
    await p.waitForSelector('.modal .up input[type=file]');
    await (await p.$$('.modal .up input[type=file]'))[0].uploadFile(rutaFoto);
    await p.waitForFunction(() => /Foto lista/.test((document.querySelector('.toasts') || {}).textContent || ''), { timeout: 60000 });
    const nombre = MARCA + ' Interfaz ' + Date.now();
    await p.evaluate((n) => {
      const campo = Array.from(document.querySelectorAll('.modal .field')).find((f) => /^Nombre/.test(f.textContent.trim())).querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(campo, n);
      campo.dispatchEvent(new Event('input', { bubbles: true }));
      Array.from(document.querySelectorAll('.modal .field')).find((f) => /^Categoría/.test(f.textContent.trim())).querySelector('.dd-btn').click();
    }, nombre);
    await p.waitForSelector('.dd-opt');
    await p.evaluate(() => Array.from(document.querySelectorAll('.dd-opt')).find((o) => o.textContent === 'Hoteles').click());
    await p.evaluate(() => Array.from(document.querySelectorAll('.modal button')).find((b) => b.textContent.trim() === 'Guardar').click());
    await p.waitForFunction((n) => Array.from(document.querySelectorAll('.tb tbody tr')).some((tr) => tr.textContent.indexOf(n) >= 0 && !tr.classList.contains('pend')), { timeout: 30000 }, nombre);
    const n = (await db.query('select id, imagen, imagen_mini from public.negocios where nombre=$1', [nombre])).rows[0];
    ctx.ok('R18', 'Interfaz: el negocio guarda solo las rutas de las fotos (no la imagen)', n && /^negocios\/\d{4}\/[0-9a-f-]{36}-g\.webp$/.test(n.imagen) && /-m\.webp$/.test(n.imagen_mini), n && n.imagen);
    // GET como el navegador (Supabase responde HEAD con otras cabeceras de caché)
    const h = await fetch(publica(n.imagen));
    await h.arrayBuffer();
    ctx.ok('R18', 'Storage: la foto se sirve como image/webp con caché de 1 año', h.status === 200 && /image\/webp/.test(h.headers.get('content-type')) && /max-age=31536000/.test(h.headers.get('cache-control') || ''),
      h.headers.get('content-type') + ' · ' + h.headers.get('cache-control'));
    const kb = Number(h.headers.get('content-length') || 0) / 1024;
    ctx.ok('R18', 'Storage: la foto grande subida pesa ≤ 150 KB', kb > 0 && kb <= 150, kb.toFixed(0) + ' KB');

    // c) REEMPLAZAR la foto: la vieja se borra
    const [b1, b2] = await Promise.all(['g', 'm'].map(async (s) => {
      const ruta = 'negocios/2026/qa-' + Date.now() + '-' + s + '.webp';
      const up = await pedir('POST', '/storage/v1/object/negocios/' + ruta, { token: T.admin, body: new Uint8Array(fs.readFileSync(rutaFoto).subarray(0, 2000)), headers: { 'Content-Type': 'image/webp' } });
      return up.status === 200 ? ruta : null;
    }));
    const rep = await p.evaluate((id, g, m) => window.rsKit.wr('saveNegocio', { id, nombre: document.title ? undefined : undefined, imagen: g, imagen_mini: m }).then((x) => x), n.id, b1, b2);
    // saveNegocio exige nombre/categoría: se envía el registro completo
    const fila = (await db.query('select * from public.negocios where id=$1', [n.id])).rows[0];
    const rep2 = await p.evaluate((f, g, m) => window.rsKit.wr('saveNegocio', Object.assign({}, f, { imagen: g, imagen_mini: m, amenidades: f.amenidades || [] })), fila, b1, b2);
    ctx.ok('', 'Guardar sin nombre se rechaza en el servidor del panel', rep && rep.success === false);
    ctx.ok('R19', 'Al reemplazar la foto, la anterior (grande y mini) se borra de Storage', rep2.success && !(await existe(n.imagen)) && !(await existe(n.imagen_mini)) && (await existe(b1)), JSON.stringify(rep2.message || ''));
    // d) BORRAR el negocio: sus fotos se borran
    const del = await p.evaluate((id) => window.rsKit.wr('deleteNegocio', id), n.id);
    ctx.ok('R19', 'Al borrar el negocio, sus fotos se borran de Storage', del.success && !(await existe(b1)) && !(await existe(b2)));

    // ---------- R18: las fotos de los datos demo (enlaces externos) cumplen las mismas metas ----------
    const ext = (await db.query(`select imagen g, imagen_mini m from public.negocios where imagen like 'https://%'
      union select imagen, imagen_mini from public.ofertas where imagen like 'https://%'`)).rows;
    const pesos = await Promise.all(ext.map(async (x) => {
      const [g, m] = await Promise.all([x.g, x.m].map(async (u) => { const res = await fetch(u); return (await res.arrayBuffer()).byteLength / 1024; }));
      return { g, m, u: x.g.split('?')[0].split('/').pop() };
    }));
    const pesadas = pesos.filter((x) => x.g > 150 || x.m > 30);
    ctx.ok('R18', 'Fotos demo: grande ≤ 150 KB y mini ≤ 30 KB (' + pesos.length + ' fotos)', !pesadas.length,
      pesadas.length ? pesadas.map((x) => x.u + ' ' + x.g.toFixed(0) + '/' + x.m.toFixed(0) + ' KB').join(', ') : 'máx ' + Math.max(...pesos.map((x) => x.g)).toFixed(0) + ' KB / ' + Math.max(...pesos.map((x) => x.m)).toFixed(0) + ' KB');

    // ---------- R19: inventario completo, sin huérfanos ----------
    const todos = await listarBucket(T.admin);
    const ref = new Set((await db.query(`select unnest(array[imagen, imagen_mini, logo]) r from public.negocios
      union select unnest(array[imagen, imagen_mini]) from public.ofertas`)).rows.map((x) => x.r).filter(Boolean));
    const huerfanos = todos.filter((x) => !ref.has(x) && !/\.emptyFolderPlaceholder$/.test(x));
    ctx.ok('R19', 'Storage: ningún archivo huérfano (todo archivo está usado por un negocio u oferta)', huerfanos.length === 0, huerfanos.length ? huerfanos.slice(0, 5).join(', ') : todos.length + ' archivos en el bucket');
    ctx.ok('', 'Sin errores de JavaScript durante las pruebas de imágenes', !errores.length, errores.join(' | '));
  } finally {
    await db.query('delete from public.negocios where nombre like $1', [MARCA + '%']);
    await db.end();
    await nav.close();
  }
};
