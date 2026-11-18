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
      categorias: cats, negocios: negs, ofertas: []
    },
    rpc: {
      panel_resumen: { activos: 3, inactivos: 0, destacados: 1, por_vencer: 1, vencidos: 2, demo: 1, ofertas: 0, categorias: 2, hoy: '2026-11-17',
        proximos: [{ id: 'n1', nombre: 'Negocio 1', destacado_hasta: '2026-11-20' }] }
    },
    funciones: (b) => (b.accion === 'listar' ? { usuarios: [{ user_id: 'u-admin', email: 'admin@x.co', rol: 'admin', nombre: 'Ana Admin' }] } : { ok: true })
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
  ctx.ok('R16', 'Administrador: entra y ve el menú', await esperar(() => P.$$('.sb-nav .sb-item').length === 7), P.$$('.sb-nav .sb-item').map((x) => x.textContent).join(','));

  // ---------- R21: KPIs ----------
  const kpis = await esperar(() => P.$$('.kpi').length === 6 && P.$$('.kpi'));
  const txt = kpis ? kpis.map((k) => k.textContent.replace(/\s+/g, ' ')).join(' | ') : '';
  ctx.ok('R21', 'Inicio: KPIs de activos, destacados vigentes, por vencer y vencidos', /3\s*Negocios activos/.test(txt) && /1\s*Destacados vigentes/.test(txt) && /1\s*Destacados por vencer/.test(txt) && /2\s*Destacados vencidos/.test(txt), txt);
  ctx.ok('R21', 'Inicio: lista de destacados que vencen en 7 días', /Negocio 1/.test((P.$('.feed') || {}).textContent || ''));
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

  // ---------- R26/R27: configuración y usuarios (admin) ----------
  await P.ir('Configuración');
  ctx.ok('R27', 'Configuración: botones Cargar y Borrar datos demo', !!P.boton('Cargar datos demo') && !!P.boton('Borrar datos demo'));
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
  ctx.ok('R26', 'Editor: no ve Usuarios ni Configuración', menu.length === 5 && menu.indexOf('Usuarios') < 0 && menu.indexOf('Configuración') < 0, menu.join(','));
  await E.ir('Categorías');
  ctx.ok('R26', 'Editor: Categorías es solo de lectura', await esperar(() => /Solo el administrador puede crear o cambiar categorías/.test(E.d.body.textContent)) && !E.$('button[data-primary]'));
  await E.ir('Negocios');
  ctx.ok('R26', 'Editor: sí puede crear negocios', await esperar(() => E.$('button[data-primary]')));
  ctx.ok('', 'Sin errores de React en las pantallas del editor', !(E.w.__uiErrors || []).length && !E.errores.length);
};
