// Revisión rápida en navegador real: abre una URL, espera, guarda captura y muestra errores de consola.
// Uso: node scripts/dev/mirar.js <url> <salida.png> [ancho] [alto]
const path = require('path');
const { abrir } = require('../../qa/lib/navegador');

(async () => {
  const [url, salida, w = '1280', h = '900'] = process.argv.slice(2);
  const nav = await abrir();
  const p = await nav.newPage();
  const errores = [];
  p.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  p.on('pageerror', (e) => errores.push(e.message));
  await p.setViewport({ width: +w, height: +h, deviceScaleFactor: 1, isMobile: +w < 600 });
  await p.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
  await p.evaluate(() => window.FG && window.FG.listo);
  await new Promise((r) => setTimeout(r, 800));
  await p.screenshot({ path: path.resolve(salida), fullPage: true });
  const info = await p.evaluate(() => ({
    titulo: document.title,
    tarjetas: document.querySelectorAll('.business-card:not(.fg-sk-card), .hotel-card:not(.fg-sk-hotel)').length,
    mensajes: Array.from(document.querySelectorAll('.fg-mensaje')).map((m) => m.textContent.trim()),
    esqueletos: document.querySelectorAll('.fg-sk-card, .fg-sk-hotel, .fg-sk-oferta').length,
    anchoDoc: document.documentElement.scrollWidth,
  }));
  console.log(JSON.stringify({ url, ...info, errores }, null, 1));
  await nav.close();
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
