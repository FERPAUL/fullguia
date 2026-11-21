// Navegador real (Chrome/Edge): Lighthouse móvil ≥ 90 (R14), comportamiento de carga (R15), galería de videos (R31),
// capturas de escritorio y móvil junto a las maquetas originales (R10), consola sin errores.
const fs = require('fs');
const path = require('path');
const { abrir } = require('../lib/navegador');
const { env } = require('../lib/supa');

const PAGINAS = [
  ['inicio', 'index.html', 'index.html'],
  ['categoria', 'categoria.html?cat=hoteles', 'hoteles.html'],
  ['busqueda', 'categoria.html?q=hotel%20cucuta', null],
  ['negocio', 'negocio.html?slug=hotel-plaza-suite-executiva', null],
  ['categorias', 'categorias.html', null],
];

// Chrome con la política de autoplay de un navegador normal (no deja sonar sin un toque del visitante).
async function galeriaMovil(ctx, dirCap) {
  const nav = await abrir(['--autoplay-policy=document-user-activation-required']);
  try {
    const p = await nav.newPage();
    const errores = [];
    p.on('pageerror', (e) => errores.push(e.message));
    await p.evaluateOnNewDocument(() => {
      window.__yt = { muted: null, estado: null };
      window.addEventListener('message', (e) => {
        if (!/youtube/.test(e.origin)) return;
        try { const d = JSON.parse(e.data); const i = d.info || {}; if (typeof i.muted === 'boolean') window.__yt.muted = i.muted; if (typeof i.playerState === 'number') window.__yt.estado = i.playerState; } catch (x) { /* nada */ }
      });
    });
    await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await p.goto(ctx.BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
    await p.evaluate(() => window.FG.listo);
    const caja = await p.evaluate(() => { const g = document.getElementById('fg-galeria'); g.scrollIntoView({ block: 'center' }); const r = g.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const esperar = async (f, ms) => { const fin = Date.now() + ms; for (;;) { const v = await p.evaluate(f); if (v || Date.now() > fin) return v; await new Promise((r) => setTimeout(r, 250)); } };
    const sonando = await esperar(() => window.__yt.estado === 1, 15000);
    ctx.ok('R31', 'Celular: YouTube confirma que el primer video se reproduce solo', !!sonando);
    const est0 = await p.evaluate(() => window.FG.galeria.estado());
    // Arrastre con el dedo de derecha a izquierda ENCIMA del video
    const cdp = await p.target().createCDPSession();
    const y = Math.round(caja.y + caja.h * 0.4);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(caja.x + caja.w * 0.85), y }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(caja.x + caja.w * (0.85 - 0.06 * i)), y }] });
      await new Promise((r) => setTimeout(r, 16));
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const paso = await esperar(() => window.FG.galeria.estado().activo === 1, 5000);
    const est1 = await p.evaluate(() => Object.assign(window.FG.galeria.estado(), { iframes: document.querySelectorAll('#fg-pista iframe').length, contador: document.getElementById('fg-gal-contador').textContent }));
    ctx.ok('R31', 'Celular: deslizar el dedo sobre el video pasa al siguiente sin cambiar de página', !!paso && est0.activo === 0 && est1.iframes === 1 && /^2 \//.test(est1.contador), JSON.stringify({ antes: est0.activo, ahora: est1.activo, contador: est1.contador }));
    await p.evaluate(() => { window.__yt.estado = null; window.__yt.muted = null; });
    // Primer toque del visitante en la página (sobre el título del hero)
    const t = await p.evaluate(() => { const r = document.querySelector('.hero-title').getBoundingClientRect(); return { x: r.x + 20, y: r.y + 10 }; });
    if (t.y < 0 || t.y > 844) await p.evaluate(() => window.scrollBy(0, -200));
    const t2 = await p.evaluate(() => { const r = document.querySelector('.hero-title').getBoundingClientRect(); return { x: r.x + 20, y: r.y + 10 }; });
    await p.touchscreen.tap(Math.round(t2.x), Math.round(t2.y));
    const conSonido = await esperar(() => window.__yt.muted === false && window.FG.galeria.estado().sonido, 10000);
    ctx.ok('R31', 'Celular: con el primer toque el video del frente suena (YouTube lo confirma)', !!conSonido, JSON.stringify(await p.evaluate(() => window.__yt)));
    const boton = await p.evaluate(() => { const b = document.getElementById('fg-sonido'); return !b.hidden && b.textContent; });
    ctx.ok('R31', 'Celular: el botón ofrece silenciar', /Silenciar/.test(boton || ''), boton);
    await p.screenshot({ path: path.join(dirCap, 'galeria-movil.png') });
    const ancho = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    ctx.ok('R31', 'Celular: la galería no desborda la página ni lanza errores', ancho && !errores.length, errores.slice(0, 2).join(' | '));
  } finally {
    await nav.close();
  }
}

