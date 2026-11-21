// Humo de interfaz del panel en jsdom: React real (el del kernel) + Supabase en memoria.
// R16 login · R17 guardado optimista y reversión · R20 importación CSV · R21 KPIs · R26 permisos en la interfaz.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const Babel = require('@babel/standalone');
const { crearSupabaseFalso } = require('../lib/supabase-falso');

const esperar = async (cond, ms, paso) => {
  const fin = Date.now() + (ms || 3000);
  for (;;) {
    let v;
    try { v = cond(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() > fin) return false;
    await new Promise((r) => setTimeout(r, paso || 15));
  }
};

function estadoBase() {
  const cats = [{ id: 'c-hot', nombre: 'Hoteles', slug: 'hoteles', icono: 'hoteles', color: 'blue', orden: 10, activa: true },
    { id: 'c-com', nombre: 'Comidas', slug: 'comidas', icono: 'comidas', color: 'orange', orden: 20, activa: true }];
  const negs = [1, 2, 3].map((i) => ({ id: 'n' + i, nombre: 'Negocio ' + i, slug: 'negocio-' + i, categoria_id: 'c-hot', ciudad: 'Cúcuta', plan: i === 1 ? 'destacado' : 'gratis',
    destacado_hasta: i === 1 ? '2099-01-01' : null, activo: true, demo: i === 3, amenidades: [], rating: 4, num_opiniones: 1, imagen: null, imagen_mini: null, logo: null, etiqueta_tono: 'azul', precio_label: 'Desde' }));
  return {
    version: 1,
    usuarios: [
      { id: 'u-admin', email: 'admin@x.co', password: 'Clave12345x' },
      { id: 'u-editor', email: 'editor@x.co', password: 'Clave12345x' },
      { id: 'u-nadie', email: 'nadie@x.co', password: 'Clave12345x' }],
    tablas: {
      admins: [{ user_id: 'u-admin', rol: 'admin', nombre: 'Ana Admin', email: 'admin@x.co' }, { user_id: 'u-editor', rol: 'editor', nombre: 'Eva Editor', email: 'editor@x.co' }],
      categorias: cats, negocios: negs, ofertas: [],
      videos: [
        { id: 'vid-1', tipo: 'video', ref: 'AAAAAAAAAA1', titulo: 'Cámara 1', miniatura: 'https://i.ytimg.com/vi/AAAAAAAAAA1/hqdefault.jpg', enlace: null, orden: 10, activo: true, demo: false, created_at: '2026-11-20T01:00:00Z' },
        { id: 'vid-2', tipo: 'video', ref: 'BBBBBBBBBB2', titulo: 'Cámara 2', miniatura: null, enlace: 'https://youtu.be/BBBBBBBBBB2', orden: 20, activo: true, demo: true, created_at: '2026-11-20T02:00:00Z' }]
    },
    rpc: {
      panel_resumen: { activos: 3, inactivos: 0, destacados: 1, por_vencer: 1, vencidos: 2, demo: 1, ofertas: 0, categorias: 2, videos: 2, hoy: '2026-11-17',
        proximos: [{ id: 'n1', nombre: 'Negocio 1', destacado_hasta: '2026-11-20' }] }
    },
    funciones: (b) => (b.ruta ? { canal: 'UC' + 'k'.repeat(22), titulo: 'Cámaras Cúcuta', miniatura: 'https://yt3.googleusercontent.com/foto=s900' }
      : b.accion === 'listar' ? { usuarios: [{ user_id: 'u-admin', email: 'admin@x.co', rol: 'admin', nombre: 'Ana Admin' }] } : { ok: true })
  };
}

module.exports = async function (ctx) {
  const TOOLS = path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'skills', 'r-script', 'tools', 'node_modules');
  const react = fs.readFileSync(path.join(TOOLS, 'react', 'umd', 'react.production.min.js'), 'utf8');
  const reactDom = fs.readFileSync(path.join(TOOLS, 'react-dom', 'umd', 'react-dom.production.min.js'), 'utf8');
  const app = Babel.transform(fs.readFileSync(path.join(ctx.RAIZ, 'public', 'admin', 'app.jsx'), 'utf8'), { presets: ['react'], sourceType: 'script' }).code;

  async function abrirPanel(estado) {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/admin/', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    // APIs del navegador que jsdom no trae
    w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
    if (!w.crypto || !w.crypto.getRandomValues) Object.defineProperty(w, 'crypto', { value: require('crypto').webcrypto });
    w.eval(react); w.eval(reactDom);
    w.FG_CONFIG = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'sb_publishable_x', BUCKET: 'negocios' };
    w.__BOOT__ = { app: 'FullGuia', empresa: 'FullGuia.com', look: {} };
    w.supabase = { createClient: () => crearSupabaseFalso(estado) };
    w.open = () => null;
    // oEmbed de YouTube simulado: PRIV = privado (401), RED = sin conexión; el resto responde con su título
    w.fetch = async (url) => {
      const u = decodeURIComponent(String(url));
      if (/PRIVADO0001/.test(u) && !w.__permitir) return { ok: false, status: 401, json: async () => ({}) };
      if (/SINRED00001/.test(u)) throw new TypeError('Failed to fetch');
      if (/list=/.test(u)) return { ok: true, status: 200, json: async () => ({ title: 'Lista de prueba', thumbnail_url: 'https://i.ytimg.com/vi/LLLLLLLLLL1/hqdefault.jpg' }) };
      const id = (/v=([A-Za-z0-9_-]{11})/.exec(u) || [])[1] || '';
      return { ok: true, status: 200, json: async () => ({ title: 'Título de YouTube ' + id, thumbnail_url: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' }) };
    };
    w.HTMLElement.prototype.scrollIntoView = function () {};
    const errores = [];
    w.addEventListener('error', (e) => errores.push(e.message));
    w.eval(app);
    const d = w.document;
    const $ = (s) => d.querySelector(s), $$ = (s) => Array.from(d.querySelectorAll(s));
    const escribir = (el, v) => {
      const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
    };
    const campo = (etiqueta) => { const f = $$('.modal .field').find((x) => (x.querySelector('.lbl') || {}).textContent && x.querySelector('.lbl').textContent.replace('*', '').trim() === etiqueta); return f && f.querySelector('input,textarea,.dd-btn'); };
    const boton = (texto, raiz) => Array.from((raiz || d).querySelectorAll('button')).find((b) => b.textContent.trim() === texto);
    const ir = async (pantalla) => { const b = $$('.sb-nav .sb-item').find((x) => x.textContent.trim() === pantalla); if (b) b.click(); return esperar(() => ($('.top-title') || {}).textContent === pantalla); };
    const entrar = async (email, clave) => {
      await esperar(() => $('.login-card input[type=email]'));
      escribir($('.login-card input[type=email]'), email);
      escribir($('.login-card input[type=password]'), clave);
      $('.login-card button[type=submit]').click();
    };
    return { w, d, $, $$, escribir, campo, boton, ir, entrar, errores, estado };
  }

  // ---------- R16: ingreso ----------
  const e1 = estadoBase();
  const P = await abrirPanel(e1);
  ctx.ok('R16', 'Panel: muestra la pantalla de ingreso', await esperar(() => P.$('.login-card input[type=email]')));
  await P.entrar('admin@x.co', 'mala');
  ctx.ok('R16', 'Contraseña incorrecta: "Correo o contraseña incorrectos"', await esperar(() => /Correo o contraseña incorrectos/.test((P.$('.login-err') || {}).textContent || '')));
  await P.entrar('nadie@x.co', 'Clave12345x');
  ctx.ok('R16', 'Usuario sin rol: se le niega la entrada al panel', await esperar(() => /no tiene acceso al panel/.test((P.$('.login-err') || {}).textContent || '')) && !P.$('.sb-nav'));
  await P.entrar('admin@x.co', 'Clave12345x');
  ctx.ok('R16', 'Administrador: entra y ve el menú (con Galería de videos)', await esperar(() => P.$$('.sb-nav .sb-item').length === 8) && P.$$('.sb-nav .sb-item').some((x) => x.textContent.trim() === 'Galería de videos'), P.$$('.sb-nav .sb-item').map((x) => x.textContent).join(','));

  // ---------- R21: KPIs ----------
  const kpis = await esperar(() => P.$$('.kpi').length === 7 && P.$$('.kpi'));
  const txt = kpis ? kpis.map((k) => k.textContent.replace(/\s+/g, ' ')).join(' | ') : '';
  ctx.ok('R21', 'Inicio: KPIs de activos, destacados vigentes, por vencer y vencidos', /3\s*Negocios activos/.test(txt) && /1\s*Destacados vigentes/.test(txt) && /1\s*Destacados por vencer/.test(txt) && /2\s*Destacados vencidos/.test(txt), txt);
  ctx.ok('R21', 'Inicio: lista de destacados que vencen en 7 días', /Negocio 1/.test((P.$('.feed') || {}).textContent || ''));
  ctx.ok('R30', 'Inicio: KPI "Videos en la galería"', /2\s*Videos en la galería/.test(txt), txt);
  ctx.ok('R27', 'Inicio: aviso de negocios demo para el administrador', /1 negocios demo/.test(P.d.body.textContent));

  // ---------- R17: alta optimista ----------
  await P.ir('Negocios');
  ctx.ok('R17', 'Negocios: lista los negocios', await esperar(() => P.$$('.tb tbody tr').length === 3), P.$$('.tb tbody tr').length);
  P.$('button[data-primary]').click();
  await esperar(() => P.campo('Nombre'));
  P.escribir(P.campo('Nombre'), 'Hotel Optimista');
  P.campo('Categoría').click();
  const opc = await esperar(() => Array.from(P.d.querySelectorAll('.dd-opt')).find((o) => o.textContent === 'Hoteles'));
  if (opc) opc.click();
  P.escribir(P.campo('WhatsApp'), '12345');
  P.boton('Guardar', P.$('.modal')).click();
  ctx.ok('R28', 'Formulario: WhatsApp no colombiano se rechaza antes de enviar', await esperar(() => /celular de Colombia/.test((P.$('.toasts') || {}).textContent || '')) && !!P.$('.modal'));
  P.escribir(P.campo('WhatsApp'), '300 123 4567');
  let soltar;
  e1.pausa = new Promise((r) => { soltar = r; });
  P.boton('Guardar', P.$('.modal')).click();
  const pend = await esperar(() => !P.$('.modal') && P.$$('.tb tbody tr.pend').find((r) => /Hotel Optimista/.test(r.textContent)));
  ctx.ok('R17', 'Guardar: el formulario se cierra y la fila aparece al instante (pendiente)', !!pend);
  ctx.ok('R17', 'Mientras se guarda, el servidor aún no tiene el negocio', !e1.tablas.negocios.some((n) => n.nombre === 'Hotel Optimista'));
  soltar(); e1.pausa = null;
  const conf = await esperar(() => P.$$('.tb tbody tr').find((r) => /Hotel Optimista/.test(r.textContent) && !r.classList.contains('pend')));
  const guardado = e1.tablas.negocios.find((n) => n.nombre === 'Hotel Optimista');
  ctx.ok('R17', 'Al confirmar: la fila queda firme y el negocio existe en la base', !!conf && !!guardado);
  ctx.ok('R28', 'El WhatsApp se guarda normalizado con +57', guardado && guardado.whatsapp === '573001234567', guardado && guardado.whatsapp);

  // ---------- R17: reversión ----------
  P.$('button[data-primary]').click();
  await esperar(() => P.campo('Nombre'));
  P.escribir(P.campo('Nombre'), 'Hotel Rechazado');
  await esperar(() => !P.d.querySelector('.dd-pop'));
  P.campo('Categoría').click();
  const op2 = await esperar(() => Array.from(P.d.querySelectorAll('.dd-opt')).find((o) => o.textContent === 'Hoteles'));
  if (op2) op2.click();
  await esperar(() => /Hoteles/.test(P.campo('Categoría').textContent));
  e1.fallar = { negocios: { code: '42501', message: 'new row violates row-level security policy' } };
  P.boton('Guardar', P.$('.modal')).click();
  const aviso = await esperar(() => /No se guardó/.test(P.d.body.textContent) && /No tienes permiso/.test(P.d.body.textContent));
  ctx.ok('R17', 'Si el servidor rechaza: aviso claro "No se guardó · No tienes permiso"', !!aviso,
    aviso ? '' : 'categoría: ' + P.campo('Categoría').textContent + ' · avisos: ' + ((P.$('.toasts') || {}).textContent || ''));
  ctx.ok('R17', 'Si el servidor rechaza: la fila desaparece (se revierte)', await esperar(() => !P.$$('.tb tbody tr').some((r) => /Hotel Rechazado/.test(r.textContent))));
  const ent = P.boton('Entendido');
  if (ent) ent.click();
  ctx.ok('R17', 'Tras el aviso, el formulario vuelve con lo escrito', await esperar(() => P.campo('Nombre') && P.campo('Nombre').value === 'Hotel Rechazado'));
  const canc = P.boton('Cancelar', P.$('.modal'));
  if (canc) canc.click();

  // ---------- R17: edición optimista ----------
  await esperar(() => !P.$('.modal'));
  const fila = P.$$('.tb tbody tr').find((r) => /Negocio 2/.test(r.textContent));
  fila.click();
  await esperar(() => P.campo('Ciudad'));
  P.escribir(P.campo('Ciudad'), 'Pamplona');
  e1.pausa = new Promise((r) => { soltar = r; });
  P.boton('Guardar', P.$('.modal')).click();
  ctx.ok('R17', 'Editar: el cambio se ve al instante', !!await esperar(() => P.$$('.tb tbody tr.pend').find((r) => /Negocio 2/.test(r.textContent) && /Pamplona/.test(r.textContent))));
  soltar(); e1.pausa = null;
  ctx.ok('R17', 'Editar: el cambio llega a la base', await esperar(() => e1.tablas.negocios.find((n) => n.id === 'n2').ciudad === 'Pamplona'), JSON.stringify(e1.log.slice(-3)).slice(0, 300) + ' ' + (P.$('.dlg') ? P.$('.dlg').textContent : ''));

  // ---------- Pestañas por estado ----------
  const tabs = P.$$('.tabs .tab').map((t) => t.textContent);
  ctx.ok('R21', 'Negocios: pestañas por estado del plan (Destacados, Por vencer, Vencidos, Pausados, Demo)', tabs.length === 6 && /Demo1/.test(tabs.join('|')), tabs.join('|'));

  // ---------- R20: importación ----------
  const analizar = P.w.fgAnalizarCSV;
  const csv = 'nombre;categoria;ciudad;whatsapp;plan;destacado_hasta;imagen_url\n' +
    'Hotel Nuevo;Hoteles;Cúcuta;3001112233;destacado;31/12/2026;\n' +
    'Sin Categoría;Inexistente;Cúcuta;;;;\n' +
    'Mal WhatsApp;hoteles;Cúcuta;12345;;;\n' +
    'Mala Fecha;Hoteles;Cúcuta;;destacado;31-31-2026;\n' +
    'Negocio 1;Hoteles;Cúcuta;;;;\n' +
    'Hotel Nuevo;Hoteles;Cúcuta;;;;\n' +
    'Imagen Insegura;Hoteles;Cúcuta;;;;http://x.com/a.jpg\n' +
    '"Café, ""Rico""";Comidas;Ocaña;;gratis;;https://images.unsplash.com/a\n';
  const r = analizar(csv, e1.tablas.categorias, e1.tablas.negocios);
  const est = r.filas.map((f) => (f.error ? 'X' : 'OK')).join('');
  ctx.ok('R20', 'CSV: valida fila por fila (categoría, WhatsApp, fecha, duplicados, imagen https)', est === 'OKXXXXXXOK', est + ' · ' + r.filas.filter((f) => f.error).map((f) => f.fila + ': ' + f.error).join(' | '));
  ctx.ok('R20', 'CSV: entiende comillas, punto y coma y fechas DD/MM/AAAA', r.filas[7].nombre === 'Café, "Rico"' && r.filas[0].datos.destacado_hasta === '2026-12-31');
  ctx.ok('R20', 'CSV: sin columnas obligatorias da un error claro', /Faltan las columnas obligatorias/.test(analizar('a,b\n1,2', [], []).error));
  const validas = r.filas.filter((f) => !f.error).map((f) => ({ fila: f.fila, datos: f.datos }));
  e1.fallar = { negocios: { code: '23514', message: 'violates check constraint "negocios_whatsapp_co_chk"' } };
  const imp = await P.w.rsKit.wr('importarNegocios', validas);
  ctx.ok('R20', 'Importar: si un tramo falla, reintenta fila por fila e informa cuál falló', imp.success && imp.insertados === 2 && imp.errores.length === 0, JSON.stringify(imp));
  e1.fallarSiempre = { negocios: { code: '23514', message: 'x' } };
  const imp2 = await P.w.rsKit.wr('importarNegocios', [{ fila: 9, datos: validas[0].datos }]);
  e1.fallarSiempre = null;
  ctx.ok('R20', 'Importar: reporta el error por fila', imp2.success && imp2.insertados === 0 && imp2.errores[0].fila === 9, JSON.stringify(imp2.errores));
  await P.ir('Importar CSV');
  ctx.ok('R20', 'Pantalla Importar CSV con plantilla descargable', !!P.boton('Descargar plantilla') && !!P.boton('Elegir archivo CSV'));

  // ---------- Hallazgos de /code-review (para que no vuelvan) ----------
  e1.log.length = 0;
  const masivo = await P.w.rsKit.wr('updateNegocios', ['n1', 'n3'], { activo: 0 });
  const enviado = (e1.log.find((l) => l[0] === 'update' && l[1] === 'negocios') || [])[2] || {};
  ctx.ok('R17', 'Publicar/Pausar varios: solo envía el cambio (no borra el nombre)', masivo.success && !('nombre' in enviado) && e1.tablas.negocios.find((n) => n.id === 'n1').nombre === 'Negocio 1' && e1.tablas.negocios.find((n) => n.id === 'n3').activo === false,
    JSON.stringify(enviado));
  const cat0 = await P.w.rsKit.wr('saveCategoria', { id: 'c-com', nombre: 'Comidas', icono: 'comidas', color: 'orange', orden: 0, activa: 1 });
  ctx.ok('R17', 'Orden 0 se guarda como 0 (no se cambia por 100)', cat0.success && e1.tablas.categorias.find((c) => c.id === 'c-com').orden === 0);
  // Editar un negocio con foto, fallar el guardado y cancelar: la foto vigente NO se borra
  e1.tablas.negocios.find((n) => n.id === 'n1').imagen = 'negocios/2026/vigente-g.webp';
  e1.tablas.negocios.find((n) => n.id === 'n1').imagen_mini = 'negocios/2026/vigente-m.webp';
  await P.ir('Inicio'); await P.ir('Negocios');
  await esperar(() => P.$$('.tb tbody tr').some((r) => /Negocio 1/.test(r.textContent)));
  e1.version++;
  P.$$('.tb tbody tr').find((r) => /Negocio 1/.test(r.textContent)).click();
  await esperar(() => P.campo('Ciudad'));
  e1.log.length = 0;
  e1.fallar = { negocios: { code: '42501', message: 'rls' } };
  P.boton('Guardar', P.$('.modal')).click();
  const okB = await esperar(() => P.boton('Entendido'));
  if (okB) okB.click();
  await esperar(() => P.campo('Ciudad'));
  const cB = P.boton('Cancelar', P.$('.modal'));
  if (cB) cB.click();
  await new Promise((r) => setTimeout(r, 200));
  const borro = e1.log.filter((l) => l[0] === 'remove').map((l) => l[1]).flat();
  const intento = e1.log.some((l) => l[0] === 'update' && l[1] === 'negocios');
  ctx.ok('R19', 'Guardado fallido + Cancelar: las fotos vigentes del negocio no se borran', intento && !!okB && !borro.some((r) => /vigente/.test(r)),
    'intento=' + intento + ' aviso=' + !!okB + ' borrados=' + JSON.stringify(borro));
  delete e1.fallar;

  // ---------- R30: galería de videos ----------
  const L = P.w.fgVideos.leerEnlaceYoutube;
  const casos = [
    ['https://www.youtube.com/watch?v=7vw3rFRuvJ0', 'video', '7vw3rFRuvJ0'], ['https://youtu.be/7vw3rFRuvJ0?si=Xy12', 'video', '7vw3rFRuvJ0'],
    ['youtube.com/shorts/7vw3rFRuvJ0', 'video', '7vw3rFRuvJ0'], ['https://m.youtube.com/watch?v=7vw3rFRuvJ0&t=45s', 'video', '7vw3rFRuvJ0'],
    ['https://www.youtube.com/live/7vw3rFRuvJ0?feature=share', 'video', '7vw3rFRuvJ0'], ['https://www.youtube-nocookie.com/embed/7vw3rFRuvJ0', 'video', '7vw3rFRuvJ0'],
    ['https://music.youtube.com/watch?v=7vw3rFRuvJ0', 'video', '7vw3rFRuvJ0'], ['  7vw3rFRuvJ0  ', 'video', '7vw3rFRuvJ0'],
    ['https://www.youtube.com/watch?v=7vw3rFRuvJ0&list=PLrEnWoR732-BHrPp_Pm8_VleD68f9s14-', 'video', '7vw3rFRuvJ0'],
    ['https://www.youtube.com/playlist?list=PLrEnWoR732-BHrPp_Pm8_VleD68f9s14-', 'lista', 'PLrEnWoR732-BHrPp_Pm8_VleD68f9s14-'],
    ['https://www.youtube.com/embed/videoseries?list=PLrEnWoR732-BHrPp_Pm8_VleD68f9s14-', 'lista', 'PLrEnWoR732-BHrPp_Pm8_VleD68f9s14-'],
    ['https://www.youtube.com/channel/UCBR8-60-B28hp2BmDPdntcQ', 'canal', 'UCBR8-60-B28hp2BmDPdntcQ'],
    ['https://www.youtube.com/embed/live_stream?channel=UCBR8-60-B28hp2BmDPdntcQ', 'canal', 'UCBR8-60-B28hp2BmDPdntcQ'],
    ['https://www.youtube.com/@CamarasCucuta/live', 'canal', '@CamarasCucuta'], ['@CamarasCucuta', 'canal', '@CamarasCucuta'],
    ['https://www.youtube.com/c/Fulano', 'canal', 'c/Fulano'], ['https://www.youtube.com/user/Fulano', 'canal', 'user/Fulano'],
    ['https://vimeo.com/12345', null], ['javascript:alert(1)', null], ['https://youtube.com.evil.com/watch?v=7vw3rFRuvJ0', null],
    ['https://www.youtube.com/clip/UgkxAbc', null], ['https://youtu.be/corto', null], ['https://www.youtube.com/watch?v=7vw3rFRuvJ0"><x', null],
    ['', null], ['https://www.youtube.com/feed/trending', null],
    ['https://www.youtube.com/@NoticiasC%C3%BAcuta/live', 'canal', '@NoticiasCúcuta'], ['@CúcutaTV_ñ', 'canal', '@CúcutaTV_ñ'],
    ['https://www.youtube.com/@a%2Fb%3Fx', null], ['@ab cd', null]
  ];
  const malos = casos.filter(([u, tipo, ref]) => { const r = L(u); return tipo ? (r.error || r.tipo !== tipo || (ref.indexOf('@') === 0 || /^(c|user)\//.test(ref) ? r.ruta !== ref : r.ref !== ref)) : !r.error; });
  ctx.ok('R30', 'Enlaces de YouTube: ' + casos.length + ' formatos (videos, Shorts, en vivo, no listados, listas, canales) y rechazos', !malos.length, malos.map((m) => m[0] + ' → ' + JSON.stringify(L(m[0]))).join(' | '));
  const I = P.w.fgVideos.infoYoutube;
  const iv = await I('https://youtu.be/CCCCCCCCCC3');
  ctx.ok('R30', 'Título automático: se lee de YouTube con la miniatura oficial', iv.titulo === 'Título de YouTube CCCCCCCCCC3' && iv.miniatura === 'https://i.ytimg.com/vi/CCCCCCCCCC3/hqdefault.jpg', JSON.stringify(iv));
  let errPriv = '';
  try { await I('https://youtu.be/PRIVADO0001'); } catch (e) { errPriv = e.message; }
  ctx.ok('R30', 'Video privado o con la inserción desactivada: aviso claro', /privado/.test(errPriv) && /No listado/.test(errPriv), errPriv);
  const sr = await I('https://youtu.be/SINRED00001');
  ctx.ok('R30', 'Sin conexión con YouTube: deja escribir el título a mano', sr.ref === 'SINRED00001' && sr.titulo === '' && /a mano/.test(sr.aviso || ''));
  const ic = await I('https://www.youtube.com/@CamarasCucuta/live');
  ctx.ok('R30', 'Canal @usuario: se resuelve con la función youtube a su ID', ic.tipo === 'canal' && ic.ref === 'UC' + 'k'.repeat(22) && ic.titulo === 'Cámaras Cúcuta'
    && e1.log.some((l) => l[0] === 'fn' && l[1] === 'youtube' && l[2].ruta === '@CamarasCucuta'));

  await P.ir('Galería de videos');
  ctx.ok('R30', 'Galería: lista los videos en orden, con la marca demo', await esperar(() => P.$$('.tb tbody tr').length === 2) && /Cámara 1/.test(P.$$('.tb tbody tr')[0].textContent) && /demo/.test(P.$$('.tb tbody tr')[1].textContent));
  // Una fila sin enlace guardado (p. ej. cargada por SQL) se puede editar: el enlace se arma desde su ID
  P.$$('.tb tbody tr')[0].click();
  ctx.ok('R30', 'Editar un video sin enlace guardado: el formulario trae el enlace armado', await esperar(() => P.campo('Enlace de YouTube') && P.campo('Enlace de YouTube').value === 'https://www.youtube.com/watch?v=AAAAAAAAAA1'));
  P.boton('Guardar', P.$('.modal')).click();
  ctx.ok('R30', '…y se guarda sin pedir el enlace de nuevo', await esperar(() => !P.$('.modal') && (e1.tablas.videos.find((v) => v.id === 'vid-1') || {}).enlace === 'https://www.youtube.com/watch?v=AAAAAAAAAA1'));
  await esperar(() => !P.$$('.tb tbody tr.pend').length);
  const abrirAlta = async () => { P.boton('Agregar video').click(); return esperar(() => P.campo('Enlace de YouTube')); };
  await abrirAlta();
  P.escribir(P.campo('Enlace de YouTube'), 'https://www.youtube.com/watch?v=DDDDDDDDDD4&t=10s');
  ctx.ok('R30', 'Al pegar el enlace el título se llena solo y se ve la vista previa', await esperar(() => P.campo('Título').value === 'Título de YouTube DDDDDDDDDD4' && P.$('.fg-video-prev img'), 3000));
  P.escribir(P.campo('Título'), 'Cámara 3 en vivo');
  let soltarV;
  e1.pausa = new Promise((r) => { soltarV = r; });
  P.boton('Guardar', P.$('.modal')).click();
  const pendV = await esperar(() => !P.$('.modal') && P.$$('.tb tbody tr.pend').find((r) => /Cámara 3 en vivo/.test(r.textContent)));
  ctx.ok('R30', 'Guardar: la fila aparece al instante al final (optimista)', !!pendV && /Cámara 3 en vivo/.test(P.$$('.tb tbody tr').slice(-1)[0].textContent));
  soltarV(); e1.pausa = null;
  const nuevoV = await esperar(() => e1.tablas.videos.find((v) => v.ref === 'DDDDDDDDDD4'));
  ctx.ok('R30', 'Se guarda tipo, ID, título editado, miniatura, enlace y orden al final', !!nuevoV && nuevoV.tipo === 'video' && nuevoV.titulo === 'Cámara 3 en vivo' && nuevoV.orden === 30
    && nuevoV.miniatura === 'https://i.ytimg.com/vi/DDDDDDDDDD4/hqdefault.jpg' && nuevoV.enlace === 'https://www.youtube.com/watch?v=DDDDDDDDDD4&t=10s' && nuevoV.activo === true, JSON.stringify(nuevoV));
  await esperar(() => !P.$$('.tb tbody tr.pend').length);
  // Duplicado
  await abrirAlta();
  P.escribir(P.campo('Enlace de YouTube'), 'https://youtu.be/AAAAAAAAAA1');
  await esperar(() => P.campo('Título').value);
  P.boton('Guardar', P.$('.modal')).click();
  ctx.ok('R30', 'El mismo video dos veces: aviso "ya está en la galería"', await esperar(() => /ya está en la galería/.test((P.$('.toasts') || {}).textContent || '')) && !!P.$('.modal'));
  // Enlace no válido y video privado
  P.escribir(P.campo('Enlace de YouTube'), 'https://vimeo.com/123');
  ctx.ok('R30', 'Enlace que no es de YouTube: mensaje en el formulario', await esperar(() => /no es de YouTube/.test((P.$('.fg-video-err') || {}).textContent || '')));
  P.escribir(P.campo('Enlace de YouTube'), 'https://youtu.be/PRIVADO0001');
  ctx.ok('R30', 'Video privado: el formulario lo explica', await esperar(() => /privado/.test((P.$('.fg-video-err') || {}).textContent || '')));
  const nAntes = e1.tablas.videos.length;
  P.boton('Guardar', P.$('.modal')).click();
  await new Promise((r) => setTimeout(r, 150));
  ctx.ok('R30', 'Con un enlace no válido no se guarda nada', e1.tablas.videos.length === nAntes && !!P.$('.modal'));
  // Tras un error (p. ej. sin conexión), volver a pegar el mismo enlace lo consulta otra vez
  P.w.__permitir = true;
  P.escribir(P.campo('Enlace de YouTube'), '');
  P.escribir(P.campo('Enlace de YouTube'), 'https://youtu.be/PRIVADO0001');
  ctx.ok('R30', 'Volver a pegar el mismo enlace después de un error lo vuelve a consultar', await esperar(() => !P.$('.fg-video-err') && P.$('.fg-video-prev img'), 3000));
  P.w.__permitir = false;
  // Canal en vivo con @usuario
  P.escribir(P.campo('Enlace de YouTube'), 'https://www.youtube.com/@CamarasCucuta/live');
  await esperar(() => P.campo('Título').value === 'Cámaras Cúcuta');
  P.boton('Guardar', P.$('.modal')).click();
  const canalV = await esperar(() => e1.tablas.videos.find((v) => v.tipo === 'canal'));
  ctx.ok('R30', 'Canal en vivo: se guarda con su ID de canal (UC…)', !!canalV && canalV.ref === 'UC' + 'k'.repeat(22) && canalV.titulo === 'Cámaras Cúcuta', JSON.stringify(canalV));
  await esperar(() => P.$$('.tb tbody tr').length === 4 && !P.$$('.tb tbody tr.pend').length);
  // Ordenar: bajar el primero
  const fila1 = P.$$('.tb tbody tr')[0];
  const bajar = fila1.querySelector('button.act[title="Bajar"]');
  ctx.ok('R30', 'El primero no tiene "Subir" y sí "Bajar"; el último no tiene "Bajar"', !!bajar && !fila1.querySelector('button.act[title="Subir"]') && !P.$$('.tb tbody tr').slice(-1)[0].querySelector('button.act[title="Bajar"]'));
  bajar.click();
  ctx.ok('R30', 'Bajar: el cambio de orden se ve al instante', await esperar(() => /Cámara 2/.test(P.$$('.tb tbody tr')[0].textContent)));
  const ordenado = await esperar(() => { const a = e1.tablas.videos.find((v) => v.id === 'vid-1'), b = e1.tablas.videos.find((v) => v.id === 'vid-2'); return a.orden > b.orden && a; });
  ctx.ok('R30', 'Bajar: el nuevo orden llega a la base', !!ordenado, JSON.stringify(e1.tablas.videos.map((v) => v.titulo + ':' + v.orden)));
  await esperar(() => !P.$$('.tb tbody tr.pend').length);
  // Reversión si la base rechaza
  await abrirAlta();
  P.escribir(P.campo('Enlace de YouTube'), 'https://youtu.be/EEEEEEEEEE5');
  await esperar(() => P.campo('Título').value);
  e1.fallar = { videos: { code: '42501', message: 'rls' } };
  P.boton('Guardar', P.$('.modal')).click();
  const okR = await esperar(() => P.boton('Entendido'));
  ctx.ok('R30', 'Si la base rechaza: aviso, la fila se quita y el formulario se reabre con lo escrito', !!okR && !P.$$('.tb tbody tr').some((r) => /EEEEEEEEEE5/.test(r.textContent)) && !e1.tablas.videos.some((v) => v.ref === 'EEEEEEEEEE5'));
  if (okR) okR.click();
  ctx.ok('R30', 'El formulario reabierto conserva el enlace', await esperar(() => P.campo('Enlace de YouTube') && P.campo('Enlace de YouTube').value === 'https://youtu.be/EEEEEEEEEE5'));
  const cv = P.boton('Cancelar', P.$('.modal')); if (cv) cv.click();
  delete e1.fallar;
  // Quitar
  const filaQ = await esperar(() => P.$$('.tb tbody tr').find((r) => /Cámara 3 en vivo/.test(r.textContent)));
  filaQ.querySelector('button.act[title="Quitar"]').click();
  const siQ = await esperar(() => P.boton('Sí, quitar'));
  if (siQ) siQ.click();
  ctx.ok('R30', 'Quitar: confirma y el video sale de la galería y de la base', !!siQ && await esperar(() => !e1.tablas.videos.some((v) => v.ref === 'DDDDDDDDDD4') && !P.$$('.tb tbody tr').some((r) => /Cámara 3 en vivo/.test(r.textContent))));

  // ---------- R26/R27: configuración y usuarios (admin) ----------
  await P.ir('Configuración');
  ctx.ok('R27', 'Configuración: botones Cargar y Borrar datos demo', !!P.boton('Cargar datos demo') && !!P.boton('Borrar datos demo'));
  ctx.ok('R27', 'Configuración: cuenta también los videos demo', await esperar(() => /1 videos demo/.test(P.d.body.textContent)));
  await P.ir('Usuarios');
  ctx.ok('R26', 'Usuarios: el administrador ve la lista y "Nuevo usuario"', await esperar(() => P.$$('.tb tbody tr').length === 1) && !!P.boton('Nuevo usuario'));
  ctx.ok('', 'Sin errores de React en las pantallas del administrador', !(P.w.__uiErrors || []).length && !P.errores.length, (P.w.__uiErrors || []).concat(P.errores).join(' | ').slice(0, 300));

  // Cerrar sesión
  const av = P.$('.top .avatar');
  if (av) av.click();
  const salirB = await esperar(() => P.boton('Cerrar sesión'));
  if (salirB) salirB.click();
  ctx.ok('R16', 'Cerrar sesión vuelve a la pantalla de ingreso', await esperar(() => P.$('.login-card')));

  // ---------- R26: editor ----------
  const e2 = estadoBase();
  const E = await abrirPanel(e2);
  await E.entrar('editor@x.co', 'Clave12345x');
  await esperar(() => E.$$('.sb-nav .sb-item').length);
  const menu = E.$$('.sb-nav .sb-item').map((x) => x.textContent.trim());
  ctx.ok('R26', 'Editor: no ve Usuarios ni Configuración', menu.length === 6 && menu.indexOf('Usuarios') < 0 && menu.indexOf('Configuración') < 0, menu.join(','));
  await E.ir('Galería de videos');
  ctx.ok('R30', 'Editor: maneja la galería de videos (puede agregar, ordenar y quitar)', await esperar(() => E.boton('Agregar video') && E.$$('.tb tbody tr').length === 2 && E.$('button.act[title="Bajar"]') && E.$('button.act[title="Quitar"]')));
  await E.ir('Categorías');
  ctx.ok('R26', 'Editor: Categorías es solo de lectura', await esperar(() => /Solo el administrador puede crear o cambiar categorías/.test(E.d.body.textContent)) && !E.$('button[data-primary]'));
  await E.ir('Negocios');
  ctx.ok('R26', 'Editor: sí puede crear negocios', await esperar(() => E.$('button[data-primary]')));
  ctx.ok('', 'Sin errores de React en las pantallas del editor', !(E.w.__uiErrors || []).length && !E.errores.length);
};
