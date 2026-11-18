// Recorre el panel en un navegador real: login y cada pantalla. Uso: node scripts/dev/probar-admin.js <base> <carpeta-capturas> [admin|editor]
const path = require('path');
const { abrir } = require('../../qa/lib/navegador');
const { cargarEnv } = require('../../qa/lib/env');

(async () => {
  const [base = 'http://localhost:5173', out = '.', quien = 'admin'] = process.argv.slice(2);
  const env = cargarEnv();
  const email = quien === 'editor' ? env.QA_EDITOR_EMAIL : env.QA_ADMIN_EMAIL;
  const clave = quien === 'editor' ? env.QA_EDITOR_PASSWORD : env.QA_ADMIN_PASSWORD;
  const nav = await abrir();
  const p = await nav.newPage();
  const errores = [];
  p.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  p.on('pageerror', (e) => errores.push(e.message));
  await p.setViewport({ width: 1366, height: 860 });
  await p.goto(base + '/admin/', { waitUntil: 'networkidle0', timeout: 60000 });
  await p.waitForSelector('.login-card input[type=email]', { timeout: 60000 });
  await p.type('.login-card input[type=email]', email);
  await p.type('.login-card input[type=password]', clave);
  await p.click('.login-card button[type=submit]');
  await p.waitForSelector('.sb-nav', { timeout: 30000 });
  const paginas = await p.$$eval('.sb-nav .sb-item', (bs) => bs.map((b) => b.textContent.trim()));
  console.log('Pantallas:', paginas.join(', '));
  for (let i = 0; i < paginas.length; i++) {
    const bs = await p.$$('.sb-nav .sb-item');
    await bs[i].click();
    await new Promise((r) => setTimeout(r, 2500));
    await p.screenshot({ path: path.join(out, 'admin-' + quien + '-' + i + '.png') });
    const info = await p.evaluate(() => ({
      titulo: (document.querySelector('.top-title') || {}).textContent,
      filas: document.querySelectorAll('.tb tbody tr').length,
      vacio: (document.querySelector('.empty') || {}).textContent || '',
      ui: (window.__uiErrors || []).slice(-1)[0] || ''
    }));
    console.log(JSON.stringify(info));
  }
  console.log('Errores de consola:', JSON.stringify(errores));
  await nav.close();
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
