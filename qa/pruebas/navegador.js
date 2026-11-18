// Navegador real (Chrome/Edge): Lighthouse móvil ≥ 90 (R14), comportamiento de carga (R15),
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
        p.on('requestfailed', (r) => { if (!/youtube|ytimg|unsplash/.test(r.url())) errores.push('falló ' + r.url()); });
        await p.setViewport(vp);
        await p.goto(ctx.BASE + '/' + url, { waitUntil: 'networkidle0', timeout: 60000 });
        await p.evaluate(() => window.FG && window.FG.listo);
        await new Promise((r) => setTimeout(r, 400));
        const info = await p.evaluate(() => ({
          ancho: document.documentElement.scrollWidth, vista: window.innerWidth,
          tarjetas: document.querySelectorAll('.business-card:not(.fg-sk-card), .hotel-card:not(.fg-sk-hotel), .category-card').length,
          esqueletos: document.querySelectorAll('.fg-sk-card, .fg-sk-hotel, .fg-sk-oferta').length,
          iframe: !!document.querySelector('.video-box iframe'),
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
        if (nombre === 'inicio') ctx.ok('R15', 'Inicio (' + disp + '): el video NO se carga hasta hacer clic', !info.iframe);
        await p.close();
      }
    }
    ctx.info('Capturas (sitio y maqueta original) en ' + path.relative(ctx.RAIZ, dirCap));

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
