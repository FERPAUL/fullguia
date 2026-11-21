// Humo de interfaz del sitio público en jsdom, con Supabase simulado (fetch falso).
// Cubre: pintado con plantillas, caché stale-while-revalidate, límites de localStorage, errores de red,
// categoría (A-Z + destacados + paginación), detalle, favoritos, "Publica tu negocio" y la galería de videos (R31).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const XSS = '<img src=x onerror="window.__xss=1">';
function neg(i, o) {
  return Object.assign({
    id: 'id-' + i, nombre: 'Negocio ' + i, slug: 'negocio-' + i, categoria: 'Hoteles', categoria_slug: 'hoteles', categoria_icono: 'hoteles',
    etiqueta: 'Hotel', etiqueta_tono: 'azul', ciudad: 'Cúcuta', direccion: 'Calle ' + i, whatsapp: null, telefono: null,
    precio_desde: null, precio_label: 'Desde', amenidades: [], imagen: 'https://images.unsplash.com/photo-' + i + '?w=1200',
    imagen_mini: 'https://images.unsplash.com/photo-' + i + '?w=400', logo: null, rating: 4.5, num_opiniones: 10, destacado: false
  }, o || {});
}
const CATS = ['comidas', 'hoteles', 'salud', 'vehiculos', 'hogar', 'tecnologia', 'educacion'].map((s, i) => ({ id: 'c' + i, nombre: s[0].toUpperCase() + s.slice(1), slug: s, icono: s, color: ['orange', 'blue', 'green', 'purple', 'yellow', 'cyan', 'red'][i] }));
const inicio = (v, pref) => ({
  version: v, categorias: CATS,
  destacados: [1, 2, 3, 4, 5, 6].map((i) => neg(i, { nombre: (pref || 'Destacado ') + i, destacado: true, logo: i === 1 ? 'logos/2026/x-logo.webp' : null })).concat([]),
  ofertas: [1, 2, 3, 4].map((i) => ({ id: 'o' + i, titulo: 'Oferta ' + i, descuento: '-' + i + '0%', imagen: 'ofertas/2026/o' + i + '-g.webp', imagen_mini: 'ofertas/2026/o' + i + '-m.webp', negocio: 'Negocio ' + i, negocio_slug: 'negocio-' + i })),
  videos: VIDEOS
});
// Galería: 4 válidos (video, lista, canal en vivo, título con HTML) + 3 inválidos que deben descartarse
const VIDEOS = [
  { id: 'v1', tipo: 'video', ref: 'AAAAAAAAAA1', titulo: 'Cámara 1 en vivo', miniatura: 'https://i.ytimg.com/vi/AAAAAAAAAA1/hqdefault.jpg' },
  { id: 'v2', tipo: 'lista', ref: 'PLlistaDePrueba123', titulo: 'Lista de turismo', miniatura: 'https://i.ytimg.com/vi/BBBBBBBBBB2/hqdefault.jpg' },
  { id: 'v3', tipo: 'canal', ref: 'UC' + 'c'.repeat(22), titulo: 'Canal en vivo', miniatura: 'https://yt3.googleusercontent.com/avatar=s900' },
  { id: 'v4', tipo: 'video', ref: 'CCCCCCCCCC4', titulo: XSS, miniatura: 'javascript:alert(1)' },
  { id: 'm1', tipo: 'video', ref: 'corto', titulo: 'ID inválido' },
  { id: 'm2', tipo: 'video', ref: 'DDDDDDDDDD5"><script>', titulo: 'ID con HTML' },
  { id: 'm3', tipo: 'vimeo', ref: '12345678901', titulo: 'Otro sitio' }
];