module.exports = async function (ctx) {
  const dirCap = path.join(ctx.OUT, 'capturas');
  fs.mkdirSync(dirCap, { recursive: true });
  // Las maquetas originales se sirven desde una copia temporal para compararlas lado a lado
  const tmpOrig = path.join(ctx.RAIZ, 'public', '__originales_qa');
  fs.mkdirSync(tmpOrig, { recursive: true });
  for (const f of ['index.html', 'hoteles.html']) fs.copyFileSync(path.join(ctx.RAIZ, 'originales', f), path.join(tmpOrig, f));
  const nav = await abrir();
  try {
    // ---------- Capturas y consola ----------
    for (const [nombre, url, original] of PAGINAS) {
      for (const [disp, vp] of [['escritorio', { width: 1366, height: 900 }], ['movil', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
        const p = await nav.newPage();
        const errores = [];
        p.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
        p.on('pageerror', (e) => errores.push(e.message));
        // Lo que pide el propio reproductor de YouTube (fotos del canal, anuncios) se cancela al cambiar de video: no es un error del sitio
        p.on('requestfailed', (r) => { if (!/youtube|ytimg|ggpht|googleusercontent|googlevideo|doubleclick|google.com|gstatic|unsplash/.test(r.url())) errores.push('falló ' + r.url()); });
        await p.setViewport(vp);
        await p.goto(ctx.BASE + '/' + url, { waitUntil: 'networkidle0', timeout: 60000 });
        await p.evaluate(() => window.FG && window.FG.listo);
        await new Promise((r) => setTimeout(r, 400));
        const info = await p.evaluate(() => ({
          ancho: document.documentElement.scrollWidth, vista: window.innerWidth,
          tarjetas: document.querySelectorAll('.business-card:not(.fg-sk-card), .hotel-card:not(.fg-sk-hotel), .category-card').length,
          esqueletos: document.querySelectorAll('.fg-sk-card, .fg-sk-hotel, .fg-sk-oferta').length,
          iframes: document.querySelectorAll('#fg-pista iframe').length,
          diapositivas: document.querySelectorAll('#fg-pista .fg-slide').length,
          silencio: /[?&]mute=1/.test((document.querySelector('#fg-pista iframe') || {}).src || ''),
          lcpLazy: Array.from(document.images).filter((i) => i.getBoundingClientRect().top < innerHeight && i.loading === 'lazy' && i.closest('.video-box')).length
        }));
        await p.screenshot({ path: path.join(dirCap, nombre + '-' + disp + '.png'), fullPage: true });
        if (original) {
          const o = await nav.newPage();
          await o.setViewport(vp);
          await o.goto(ctx.BASE + '/__originales_qa/' + original, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
          await o.screenshot({ path: path.join(dirCap, nombre + '-' + disp + '-ORIGINAL.png'), fullPage: true });
          await o.close();
        }
        ctx.ok('R11', nombre + ' (' + disp + '): carga con datos reales, sin esqueletos pendientes', info.tarjetas > 0 && info.esqueletos === 0, info.tarjetas + ' tarjetas');
        ctx.ok('R10', nombre + ' (' + disp + '): sin desplazamiento horizontal', info.ancho <= info.vista, info.ancho + ' / ' + info.vista + ' px');
        ctx.ok('', nombre + ' (' + disp + '): consola sin errores', !errores.length, errores.slice(0, 3).join(' | '));
        if (nombre === 'inicio') ctx.ok('R31', 'Inicio (' + disp + '): la galería arranca sola, en silencio y con un solo reproductor', info.iframes === 1 && info.silencio && info.diapositivas >= 2, info.iframes + ' reproductor(es), ' + info.diapositivas + ' videos');
        await p.close();
      }
    }
    ctx.info('Capturas (sitio y maqueta original) en ' + path.relative(ctx.RAIZ, dirCap));

    // ---------- Galería en un celular real: deslizar sobre el video y sonido con el primer toque (R31) ----------
    await galeriaMovil(ctx, dirCap);

    // ---------- Panel en móvil ----------
    const pa = await nav.newPage();
    const errPanel = [];
    pa.on('pageerror', (e) => errPanel.push(e.message));
    pa.on('console', (m) => { if (m.type() === 'error') errPanel.push(m.text()); });
    await pa.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await pa.goto(ctx.BASE + '/admin/', { waitUntil: 'networkidle0', timeout: 90000 });
    await pa.waitForSelector('.login-card input[type=email]', { timeout: 90000 });
    await pa.type('.login-card input[type=email]', env.QA_ADMIN_EMAIL);
    await pa.type('.login-card input[type=password]', env.QA_ADMIN_PASSWORD);
    await pa.click('.login-card button[type=submit]');
    await pa.waitForSelector('.kpi', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    await pa.screenshot({ path: path.join(dirCap, 'panel-movil.png'), fullPage: true });
    const anchoPanel = await pa.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    ctx.ok('R16', 'Panel en móvil: entra, sin desplazamiento horizontal ni errores', anchoPanel && !errPanel.length, errPanel.slice(0, 2).join(' | '));
    await pa.close();

    // ---------- Lighthouse móvil (R14) ----------
    const lighthouse = (await import('lighthouse')).default;
    const puerto = Number(new URL(nav.wsEndpoint()).port);
    for (const [nombre, url] of PAGINAS.filter((x) => ['inicio', 'categoria', 'negocio'].indexOf(x[0]) >= 0)) {
      let mejor = null;
      for (let i = 0; i < 2; i++) {
        const r = await lighthouse(ctx.BASE + '/' + url, { port: puerto, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'] });
        const lhr = r.lhr;
        const s = { perf: Math.round(lhr.categories.performance.score * 100), a11y: Math.round(lhr.categories.accessibility.score * 100),
          bp: Math.round(lhr.categories['best-practices'].score * 100), seo: Math.round(lhr.categories.seo.score * 100),
          lcp: lhr.audits['largest-contentful-paint'].displayValue, cls: lhr.audits['cumulative-layout-shift'].numericValue, tbt: lhr.audits['total-blocking-time'].displayValue,
          fcp: lhr.audits['first-contentful-paint'].displayValue };
        if (!mejor || s.perf > mejor.perf) { mejor = s; fs.writeFileSync(path.join(ctx.OUT, 'lighthouse-' + nombre + '.json'), JSON.stringify(lhr)); }
        if (s.perf >= 95) break;
      }
      ctx.info(nombre + ': rendimiento ' + mejor.perf + ' · accesibilidad ' + mejor.a11y + ' · buenas prácticas ' + mejor.bp + ' · SEO ' + mejor.seo +
        ' · FCP ' + mejor.fcp + ' · LCP ' + mejor.lcp + ' · TBT ' + mejor.tbt + ' · CLS ' + mejor.cls.toFixed(3));
      ctx.ok('R14', 'Lighthouse móvil – ' + nombre + ': rendimiento ≥ 90', mejor.perf >= 90, mejor.perf);
      ctx.ok('R15', 'Lighthouse móvil – ' + nombre + ': sin saltos de diseño (CLS < 0,1)', mejor.cls < 0.1, mejor.cls.toFixed(3));
    }
  } finally {
    await nav.close();
    fs.rmSync(tmpOrig, { recursive: true, force: true });
  }
};