module.exports = async function (ctx) {
  const PUB = path.join(ctx.RAIZ, 'public');
  const cfgJs = fs.readFileSync(path.join(PUB, 'js', 'config.js'), 'utf8');
  const fgJs = fs.readFileSync(path.join(PUB, 'js', 'fullguia.js'), 'utf8');

  // Abre una página con respuestas simuladas. guardado = copia de localStorage de una visita anterior.
  async function abrir(archivo, query, respuestas, o) {
    o = o || {};
    const html = fs.readFileSync(path.join(PUB, archivo), 'utf8');
    const dom = new JSDOM(o.html ? o.html(html) : html, { url: 'http://localhost/' + archivo + (query || ''), runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    const llamadas = [];
    w.__abiertos = [];
    w.open = (u) => { w.__abiertos.push(u); return null; };
    w.HTMLElement.prototype.scrollIntoView = function () { w.__scroll = this.id; };
    if (o.ahorroDatos) Object.defineProperty(w.navigator, 'connection', { value: { saveData: true } });
    // IntersectionObserver simulado: w.__io(true|false) dice si la galería está en pantalla
    if (o.io) w.IntersectionObserver = function (cb) { this.observe = () => { w.__io = (si) => cb([{ isIntersecting: si }]); }; };
    if (o.sinStorage) Object.defineProperty(w, 'localStorage', { get() { throw new Error('bloqueado'); } });
    else if (o.guardado) Object.entries(o.guardado).forEach(([k, v]) => w.localStorage.setItem(k, v));
    const sincrono = { tarjetas: -1 };
    w.fetch = async (url, init) => {
      const u = new URL(String(url));
      const fn = u.pathname.split('/rpc/')[1];
      // Los parámetros viajan en la URL (GET). Los números se convierten y lo omitido queda en null.
      const body = { q: null, cat: null };
      u.searchParams.forEach((v, k) => { if (k !== 'apikey') body[k] = /^(pagina|por_pagina)$/.test(k) ? Number(v) : v; });
      // Lo que ya está pintado cuando sale la primera petición = lo que se ve antes de que responda el servidor
      if (!llamadas.length) sincrono.tarjetas = w.document.querySelectorAll('#fg-destacados .business-card:not(.fg-sk-card)').length;
      llamadas.push({ fn, body, apikey: u.searchParams.get('apikey'), metodo: (init && init.method) || 'GET', headers: (init && init.headers) || {} });
      if (o.redCaida) throw new TypeError('Failed to fetch');
      const r = typeof respuestas === 'function' ? respuestas(fn, body) : respuestas[fn];
      if (r === undefined) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(r)) };
    };
    w.eval(cfgJs.replace("WHATSAPP_FULLGUIA: ''", "WHATSAPP_FULLGUIA: '" + (o.waFullguia || '') + "'"));
    w.eval(fgJs);
    await w.FG.listo;
    await new Promise((r) => setTimeout(r, 20));
    const storage = {};
    if (!o.sinStorage) for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); storage[k] = w.localStorage.getItem(k); }
    return { w, d: w.document, llamadas, storage, sincrono };
  }
  const $$ = (d, s) => Array.from(d.querySelectorAll(s));

  // ================= INICIO =================
  const datos = inicio('7-20261117');
  datos.destacados[1].nombre = XSS;
  const A = await abrir('index.html', '', { pagina_inicio: datos, version_datos: '7-20261117' });
  const cards = $$(A.d, '#fg-destacados .business-card');
  ctx.ok('R11', 'Inicio: pinta 4 destacados (primer grupo)', cards.length === 4, cards.length);
  ctx.ok('R11', 'Inicio: una sola llamada al servidor (pagina_inicio)', A.llamadas.length === 1 && A.llamadas[0].fn === 'pagina_inicio', A.llamadas.map((x) => x.fn).join(','));
  ctx.ok('R5', 'Inicio: la petición usa la publishable key de config.js', /^sb_publishable_/.test(A.llamadas[0].apikey) && !A.llamadas[0].headers.Authorization);
  ctx.ok('R14', 'Las consultas son GET sin cabeceras propias (sin consulta previa de CORS)', A.llamadas.every((x) => x.metodo === 'GET' && !Object.keys(x.headers).length));
  ctx.ok('R13', 'Texto con HTML malicioso se muestra como texto (no se ejecuta)',
    !A.w.__xss && $$(A.d, '#fg-destacados img[src="x"]').length === 0 && A.d.getElementById('fg-destacados').textContent.indexOf('<img') >= 0);
  ctx.ok('R11', 'Inicio: los destacados enlazan a su detalle', cards[0].querySelector('a[data-f~="enlace"]').getAttribute('href') === 'negocio.html?slug=negocio-1');
  ctx.ok('R11', 'Inicio: 8 accesos de categoría (7 + "Más categorías")', $$(A.d, '#fg-categorias .category-card').length === 8 && $$(A.d, '#fg-categorias svg').length === 8);
  ctx.ok('R11', 'Inicio: el buscador lista las 7 categorías', A.d.getElementById('fg-cat').options.length === 8);
  ctx.ok('R11', 'Inicio: 4 ofertas que llevan al negocio', $$(A.d, '#fg-ofertas .offer-card').length === 4 && $$(A.d, '#fg-ofertas a[href^="negocio.html?slug="]').length === 4);
  ctx.ok('R11', 'Inicio: las fotos de Storage se convierten en URL pública', ($$(A.d, '#fg-ofertas img')[0].getAttribute('src') || '').indexOf('/storage/v1/object/public/negocios/ofertas/2026/o1-m.webp') > 0);
  const dots = $$(A.d, '#fg-dots .dot');
  ctx.ok('R11', 'Inicio: puntos de paginación de destacados (6 → 2 grupos)', dots.length === 2 && dots[0].classList.contains('active'));
  dots[1].dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
  ctx.ok('R11', 'Inicio: al tocar el 2.º punto se ven los destacados 5 y 6', $$(A.d, '#fg-destacados .business-title').map((x) => x.textContent).join('|') === 'Destacado 5|Destacado 6');
  ctx.ok('R11', 'Inicio: se quitan los esqueletos de carga', $$(A.d, '.fg-sk-card, .fg-sk-oferta').length === 0);
  // R15
  const img = A.d.querySelector('#fg-ofertas img');
  ctx.ok('R15', 'Imágenes con loading="lazy", ancho/alto fijos y srcset mini/grande',
    img.getAttribute('loading') === 'lazy' && img.getAttribute('width') && img.getAttribute('height') && /400w.*1200w/.test(img.getAttribute('srcset') || ''), img.getAttribute('srcset'));
  ctx.ok('R15', 'Todas las imágenes de tarjetas tienen width/height (sin saltos de diseño)', $$(A.d, '#fg-destacados img, #fg-ofertas img').every((i) => i.getAttribute('width') && i.getAttribute('height')));

  // ================= GALERÍA DE VIDEOS (R31) =================
  const G0 = A.w.FG.galeria;
  const slides = $$(A.d, '#fg-pista .fg-slide');
  ctx.ok('R31', 'Galería: una diapositiva por video válido; los inválidos se descartan', slides.length === 4 && G0.estado().total === 4, slides.length);
  ctx.ok('R31', 'Galería: el orden es el del panel', slides.map((x) => x.getAttribute('data-ref')).join(',') === 'AAAAAAAAAA1,PLlistaDePrueba123,UC' + 'c'.repeat(22) + ',CCCCCCCCCC4');
  ctx.ok('R13', 'Galería: un título con HTML se muestra como texto', !A.w.__xss && slides[3].querySelector('[data-f="titulo"]').textContent === XSS && $$(A.d, '#fg-pista img[src="x"]').length === 0);
  ctx.ok('R31', 'Galería: miniatura no segura se cambia por la oficial de YouTube', slides[3].querySelector('img').getAttribute('src') === 'https://i.ytimg.com/vi/CCCCCCCCCC4/hqdefault.jpg');
  ctx.ok('R31', 'Galería: el canal muestra su foto y la marca EN VIVO', slides[2].classList.contains('fg-slide-canal') && !slides[2].querySelector('[data-f="vivo"]').hidden && slides[0].querySelector('[data-f="vivo"]').hidden);
  ctx.ok('R15', 'Galería: la primera miniatura carga con prioridad y las demás en diferido', slides[0].querySelector('img').getAttribute('fetchpriority') === 'high' && slides[1].querySelector('img').getAttribute('loading') === 'lazy'
    && slides.every((x) => x.querySelector('img').getAttribute('width') && x.querySelector('img').getAttribute('height')));
  ctx.ok('R31', 'Galería: contador 1 / 4, 4 puntos y flechas (anterior desactivada)', A.d.getElementById('fg-gal-contador').textContent === '1 / 4' && $$(A.d, '#fg-gal-puntos .dot').length === 4
    && !A.d.querySelector('.fg-gal-ant').hidden && A.d.querySelector('.fg-gal-ant').disabled && !A.d.querySelector('.fg-gal-sig').disabled);
  ctx.ok('R31', 'Galería: solo la diapositiva del frente se enfoca (las demás inert)', !slides[0].hasAttribute('inert') && slides.slice(1).every((x) => x.hasAttribute('inert')));
  const iframes = () => $$(A.d, '#fg-pista iframe');
  await new Promise((r) => setTimeout(r, 350));
  const f0 = iframes()[0];
  ctx.ok('R31', 'Galería: el video del frente arranca solo (un solo reproductor)', iframes().length === 1 && slides[0].contains(f0));
  ctx.ok('R31', 'Galería: arranca en silencio, en línea y con la API para controlar el sonido',
    !!f0 && /^https:\/\/www\.youtube-nocookie\.com\/embed\/AAAAAAAAAA1\?autoplay=1&playsinline=1&rel=0&enablejsapi=1&mute=1/.test(f0.getAttribute('src')), f0 && f0.getAttribute('src'));
  ctx.ok('R31', 'Galería: el reproductor permite autoplay y pantalla completa, y envía el referer que pide YouTube',
    !!f0 && /autoplay/.test(f0.getAttribute('allow')) && f0.hasAttribute('allowfullscreen') && f0.getAttribute('referrerpolicy') === 'strict-origin-when-cross-origin');
  ctx.ok('R31', 'Galería: capa táctil encima del video (se puede deslizar sobre él)', !!slides[0].querySelector('.fg-capa'));
  const btnS = A.d.getElementById('fg-sonido');
  ctx.ok('R31', 'Galería: botón visible "Activar sonido" mientras está en silencio', !btnS.hidden && /Activar sonido/.test(btnS.textContent) && btnS.getAttribute('aria-pressed') === 'false');
  // Comandos que recibe el reproductor
  const cmds = [];
  const espiar = (fr) => { fr.contentWindow.postMessage = (m, o) => { const j = JSON.parse(m); cmds.push(j.func || j.event); cmds.origen = o; }; };
  espiar(f0);
  const desdeYT = (fr, data, origen) => A.w.dispatchEvent(new A.w.MessageEvent('message', { data: JSON.stringify(data), origin: origen || 'https://www.youtube-nocookie.com', source: fr.contentWindow }));
  desdeYT(f0, { event: 'onReady' });
  ctx.ok('R31', 'Galería: al estar listo, el reproductor queda en silencio hasta el primer toque', cmds.join(',') === 'mute' && cmds.origen === 'https://www.youtube-nocookie.com', cmds.join(','));
  A.d.querySelector('.hero-title').dispatchEvent(new A.w.Event('pointerdown', { bubbles: true }));
  ctx.ok('R31', 'Galería: el primer toque en la página activa el sonido del video del frente', G0.estado().sonido && cmds.slice(-2).join(',') === 'unMute,playVideo' && /Silenciar/.test(btnS.textContent), cmds.join(','));
  btnS.dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
  ctx.ok('R31', 'Galería: el botón silencia y vuelve a activar el sonido', cmds[cmds.length - 1] === 'mute' && /Activar sonido/.test(btnS.textContent) && !G0.estado().sonido);
  btnS.dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
  ctx.ok('R31', 'Galería: segundo clic en el botón → con sonido', cmds.slice(-2).join(',') === 'unMute,playVideo' && G0.estado().sonido);
  const nCmds = cmds.length;
  desdeYT(f0, { event: 'onReady' }, 'https://evil.com');
  desdeYT(f0, { event: 'infoDelivery', info: { muted: true } }, 'https://evil.com');
  ctx.ok('R13', 'Galería: se ignoran mensajes que no vienen de YouTube', cmds.length === nCmds && G0.estado().sonido);
  // Siguiente con la flecha
  A.d.querySelector('.fg-gal-sig').dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
  const f1 = iframes()[0];
  ctx.ok('R31', 'Flecha siguiente: pasa al 2.º video y quita el reproductor anterior (su audio se corta)', G0.estado().activo === 1 && iframes().length === 1 && slides[1].contains(f1) && !f0.isConnected && !slides[0].querySelector('.fg-capa'));
  ctx.ok('R31', 'Una lista de reproducción se inserta como videoseries', /\/embed\/videoseries\?list=PLlistaDePrueba123&autoplay=1/.test(f1.getAttribute('src')), f1.getAttribute('src'));
  ctx.ok('R31', 'Al pasar de video se actualizan contador, punto activo y título', A.d.getElementById('fg-gal-contador').textContent === '2 / 4' && A.d.querySelectorAll('#fg-gal-puntos .dot')[1].classList.contains('active')
    && A.d.getElementById('fg-gal-titulo').textContent === 'Lista de turismo' && slides[0].hasAttribute('inert') && !slides[1].hasAttribute('inert'));
  espiar(f1);
  cmds.length = 0;
  desdeYT(f1, { event: 'onReady' });
  ctx.ok('R31', 'El video siguiente suena si el visitante ya activó el sonido', cmds.join(',') === 'unMute,playVideo', cmds.join(','));
  A.d.getElementById('fg-galeria').dispatchEvent(new A.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const f2 = iframes()[0];
  ctx.ok('R31', 'Teclado → : canal en vivo con live_stream?channel=', G0.estado().activo === 2 && /\/embed\/live_stream\?channel=UCc{22}&/.test(f2.getAttribute('src')), f2.getAttribute('src'));
  A.d.getElementById('fg-galeria').dispatchEvent(new A.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  ctx.ok('R31', 'Teclado ← : vuelve al anterior', G0.estado().activo === 1);
  A.d.querySelectorAll('#fg-gal-puntos .dot')[3].dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
  ctx.ok('R31', 'Punto 4: salta al último video; la flecha siguiente queda desactivada', G0.estado().activo === 3 && A.d.querySelector('.fg-gal-sig').disabled && iframes().length === 1);
  // Al terminar un video pasa solo al siguiente (y del último vuelve al primero)
  const f3 = iframes()[0];
  desdeYT(f3, { event: 'infoDelivery', info: { playerState: 0 } });
  ctx.ok('R31', 'Al terminar un video pasa solo al siguiente (del último vuelve al primero)', G0.estado().activo === 0 && iframes().length === 1 && slides[0].contains(iframes()[0]));
  // Pausa tocando el video (la capa), sin confundirlo con el primer toque
  const f4 = iframes()[0];
  espiar(f4);
  cmds.length = 0;
  desdeYT(f4, { event: 'infoDelivery', info: { playerState: 1 } });
  await new Promise((r) => setTimeout(r, 650));   // pasado el primer toque
  slides[0].querySelector('.fg-capa').dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
  ctx.ok('R31', 'Tocar el video lo pausa', cmds[cmds.length - 1] === 'pauseVideo', cmds.join(','));
  // Repintar con los mismos datos (revalidación de la caché) no reinicia el video que suena
  G0.pintar(JSON.parse(JSON.stringify(VIDEOS)));
  ctx.ok('R12', 'Galería: repintar con los mismos datos no reinicia el video', iframes()[0] === f4 && f4.isConnected);
  G0.pintar([VIDEOS[2], VIDEOS[0]]);
  ctx.ok('R31', 'Galería: si cambian los videos se rehace y sigue en el mismo video', G0.estado().total === 2 && G0.estado().activo === 1 && $$(A.d, '#fg-pista .fg-slide')[1].getAttribute('data-ref') === 'AAAAAAAAAA1');
  // El navegador no deja activar el sonido (p. ej. un deslizamiento no cuenta como toque): se refleja y se reintenta
  const bloq = await abrir('index.html', '', { pagina_inicio: datos });
  await new Promise((r) => setTimeout(r, 350));
  const fb = bloq.d.querySelector('#fg-pista iframe');
  const cb = [];
  fb.contentWindow.postMessage = (m) => { const j = JSON.parse(m); cb.push(j.func || j.event); };
  bloq.d.querySelector('.hero-title').dispatchEvent(new bloq.w.Event('pointerdown', { bubbles: true }));
  bloq.w.dispatchEvent(new bloq.w.MessageEvent('message', { data: JSON.stringify({ event: 'infoDelivery', info: { muted: true } }), origin: 'https://www.youtube-nocookie.com', source: fb.contentWindow }));
  await new Promise((r) => setTimeout(r, 1750));
  const eb = bloq.w.FG.galeria.estado();
  ctx.ok('R31', 'Si el navegador no deja sonar: el botón vuelve a "Activar sonido" (refleja lo que dice YouTube)', !eb.sonido && eb.muted === true && /Activar sonido/.test(bloq.d.getElementById('fg-sonido').textContent), JSON.stringify(eb));
  cb.length = 0;
  bloq.d.querySelector('.hero-title').dispatchEvent(new bloq.w.Event('pointerdown', { bubbles: true }));
  ctx.ok('R31', '…y el siguiente toque vuelve a intentar activar el sonido', cb.join(',') === 'unMute,playVideo' && bloq.w.FG.galeria.estado().sonido, cb.join(','));
  // La galería fuera de la pantalla: no arranca hasta que el visitante llega a ella, y se pausa al salir
  const fuera = await abrir('index.html', '', { pagina_inicio: datos }, { io: true });
  fuera.w.__io(false);
  await new Promise((r) => setTimeout(r, 350));
  ctx.ok('R31', 'Galería fuera de pantalla: no carga el reproductor', !fuera.d.querySelector('#fg-pista iframe'));
  fuera.w.__io(true);
  const ff = fuera.d.querySelector('#fg-pista iframe');
  ctx.ok('R31', 'Al llegar a la galería, el video arranca', !!ff);
  const cf = [];
  if (ff) ff.contentWindow.postMessage = (m) => { cf.push(JSON.parse(m).func); };
  fuera.w.__io(false);
  fuera.w.__io(true);
  ctx.ok('R31', 'Al salir de la pantalla se pausa y al volver sigue', cf.join(',') === 'pauseVideo,playVideo', cf.join(','));
  // Hallazgos de /code-review (regresión)
  cf.length = 0;
  fuera.w.dispatchEvent(new fuera.w.MessageEvent('message', { data: JSON.stringify({ event: 'infoDelivery', info: { playerState: 2 } }), origin: 'https://www.youtube-nocookie.com', source: ff.contentWindow }));
  fuera.w.__io(false);
  fuera.w.__io(true);
  ctx.ok('R31', 'Un video que el visitante pausó no vuelve a sonar solo al regresar a la galería', cf.join(',') === 'pauseVideo', cf.join(','));
  const busca = await abrir('index.html', '', { pagina_inicio: datos });
  await new Promise((r) => setTimeout(r, 350));
  busca.d.getElementById('fg-q').dispatchEvent(new busca.w.Event('pointerdown', { bubbles: true }));
  busca.d.getElementById('fg-q').dispatchEvent(new busca.w.KeyboardEvent('keydown', { key: 'h', bubbles: true }));
  busca.d.querySelector('a[href]').dispatchEvent(new busca.w.Event('pointerdown', { bubbles: true }));
  ctx.ok('R31', 'Escribir en el buscador o tocar un enlace no enciende el sonido', !busca.w.FG.galeria.estado().sonido && !busca.w.FG.galeria.estado().gesto);
  busca.d.querySelector('.hero-title').dispatchEvent(new busca.w.Event('pointerdown', { bubbles: true }));
  ctx.ok('R31', '…pero un toque en la página sí', busca.w.FG.galeria.estado().sonido);
  // Visitante que toca ▶ antes de que la galería arranque, y llegan datos nuevos: su video sigue
  const temprano = await abrir('index.html', '', { pagina_inicio: datos }, { ahorroDatos: true });
  const g = temprano.w.FG.galeria;
  g.pintar([VIDEOS[0], VIDEOS[1]]);
  temprano.d.querySelector('#fg-pista .fg-slide .fg-video').dispatchEvent(new temprano.w.MouseEvent('click', { bubbles: true }));
  g.pintar([VIDEOS[0], Object.assign({}, VIDEOS[1], { titulo: 'Título cambiado en el panel' })]);
  const fi = temprano.d.querySelector('#fg-pista iframe');
  ctx.ok('R31', 'Si llegan datos nuevos mientras suena un video que el visitante abrió, el video sigue', !!fi && /AAAAAAAAAA1/.test(fi.getAttribute('src')));
  const rara = await abrir('index.html', '', {}, { redCaida: true, html: (h) => h.replace('<div class="fg-slide" data-tipo="video" data-ref="7vw3rFRuvJ0"', '<div class="fg-slide" data-tipo="video" data-ref="malo"></div><div class="fg-slide" data-tipo="video" data-ref="7vw3rFRuvJ0"') });
  ctx.ok('R31', 'Una diapositiva inválida escrita en la página (Dreamweaver) no rompe la galería', rara.w.FG.galeria.estado().total === 1 && rara.d.getElementById('fg-gal-titulo').textContent === 'Descubre lo mejor de nuestra región');
  // Casos límite
  const una = await abrir('index.html', '', { pagina_inicio: Object.assign(inicio('1'), { videos: [VIDEOS[0]] }) });
  ctx.ok('R31', 'Con 1 video: sin flechas, puntos ni contador', una.d.querySelector('.fg-gal-ant').hidden && una.d.querySelector('.fg-gal-sig').hidden && !una.d.querySelectorAll('#fg-gal-puntos .dot').length && una.d.getElementById('fg-gal-contador').textContent === '');
  const cero = await abrir('index.html', '', { pagina_inicio: Object.assign(inicio('1'), { videos: [] }) });
  await new Promise((r) => setTimeout(r, 300));
  ctx.ok('R31', 'Sin videos: mensaje "Pronto verás videos aquí", sin reproductor ni controles', /Pronto verás videos aquí/.test(cero.d.getElementById('fg-galeria').textContent) && !cero.d.querySelector('#fg-pista iframe') && cero.d.querySelector('.fg-gal-sig').hidden && cero.d.getElementById('fg-sonido').hidden);
  const vieja = await abrir('index.html', '', { pagina_inicio: (() => { const x = inicio('1'); delete x.videos; return x; })() });
  ctx.ok('R31', 'Respuesta sin videos (versión anterior de la base): queda el video escrito en la página', $$(vieja.d, '#fg-pista .fg-slide').length === 1 && vieja.d.querySelector('#fg-pista .fg-slide').getAttribute('data-ref') === '7vw3rFRuvJ0');
  const muchos = await abrir('index.html', '', { pagina_inicio: Object.assign(inicio('1'), { videos: Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, tipo: 'video', ref: ('Vid' + i).padEnd(11, 'q'), titulo: 'Video ' + i })) }) });
  ctx.ok('R31', 'Sin límite: 30 videos → 30 diapositivas; con más de 15 se usa solo el contador', $$(muchos.d, '#fg-pista .fg-slide').length === 30 && !muchos.d.querySelectorAll('#fg-gal-puntos .dot').length && muchos.d.getElementById('fg-gal-contador').textContent === '1 / 30');
  const ahorro = await abrir('index.html', '', { pagina_inicio: datos }, { ahorroDatos: true });
  await new Promise((r) => setTimeout(r, 350));
  ctx.ok('R31', 'Con "ahorro de datos" no hay autoplay: se ve la miniatura con ▶', !ahorro.d.querySelector('#fg-pista iframe'));
  ahorro.d.querySelector('#fg-pista .fg-slide .fg-video').dispatchEvent(new ahorro.w.MouseEvent('click', { bubbles: true }));
  ctx.ok('R31', 'Tocar ▶ carga el video y pide el sonido', !!ahorro.d.querySelector('#fg-pista iframe') && ahorro.w.FG.galeria.estado().sonido);
  // Buscador
  let destino = '';
  A.w.__fgNavegar = (u) => { destino = u; };
  A.d.getElementById('fg-q').value = '  hotel cúcuta ';
  A.d.getElementById('fg-cat').value = 'hoteles';
  A.d.getElementById('fg-buscador').dispatchEvent(new A.w.Event('submit', { cancelable: true }));
  ctx.ok('R11', 'Buscador del inicio: lleva a categoria.html con la búsqueda', destino === 'categoria.html?cat=hoteles&q=hotel%20c%C3%BAcuta', destino);
  // Favoritos
  const fav = A.d.querySelector('#fg-destacados .business-fav-btn');
  fav.dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
  ctx.ok('', 'Favoritos: el corazón se marca y se recuerda', fav.querySelector('svg').getAttribute('fill') === 'currentColor' && /negocio-5/.test(A.w.localStorage.getItem('fg_v1_favs') || ''));
  const perfil = A.d.querySelector('.icon-btn[aria-label="Mi Perfil"]');
  perfil.dispatchEvent(new A.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  ctx.ok('', '"Mi Perfil" no se comporta como favorito (no cambia su ícono)', perfil.querySelector('svg').getAttribute('fill') === 'none');
  ctx.ok('R16', '"Mi Perfil" lleva al panel admin en la misma dirección (admin/)', destino === 'admin/', destino);
  // Publicar
  A.d.querySelector('[data-fg="publicar"]').dispatchEvent(new A.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  ctx.ok('R28', '"Publica tu negocio" sin WhatsApp configurado: lleva a la sección de planes', A.w.__abiertos.length === 0 && A.w.__scroll === 'publicar');
  const W = await abrir('index.html', '', { pagina_inicio: datos }, { waFullguia: '300 123 4567' });
  W.d.querySelector('[data-fg="publicar"]').dispatchEvent(new W.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  ctx.ok('R28', '"Publica tu negocio" con WhatsApp: abre wa.me con +57', /^https:\/\/wa\.me\/573001234567\?text=/.test(W.w.__abiertos[0] || ''), W.w.__abiertos[0]);

  // ================= CACHÉ (R12) =================
  const claves = Object.keys(A.storage).filter((k) => k.indexOf('fg_v1_pagina_inicio') === 0);
  ctx.ok('R12', 'La vista queda guardada con clave versionada fg_v1_*', claves.length === 1, claves[0]);
  const B = await abrir('index.html', '', { pagina_inicio: inicio('7-20261117', 'OTRO '), version_datos: '7-20261117' }, { guardado: A.storage });
  ctx.ok('R12', 'Segunda visita: pinta al instante desde la caché (antes de responder el servidor)', B.sincrono.tarjetas === 4, B.sincrono.tarjetas);
  ctx.ok('R12', 'Misma versión: solo pregunta version_datos (no vuelve a pedir la vista)', B.llamadas.map((x) => x.fn).join(',') === 'version_datos', B.llamadas.map((x) => x.fn).join(','));
  ctx.ok('R12', 'Misma versión: se mantiene lo guardado', B.d.querySelector('#fg-destacados .business-title').textContent === 'Destacado 1');
  const C = await abrir('index.html', '', { pagina_inicio: inicio('8-20261117', 'NUEVO '), version_datos: '8-20261117' }, { guardado: A.storage });
  ctx.ok('R12', 'Versión distinta: vuelve a pedir la vista y repinta', C.llamadas.map((x) => x.fn).join(',') === 'version_datos,pagina_inicio' && C.d.querySelector('#fg-destacados .business-title').textContent === 'NUEVO 1',
    C.llamadas.map((x) => x.fn).join(','));
  const relleno = {};
  for (let i = 0; i < 12; i++) relleno['fg_v1_vieja_' + i] = JSON.stringify({ t: i, v: 'x', d: 'x'.repeat(70000) });
  relleno.fg_v0_antigua = 'x';
  relleno.fg_v1_favs = JSON.stringify({ 'negocio-1': 1 });
  relleno.otra_app = 'no tocar';
  const D = await abrir('index.html', '', { pagina_inicio: datos }, { guardado: relleno });
  const tam = Object.entries(D.storage).filter(([k]) => k.indexOf('fg_v1_') === 0).reduce((s, [k, v]) => s + (k.length + v.length) * 2, 0);
  ctx.ok('R12', 'Límite de tamaño: la caché nunca pasa de ~1,5 MB (borra lo más viejo)', tam <= D.w.FG.LIMITE && !!D.storage['fg_v1_pagina_inicio_'], (tam / 1024).toFixed(0) + ' KB');
  ctx.ok('R12', 'Se borran las claves de versiones anteriores (fg_v0_*)', !('fg_v0_antigua' in D.storage));
  ctx.ok('R12', 'No toca favoritos ni datos de otras aplicaciones', D.storage.fg_v1_favs && D.storage.otra_app === 'no tocar');
  ctx.ok('R12', 'Lo más viejo se borra primero', !('fg_v1_vieja_0' in D.storage) && ('fg_v1_vieja_11' in D.storage));
  const E = await abrir('index.html', '', { pagina_inicio: datos }, { sinStorage: true });
  ctx.ok('R12', 'Sin localStorage (bloqueado) la página funciona igual', $$(E.d, '#fg-destacados .business-card').length === 4);
  const corrupto = { fg_v1_pagina_inicio_: '{esto no es json' };
  const F = await abrir('index.html', '', { pagina_inicio: datos, version_datos: '7-20261117' }, { guardado: corrupto });
  ctx.ok('R12', 'Caché dañada: se ignora y se pide al servidor', $$(F.d, '#fg-destacados .business-card').length === 4 && F.llamadas.some((x) => x.fn === 'pagina_inicio'));
  const G = await abrir('index.html', '', {}, { redCaida: true });
  const msg = G.d.querySelector('#fg-destacados .fg-mensaje');
  ctx.ok('R11', 'Sin internet y sin caché: mensaje claro con botón Reintentar', !!msg && /No pudimos cargar/.test(msg.textContent) && !!msg.querySelector('button'));
  const H = await abrir('index.html', '', {}, { redCaida: true, guardado: A.storage });
  ctx.ok('R12', 'Sin internet pero con caché: se ve lo último guardado', $$(H.d, '#fg-destacados .business-card').length === 4);
  const vacio = await abrir('index.html', '', { pagina_inicio: { version: '1', categorias: CATS, destacados: [], ofertas: [] } });
  ctx.ok('R11', 'Sin destacados ni ofertas: mensajes amables en lugar de huecos', $$(vacio.d, '.fg-mensaje').length === 2);

  // ================= CATEGORÍA =================
  const items = [neg(1, { nombre: 'Zeta Destacado', destacado: true, whatsapp: '573001234567', precio_desde: 90000, precio_label: 'Desde por noche', amenidades: ['📶 WiFi', '🏊 Piscina'], etiqueta_tono: 'amarillo' }),
    neg(2, { nombre: 'Beta Destacado', destacado: true })]
    .concat(['Ábaco', 'Alfa', 'Bravo', 'Charlie', 'Delta', 'Eco', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'Ñandú', 'Oscar', 'Papa', '9 Nueve']
      .map((n, i) => neg(10 + i, { nombre: n })));
  const resp = (cat) => ({ total: 45, pagina: 1, por_pagina: 20, version: '1', categoria: cat === 'hoteles' ? { id: 'c1', nombre: 'Hoteles', slug: 'hoteles' } : null, items });
  const K = await abrir('categoria.html', '?cat=hoteles', (fn, b) => (fn === 'buscar_negocios' ? Object.assign(resp(b.cat), { pagina: b.pagina }) : undefined));
  const args = K.llamadas[0].body;
  ctx.ok('R9', 'Categoría: pide 20 por página de la categoría', args.cat === 'hoteles' && args.pagina === 1 && args.por_pagina === 20 && args.q === null, JSON.stringify(args));
  const hs = $$(K.d, '#fg-lista .alphabet-letter-heading').map((x) => x.textContent);
  ctx.ok('R8', 'Categoría: primero la sección ★ de destacados y luego A-Z (Ábaco va en la A)', hs.slice(0, 4).join('') === '★ABC' && hs.indexOf('Ñ') < 0 && hs.indexOf('N') > 0 && hs[hs.length - 1] === '#', hs.join(''));
  ctx.ok('R11', 'Categoría: 20 tarjetas con la plantilla de hotel', $$(K.d, '#fg-lista .hotel-card').length === 20);
  const c1 = K.d.querySelector('#fg-lista .hotel-card');
  ctx.ok('R11', 'Tarjeta: precio en formato colombiano', c1.querySelector('[data-f="precio"]').textContent === '$ 90.000 COP' && c1.querySelector('[data-f="precio_label"]').textContent === 'Desde por noche');
  ctx.ok('R11', 'Tarjeta: comodidades como etiquetas', $$(c1, '.amenity-item').length === 2);
  ctx.ok('R11', 'Tarjeta: color de etiqueta de la maqueta (amarillo)', /255, 251, 235|#FFFBEB/i.test(c1.querySelector('.badge-tag').getAttribute('style') || ''));
  ctx.ok('R28', 'Tarjeta: botón WhatsApp a wa.me con 57 y mensaje', /^https:\/\/wa\.me\/573001234567\?text=Hola%2C%20quisiera%20reservar%20en%20Zeta%20Destacado/.test(c1.querySelector('.btn-whatsapp').getAttribute('href')));
  const c3 = $$(K.d, '#fg-lista .hotel-card')[2];
  ctx.ok('R11', 'Tarjeta sin WhatsApp: no muestra el botón', !c3.querySelector('.btn-whatsapp'));
  ctx.ok('R8', 'Tarjeta normal: sin insignia Destacado', c3.querySelector('.badge-featured').hidden === true && c1.querySelector('.badge-featured').hidden === false);
  const pags = $$(K.d, '#fg-paginacion .page-link');
  ctx.ok('R9', 'Paginación: 45 resultados → páginas 1, 2, 3 y siguiente', pags.map((x) => x.textContent).join(',') === '1,2,3,>' && pags[0].classList.contains('active'), pags.map((x) => x.textContent).join(','));
  ctx.ok('R9', 'Paginación: enlaces conservan la categoría', pags[1].getAttribute('href') === 'categoria.html?cat=hoteles&p=2');
  ctx.ok('R11', 'Categoría: título, total y menú con el nombre de la categoría', K.d.title === 'Hoteles | FullGuia.com' && K.d.getElementById('fg-total').textContent === '45' && K.d.getElementById('fg-nav-cat').textContent === 'Hoteles');
  const K2 = await abrir('categoria.html', '?cat=hoteles&p=2', (fn, b) => Object.assign(resp(b.cat), { pagina: b.pagina }));
  ctx.ok('R9', 'Página 2: pide pagina=2 y la marca activa', K2.llamadas[0].body.pagina === 2 && K2.d.querySelector('#fg-paginacion .active').textContent === '2');
  const Q = await abrir('categoria.html', '?q=hotel%20cucuta', { buscar_negocios: Object.assign(resp(null), { total: 2, items: items.slice(0, 2) }) });
  ctx.ok('R7', 'Resultados de búsqueda: título y caja de búsqueda con el texto', Q.d.title.indexOf('Resultados para “hotel cucuta”') === 0 && Q.d.getElementById('fg-filtro-q').value === 'hotel cucuta' && Q.llamadas[0].body.q === 'hotel cucuta');
  const V = await abrir('categoria.html', '?cat=hoteles&q=zzz', { buscar_negocios: { total: 0, items: [], categoria: { nombre: 'Hoteles', slug: 'hoteles' }, por_pagina: 20 } });
  ctx.ok('R11', 'Búsqueda sin resultados: mensaje claro', /No encontramos negocios para “zzz”/.test(V.d.getElementById('fg-lista').textContent));
  const V2 = await abrir('categoria.html', '?cat=hoteles', { buscar_negocios: { total: 0, items: [], categoria: { nombre: 'Hoteles', slug: 'hoteles' }, por_pagina: 20 } });
  ctx.ok('R11', 'Categoría vacía: "Aún no hay negocios en esta categoría"', /Aún no hay negocios en esta categoría/.test(V2.d.getElementById('fg-lista').textContent));
  const X = await abrir('categoria.html', '?cat=no-existe', { buscar_negocios: { total: 0, items: [], categoria: null } });
  ctx.ok('R11', 'Categoría inexistente: mensaje "Esta categoría no existe"', /Esta categoría no existe/.test(X.d.getElementById('fg-lista').textContent));

  // Hallazgo de /code-review: un enlace mal formado no debe tumbar la página
  const Mal = await abrir('categoria.html', '?q=50%&cat=hoteles', (fn, b) => Object.assign(resp(b.cat), { pagina: 1 }));
  ctx.ok('R11', 'Enlace mal formado (?q=50%) no rompe la página: busca el texto tal cual', Mal.llamadas.length === 1 && Mal.llamadas[0].body.q === '50%' && $$(Mal.d, '#fg-lista .hotel-card').length === 20);

  // ================= DETALLE =================
  const det = { version: '1', negocio: neg(7, { nombre: 'Hotel Detalle', descripcion: 'Descripción larga\ncon salto', telefono: '6075551234', whatsapp: '573209998877', categoria: 'Hoteles', categoria_slug: 'hoteles',
    ofertas: [{ id: 'a', titulo: '2x1 noches', descuento: '2x1', imagen: null, imagen_mini: null }, { id: 'b', titulo: 'Spa', descuento: '-15%', imagen: 'ofertas/x-g.webp', imagen_mini: 'ofertas/x-m.webp' }] }) };
  const N = await abrir('negocio.html', '?slug=negocio-7', { pagina_negocio: det });
  ctx.ok('R11', 'Detalle: pide el negocio por slug', N.llamadas[0].fn === 'pagina_negocio' && N.llamadas[0].body.p_slug === 'negocio-7');
  ctx.ok('R11', 'Detalle: nombre, miga de pan y título de la pestaña', N.d.getElementById('fg-nombre').textContent === 'Hotel Detalle' && N.d.getElementById('fg-miga-cat').getAttribute('href') === 'categoria.html?cat=hoteles' && N.d.title === 'Hotel Detalle | FullGuia.com');
  ctx.ok('R11', 'Detalle: descripción completa y botón Llamar', /Descripción larga/.test(N.d.querySelector('.fg-descripcion-larga').textContent) && N.d.querySelector('.hotel-actions .btn-outline').getAttribute('href') === 'tel:+576075551234');
  ctx.ok('R11', 'Detalle: ofertas vigentes del negocio', !N.d.getElementById('fg-detalle-ofertas').hidden && $$(N.d, '#fg-ofertas-lista .fg-oferta').length === 2);
  ctx.ok('R11', 'Detalle: oferta sin foto no deja imagen rota', $$(N.d, '#fg-ofertas-lista .fg-oferta')[0].querySelector('img') === null);
  const N2 = await abrir('negocio.html', '?slug=nada', { pagina_negocio: { version: '1', negocio: null } });
  ctx.ok('R11', 'Detalle inexistente: "Este negocio no existe o ya no está publicado"', /no existe o ya no está publicado/.test(N2.d.getElementById('fg-detalle').textContent));
  const N3 = await abrir('negocio.html', '', {});
  ctx.ok('R11', 'Detalle sin slug: mensaje y ninguna llamada', N3.llamadas.length === 0 && /no existe/.test(N3.d.getElementById('fg-detalle').textContent));

  // ================= TODAS LAS CATEGORÍAS =================
  const T = await abrir('categorias.html', '', { pagina_inicio: datos });
  ctx.ok('R11', 'Página de categorías: muestra todas (sin "Más categorías")', $$(T.d, '#fg-categorias .category-card').length === 7);

  // Utilidades
  const U = A.w.FG;
  ctx.ok('R28', 'WhatsApp: acepta 10 dígitos y +57; rechaza fijos y números de otro país',
    U.numeroWhatsapp('300 123 4567') === '573001234567' && U.numeroWhatsapp('+57 300-123-4567') === '573001234567' && U.numeroWhatsapp('6075551234') === '' && U.numeroWhatsapp('5491112345678') === '');
  ctx.ok('R13', 'Solo se aceptan imágenes https o rutas del bucket', U.urlImagen('javascript:alert(1)') === '' && U.urlImagen('http://inseguro/x.jpg') === '' && /^https:\/\//.test(U.urlImagen('a/b.webp')));
};
