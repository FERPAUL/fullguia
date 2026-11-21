/* FullGuia · lógica del sitio público (JS vanilla, sin dependencias).
 *
 * - Habla directo con Supabase (PostgREST/RPC) con fetch y la publishable key de config.js.
 * - Una sola llamada por página: pagina_inicio · buscar_negocios · pagina_negocio.
 * - Caché stale-while-revalidate en localStorage (claves fg_v1_*): pinta al instante lo último
 *   guardado y revalida detrás con version_datos(); solo vuelve a pedir si la versión cambió.
 * - Pinta clonando <template> de cada página y usando textContent (nunca innerHTML con datos).
 */
(function () {
  'use strict';

  var C = window.FG_CONFIG || {};
  var PFX = 'fg_v1_';
  var LIMITE = 1.5 * 1024 * 1024; // ~1,5 MB para toda la caché
  var SVGNS = 'http://www.w3.org/2000/svg';

  // ---------------------------------------------------------------------------
  // Caché en localStorage (siempre con try/catch: puede no existir o estar llena)
  // ---------------------------------------------------------------------------
  function ls() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }

  var cache = {
    get: function (k) {
      var s = ls();
      if (!s) return null;
      try {
        var v = s.getItem(PFX + k);
        return v ? JSON.parse(v) : null;
      } catch (e) { return null; }
    },
    set: function (k, valor) {
      var s = ls();
      if (!s) return false;
      var txt;
      try { txt = JSON.stringify(valor); } catch (e) { return false; }
      if (txt.length * 2 > LIMITE) return false; // demasiado grande para guardar
      try {
        cache.podar(txt.length * 2, PFX + k);
        s.setItem(PFX + k, txt);
        return true;
      } catch (e) {
        try { cache.podar(LIMITE, PFX + k); s.setItem(PFX + k, txt); return true; } catch (e2) { return false; }
      }
    },
    // Borra versiones viejas (fg_v0_…) y las entradas más antiguas hasta dejar espacio.
    podar: function (extra, excepto) {
      var s = ls();
      if (!s) return;
      var items = [];
      var total = 0;
      for (var i = s.length - 1; i >= 0; i--) {
        var k = s.key(i);
        if (!k || k.indexOf('fg_') !== 0) continue;
        if (k.indexOf(PFX) !== 0) { s.removeItem(k); continue; } // otra versión de claves
        if (k === excepto || k === PFX + 'favs') continue;
        var v = s.getItem(k) || '';
        var t = 0;
        try { t = JSON.parse(v).t || 0; } catch (e) { t = 0; }
        items.push({ k: k, t: t, n: (k.length + v.length) * 2 });
        total += (k.length + v.length) * 2;
      }
      items.sort(function (a, b) { return a.t - b.t; });
      while (items.length && total + extra > LIMITE) {
        var x = items.shift();
        s.removeItem(x.k);
        total -= x.n;
      }
    },
    tamano: function () {
      var s = ls();
      if (!s) return 0;
      var total = 0;
      for (var i = 0; i < s.length; i++) {
        var k = s.key(i);
        if (k && k.indexOf(PFX) === 0) total += (k.length + (s.getItem(k) || '').length) * 2;
      }
      return total;
    }
  };

  // ---------------------------------------------------------------------------
  // Datos
  // ---------------------------------------------------------------------------
  // GET sin cabeceras propias = petición "simple": el navegador no hace la consulta previa de CORS
  // (un viaje de ida y vuelta menos por página). La publishable key es pública por diseño.
  function rpc(fn, args) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    var a = args || {};
    var qs = ['apikey=' + encodeURIComponent(C.SUPABASE_KEY)];
    Object.keys(a).forEach(function (k) {
      if (a[k] !== null && a[k] !== undefined && a[k] !== '') qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(a[k]));
    });
    return fetch(C.SUPABASE_URL + '/rest/v1/rpc/' + fn + '?' + qs.join('&'), {
      method: 'GET',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function claveDe(fn, args) {
    var a = args || {};
    var partes = Object.keys(a).sort().map(function (k) {
      return k + '=' + (a[k] === null || a[k] === undefined ? '' : String(a[k]));
    });
    return fn + '_' + partes.join('&');
  }

  // Stale-while-revalidate: pinta lo guardado, revalida con version_datos y repinta si cambió.
  function vista(fn, args, pintar, alFallar) {
    var k = claveDe(fn, args);
    var guardado = cache.get(k);
    var pintado = false;
    if (guardado && guardado.d) {
      try { pintar(guardado.d, true); pintado = true; } catch (e) { pintado = false; }
    }
    var revalidar = guardado && pintado
      ? rpc('version_datos', {}).then(function (v) { return v === guardado.v ? null : rpc(fn, args); })
      : rpc(fn, args);
    return revalidar.then(function (d) {
      if (!d) return guardado.d; // sin cambios: no se vuelve a pedir nada
      cache.set(k, { v: d.version, t: Date.now(), d: d });
      if (!pintado || JSON.stringify(d) !== JSON.stringify(guardado.d)) pintar(d, false);
      return d;
    }).catch(function (e) {
      if (!pintado && alFallar) alFallar(e);
      return pintado ? guardado.d : null;
    });
  }

  // ---------------------------------------------------------------------------
  // Utilidades de pintado
  // ---------------------------------------------------------------------------
  function $(sel, raiz) { return (raiz || document).querySelector(sel); }
  function $$(sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); }

  function clonar(id) {
    var t = document.getElementById(id);
    if (!t || !t.content) return null;
    return t.content.firstElementChild.cloneNode(true);
  }

  function campos(raiz, nombre) { return $$('[data-f~="' + nombre + '"]', raiz); }

  function texto(raiz, nombre, valor) {
    campos(raiz, nombre).forEach(function (el) { el.textContent = valor == null ? '' : String(valor); });
  }

  function mostrar(el, si) { if (el) el.hidden = !si; }

  // Solo URLs http(s) o rutas del bucket; cualquier otra cosa se descarta.
  function urlImagen(ruta) {
    if (!ruta || typeof ruta !== 'string') return '';
    if (/^https:\/\//i.test(ruta)) return ruta;
    if (/^[a-z]+:/i.test(ruta)) return '';
    var limpia = ruta.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
    return C.SUPABASE_URL + '/storage/v1/object/public/' + (C.BUCKET || 'negocios') + '/' + limpia;
  }

  function ponerImagen(img, grande, mini, alt, tamanos) {
    if (!img) return;
    var g = urlImagen(grande);
    var m = urlImagen(mini) || g;
    if (!m) {
      var cont = img.parentNode;
      if (cont) cont.removeChild(img);
      return;
    }
    img.src = m;
    if (g && g !== m) {
      img.srcset = m + ' 400w, ' + g + ' 1200w';
      img.sizes = tamanos || '(min-width: 640px) 400px, 100vw';
    }
    img.alt = alt || '';
  }

  // Único punto de navegación (las pruebas automáticas lo pueden interceptar).
  function navegar(url) {
    if (typeof window.__fgNavegar === 'function') return window.__fgNavegar(url);
    window.location.href = url;
  }

  function soloDigitos(s) { return String(s || '').replace(/\D+/g, ''); }

  // WhatsApp Colombia: 57 + celular de 10 dígitos que empieza por 3.
  function numeroWhatsapp(n) {
    var d = soloDigitos(n);
    if (/^3\d{9}$/.test(d)) d = '57' + d;
    return /^573\d{9}$/.test(d) ? d : '';
  }

  function enlaceWhatsapp(n, mensaje) {
    var d = numeroWhatsapp(n);
    return d ? 'https://wa.me/' + d + '?text=' + encodeURIComponent(mensaje) : '';
  }

  function precio(n) {
    if (n === null || n === undefined || n === '') return '';
    var s = String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return '$ ' + s + ' COP';
  }

  function estrellas(r) {
    var n = Math.max(0, Math.min(5, Math.round(Number(r) || 0)));
    return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  }

  function rating(r) {
    return (Number(r) || 0).toFixed(1).replace(/\.0$/, '.0');
  }

  function normalizar(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function urlNegocio(slug) { return 'negocio.html?slug=' + encodeURIComponent(slug); }
  function urlCategoria(slug) { return 'categoria.html?cat=' + encodeURIComponent(slug); }

  function mensaje(cont, titulo, detalle, reintentar) {
    if (!cont) return;
    var caja = document.createElement('div');
    caja.className = 'fg-mensaje';
    var t = document.createElement('strong');
    t.textContent = titulo;
    caja.appendChild(t);
    if (detalle) {
      var p = document.createElement('span');
      p.textContent = detalle;
      caja.appendChild(p);
    }
    if (reintentar) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-outline';
      b.style.marginTop = '12px';
      b.textContent = 'Reintentar';
      b.addEventListener('click', reintentar);
      caja.appendChild(document.createElement('br'));
      caja.appendChild(b);
    }
    cont.replaceChildren(caja);
  }

  var ERROR_RED = ['No pudimos cargar la información', 'Revisa tu conexión a internet e intenta de nuevo.'];

  // Tonos de etiqueta (mismos colores de la maqueta de hoteles)
  var TONOS = {
    amarillo: { background: '#FFFBEB', color: '#B45309' },
    morado: { background: '#FAF5FF', color: '#6B21A8' },
    verde: { background: '#F0FDF4', color: '#166534' },
    azul: null
  };

  // Íconos de categoría (mismos trazos de la maqueta). Se crean con createElementNS.
  var CORAZON = 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.72-8.72 1.06-1.06a5.5 5.5 0 0 0 0-7.78z';
  var ICONOS = {
    comidas: [['path', { d: 'M18 8h1a4 4 0 0 1 0 8h-1' }], ['path', { d: 'M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z' }], ['line', { x1: 6, y1: 1, x2: 6, y2: 4 }], ['line', { x1: 10, y1: 1, x2: 10, y2: 4 }], ['line', { x1: 14, y1: 1, x2: 14, y2: 4 }]],
    hoteles: [['path', { d: 'M2 4v16' }], ['path', { d: 'M2 8h18a2 2 0 0 1 2 2v10' }], ['path', { d: 'M2 17h20' }], ['path', { d: 'M6 8v9' }]],
    salud: [['path', { d: CORAZON }], ['line', { x1: 12, y1: 8, x2: 12, y2: 16 }], ['line', { x1: 8, y1: 12, x2: 16, y2: 12 }]],
    vehiculos: [['rect', { x: 1, y: 3, width: 15, height: 13 }], ['polygon', { points: '16 8 20 8 23 11 23 16 16 16 16 8' }], ['circle', { cx: 5.5, cy: 18.5, r: 2.5 }], ['circle', { cx: 18.5, cy: 18.5, r: 2.5 }]],
    hogar: [['path', { d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }], ['polyline', { points: '9 22 9 12 15 12 15 22' }]],
    tecnologia: [['rect', { x: 2, y: 3, width: 20, height: 14, rx: 2, ry: 2 }], ['line', { x1: 8, y1: 21, x2: 16, y2: 21 }], ['line', { x1: 12, y1: 17, x2: 12, y2: 21 }]],
    educacion: [['path', { d: 'M22 10v6M2 10l10-5 10 5-10 5z' }], ['path', { d: 'M6 12v5c3 3 9 3 12 0v-5' }]],
    tienda: [['path', { d: 'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z' }], ['line', { x1: 3, y1: 6, x2: 21, y2: 6 }], ['path', { d: 'M16 10a4 4 0 0 1-8 0' }]],
    belleza: [['circle', { cx: 6, cy: 6, r: 3 }], ['circle', { cx: 6, cy: 18, r: 3 }], ['line', { x1: 20, y1: 4, x2: 8.12, y2: 15.88 }], ['line', { x1: 14.47, y1: 14.48, x2: 20, y2: 20 }], ['line', { x1: 8.12, y1: 8.12, x2: 12, y2: 12 }]],
    deporte: [['polyline', { points: '22 12 18 12 15 21 9 3 6 12 2 12' }]],
    servicios: [['path', { d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' }]],
    turismo: [['circle', { cx: 12, cy: 12, r: 10 }], ['polygon', { points: '16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76' }]],
    mas: [['circle', { cx: 12, cy: 12, r: 1 }], ['circle', { cx: 19, cy: 12, r: 1 }], ['circle', { cx: 5, cy: 12, r: 1 }]]
  };
  var COLORES = ['orange', 'blue', 'green', 'purple', 'yellow', 'cyan', 'red', 'gray'];

  function icono(nombre, tam) {
    var svg = document.createElementNS(SVGNS, 'svg');
    var t = String(tam || 26);
    svg.setAttribute('width', t);
    svg.setAttribute('height', t);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('aria-hidden', 'true');
    (ICONOS[nombre] || ICONOS.mas).forEach(function (p) {
      var el = document.createElementNS(SVGNS, p[0]);
      Object.keys(p[1]).forEach(function (a) { el.setAttribute(a, String(p[1][a])); });
      svg.appendChild(el);
    });
    return svg;
  }

  function tarjetaCategoria(c) {
    var a = clonar('tpl-categoria');
    if (!a) return null;
    a.href = c.slug ? urlCategoria(c.slug) : 'categorias.html';
    var caja = $('.category-icon-box', a);
    caja.className = 'category-icon-box cat-' + (COLORES.indexOf(c.color) >= 0 ? c.color : 'gray');
    caja.appendChild(icono(c.icono));
    $('.category-name', a).textContent = c.nombre;
    return a;
  }

  function pintarCategorias(cont, cats, max) {
    if (!cont || !document.getElementById('tpl-categoria')) return;
    var lista = cats || [];
    var frag = document.createDocumentFragment();
    var mostrarTodas = !max || lista.length <= max;
    var visibles = mostrarTodas ? lista : lista.slice(0, max - 1);
    visibles.forEach(function (c) { var a = tarjetaCategoria(c); if (a) frag.appendChild(a); });
    if (max && !mostrarTodas) {
      frag.appendChild(tarjetaCategoria({ nombre: 'Más categorías', slug: '', icono: 'mas', color: 'gray' }));
    } else if (max && lista.length < max) {
      frag.appendChild(tarjetaCategoria({ nombre: 'Más categorías', slug: '', icono: 'mas', color: 'gray' }));
    }
    if (!lista.length && !max) {
      mensaje(cont, 'Aún no hay categorías', 'Vuelve pronto.');
      return;
    }
    cont.replaceChildren(frag);
  }

  // ---------------------------------------------------------------------------
  // Favoritos (se recuerdan en este navegador)
  // ---------------------------------------------------------------------------
  function favs() { return cache.get('favs') || {}; }
  function marcarFav(btn, on) {
    var svg = $('svg', btn);
    if (svg) svg.setAttribute('fill', on ? 'currentColor' : 'none');
    btn.classList.toggle('fg-fav-on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function activarFavoritos() {
    document.addEventListener('click', function (e) {
      // Corazón de las tarjetas y el botón "Favoritos" de la cabecera (no "Mi Perfil" ni otros íconos)
      var btn = e.target.closest && e.target.closest('.business-fav-btn, .hotel-fav-btn, .icon-btn[aria-label="Favoritos"]');
      if (!btn) return;
      e.preventDefault();
      var slug = btn.getAttribute('data-slug');
      var svg = $('svg', btn);
      var on = !(svg && svg.getAttribute('fill') === 'currentColor');
      marcarFav(btn, on);
      if (slug) {
        var f = favs();
        if (on) f[slug] = 1; else delete f[slug];
        cache.set('favs', f);
      }
    });
  }

  // Ícono "Mi Perfil" de la cabecera: lleva al panel de administración (misma dirección + /admin/)
  function activarPerfil() {
    $$('.icon-btn[aria-label="Mi Perfil"]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        navegar('admin/');
      });
    });
  }

  // ---------------------------------------------------------------------------
  // "Publica tu negocio"
  // ---------------------------------------------------------------------------
  function activarPublicar() {
    $$('[data-fg="publicar"]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        var url = enlaceWhatsapp(C.WHATSAPP_FULLGUIA, C.MENSAJE_PUBLICAR || 'Hola, quiero publicar mi negocio');
        if (url) {
          window.open(url, '_blank', 'noopener');
        } else if (document.getElementById('publicar')) {
          document.getElementById('publicar').scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          navegar('index.html#publicar');
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Galería de videos de YouTube (inicio)
  // ---------------------------------------------------------------------------
  // Se desliza con el dedo (o con flechas, puntos y teclado) sin salir de la página. Cada diapositiva es
  // la miniatura del video y solo la del frente tiene el reproductor: al pasar a otra, el anterior se quita
  // y su audio se corta. Arranca solo y en silencio (los navegadores no dejan sonar un video antes de que
  // el visitante toque la página); con el primer toque, clic o tecla, el sonido se activa solo.
  var YT_ORIGEN = 'https://www.youtube-nocookie.com';
  var RX_YT = { video: /^[A-Za-z0-9_-]{11}$/, lista: /^[A-Za-z0-9_-]{10,64}$/, canal: /^UC[A-Za-z0-9_-]{22}$/ };
  var RX_MINI_YT = /^https:\/\/(i[0-9]?\.ytimg\.com|yt3\.ggpht\.com|yt3\.googleusercontent\.com)\/[^\s"'<>\\]+$/;

  function videoValido(v) { return !!(v && RX_YT[v.tipo] && RX_YT[v.tipo].test(String(v.ref || ''))); }
  function urlEmbed(v, sonido) {
    var o = window.location && /^https?:/.test(window.location.protocol) ? '&origin=' + encodeURIComponent(window.location.origin) : '';
    var p = 'autoplay=1&playsinline=1&rel=0&enablejsapi=1&mute=' + (sonido ? 0 : 1) + o;
    if (v.tipo === 'lista') return YT_ORIGEN + '/embed/videoseries?list=' + v.ref + '&' + p;
    if (v.tipo === 'canal') return YT_ORIGEN + '/embed/live_stream?channel=' + v.ref + '&' + p;
    return YT_ORIGEN + '/embed/' + v.ref + '?' + p;
  }
  function miniaturaDe(v) {
    if (v.miniatura && RX_MINI_YT.test(v.miniatura)) return v.miniatura;
    return v.tipo === 'video' ? 'https://i.ytimg.com/vi/' + v.ref + '/hqdefault.jpg' : '';
  }

  var galeria = (function () {
    var raiz, pista, btnAnt, btnSig, btnSonido, tituloEl, puntos, contador;
    var lista = [], slides = [], firma = '', activo = 0;
    var sonido = false;          // el visitante quiere sonido (primer gesto, botón o ▶)
    var gesto = false;           // ya hubo un toque, clic o tecla del visitante
    var recien = 0;              // momento del primer gesto (ese mismo toque no pausa el video)
    var cargada = false, datos = false, arrancada = false, visible = true;
    var automatico = true;       // sin autoplay si el visitante pidió ahorro de datos o menos movimiento
    var jugador = null;          // { el, capa, slide, v, muted, estado, desde }
    var tScroll = 0, tSync = 0;

    function reducido() {
      try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
    }

    function init() {
      raiz = $('#fg-galeria');
      if (!raiz) return false;
      pista = $('#fg-pista', raiz);
      btnAnt = $('.fg-gal-ant', raiz);
      btnSig = $('.fg-gal-sig', raiz);
      btnSonido = $('#fg-sonido');
      tituloEl = $('#fg-gal-titulo');
      puntos = $('#fg-gal-puntos');
      contador = $('#fg-gal-contador');
      var ahorro = !!(navigator.connection && navigator.connection.saveData);
      automatico = !ahorro && !reducido();
      // La diapositiva escrita en la página (se ve antes de que lleguen los datos)
      // (si alguien deja en la página una diapositiva con datos inválidos, se ignora sin romper la galería)
      var escritas = $$('.fg-slide', pista).map(function (s) {
        var img = $('img', s);
        return { s: s, v: { tipo: s.getAttribute('data-tipo'), ref: s.getAttribute('data-ref'), titulo: (img && img.alt) || 'Video', miniatura: img ? img.getAttribute('src') : '' } };
      }).filter(function (x) { return videoValido(x.v); });
      slides = escritas.map(function (x) { return x.s; });
      lista = escritas.map(function (x) { return x.v; });
      firma = firmaDe(lista);
      slides.forEach(function (s, i) { conectarSlide(s, i); });

      pista.addEventListener('scroll', function () {
        clearTimeout(tScroll);
        tScroll = setTimeout(function () {
          var w = pista.clientWidth || 1;
          var i = Math.round(pista.scrollLeft / w);
          if (i !== activo && i >= 0 && i < slides.length) activar(i);
        }, 110);
      }, { passive: true });
      if (btnAnt) btnAnt.addEventListener('click', function () { ir(activo - 1); });
      if (btnSig) btnSig.addEventListener('click', function () { ir(activo + 1); });
      if (btnSonido) btnSonido.addEventListener('click', function () {
        gesto = true;
        sonido = jugador ? !!jugador.muted : !sonido;
        aplicarSonido();
      });
      raiz.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); ir(activo - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); ir(activo + 1); }
      });
      escucharGesto();
      window.addEventListener('message', alMensaje);
      window.addEventListener('resize', function () { desplazar(activo, true); });
      if (typeof IntersectionObserver !== 'undefined') {
        new IntersectionObserver(function (ents) {
          var ahora = ents[ents.length - 1].isIntersecting;
          if (ahora === visible) return;
          visible = ahora;
          if (jugador) {
            // Al salir se pausa; al volver solo sigue si estaba sonando (un video que el visitante pausó, sigue pausado)
            if (!visible) { jugador.seguir = jugador.estado === 1 || jugador.estado === 3 || jugador.estado === -1; comando('pauseVideo'); }
            else if (jugador.seguir) { jugador.seguir = false; comando('playVideo'); }
            return;
          }
          // Si al arrancar la galería no estaba en pantalla, el video empieza cuando el visitante llega a ella
          if (visible) { if (arrancada) { if (automatico) ponerJugador(false); } else arrancar(); }
        }, { threshold: 0.35 }).observe(raiz);
      }
      if (document.readyState === 'complete') cargada = true;
      else window.addEventListener('load', function () { cargada = true; arrancar(); });
      controles();
      return true;
    }

    function firmaDe(l) {
      return l.map(function (v) { return v.tipo + ':' + v.ref + ':' + v.titulo + ':' + (v.miniatura || ''); }).join('|');
    }

    // Primer toque/clic/tecla del visitante en la página: activa el sonido del video del frente.
    function primerGesto(e) {
      if (gesto) return;
      if (e && e.type === 'keydown' && /^(Tab|Shift|Control|Alt|Meta|Escape)$/.test(e.key || '')) return;
      // Escribir en el buscador o tocar un enlace (que lleva a otra página) no enciende el sonido
      var t = e && e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable], a[href]') && !(raiz && raiz.contains(t))) return;
      gesto = true;
      ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { document.removeEventListener(ev, primerGesto, true); });
      if (btnSonido && e && e.target && btnSonido.contains(e.target)) return;   // el botón decide por sí mismo
      recien = Date.now();
      if (!sonido) { sonido = true; aplicarSonido(); }
    }

    function conectarSlide(s, i) {
      var b = $('.fg-video', s);
      if (b) b.addEventListener('click', function () {
        gesto = true;
        sonido = true;
        if (i !== activo) ir(i);
        ponerJugador(true);
      });
    }

    function crearSlide(v, i, n) {
      var s = clonar('tpl-video');
      if (!s) return null;
      s.setAttribute('data-tipo', v.tipo);
      s.setAttribute('data-ref', v.ref);
      s.setAttribute('aria-label', (i + 1) + ' de ' + n + ': ' + v.titulo);
      if (v.tipo === 'canal') s.classList.add('fg-slide-canal');
      var b = $('.fg-video', s);
      if (b) b.setAttribute('aria-label', 'Reproducir: ' + v.titulo);
      texto(s, 'titulo', v.titulo);
      var vivo = campos(s, 'vivo')[0];
      if (vivo) vivo.hidden = v.tipo !== 'canal';
      var img = $('img', s);
      var src = miniaturaDe(v);
      if (img && src) {
        img.src = src;
        img.alt = v.titulo;
        if (i === 0) { img.removeAttribute('loading'); img.setAttribute('fetchpriority', 'high'); }
      } else if (img) {
        img.parentNode.removeChild(img);
      }
      return s;
    }

    function pintar(nueva) {
      if (!raiz || !Array.isArray(nueva)) return;
      var l = nueva.filter(videoValido).map(function (v) {
        return { tipo: v.tipo, ref: String(v.ref), titulo: String(v.titulo || 'Video').slice(0, 120), miniatura: v.miniatura || '' };
      });
      var f = firmaDe(l);
      if (f === firma) return;                    // nada cambió: el video que suena sigue sonando
      var clave = lista[activo] ? lista[activo].tipo + ':' + lista[activo].ref : '';
      var habia = !!jugador;                      // un video que ya estaba sonando (aunque lo haya pedido el visitante)
      quitarJugador();
      lista = l;
      firma = f;
      if (!l.length) {
        var m = document.createElement('div');
        m.className = 'fg-gal-vacio';
        m.textContent = 'Pronto verás videos aquí';
        slides = [];
        pista.replaceChildren(m);
        activo = 0;
        controles();
        return;
      }
      var frag = document.createDocumentFragment();
      slides = l.map(function (v, i) { var s = crearSlide(v, i, l.length); conectarSlide(s, i); frag.appendChild(s); return s; });
      pista.replaceChildren(frag);
      var j = 0;
      var sigue = false;
      l.forEach(function (v, i) { if (v.tipo + ':' + v.ref === clave) { j = i; sigue = true; } });
      activo = j;
      desplazar(activo, true);
      controles();
      // Si el video que sonaba sigue en la lista, vuelve a ponerse aunque la galería no haya arrancado sola
      if ((habia && sigue) || (arrancada && visible && automatico)) ponerJugador(false);
    }

    function desplazar(i, sinAnimar) {
      if (!pista) return;
      var x = i * (pista.clientWidth || 0);
      if (typeof pista.scrollTo === 'function') {
        try { pista.scrollTo({ left: x, behavior: sinAnimar || reducido() ? 'auto' : 'smooth' }); return; } catch (e) { /* navegador viejo */ }
      }
      pista.scrollLeft = x;
    }

    function ir(i) {
      if (!slides.length) return;
      var j = Math.max(0, Math.min(slides.length - 1, i));
      if (j === activo) return;
      activar(j);
      desplazar(j);
    }

    function activar(i) {
      if (i === activo && jugador) return;
      quitarJugador();
      activo = i;
      controles();
      if (arrancada && visible && automatico) ponerJugador(false);
    }

    function controles() {
      var n = slides.length;
      var v = lista[activo];
      if (btnAnt) { btnAnt.hidden = n < 2; btnAnt.disabled = activo <= 0; }
      if (btnSig) { btnSig.hidden = n < 2; btnSig.disabled = activo >= n - 1; }
      if (tituloEl) tituloEl.textContent = v ? v.titulo : '';
      if (contador) { contador.textContent = n > 1 ? (activo + 1) + ' / ' + n : ''; }
      if (puntos) {
        var fr = document.createDocumentFragment();
        if (n > 1 && n <= 15) {
          for (var k = 0; k < n; k++) {
            var d = document.createElement('button');
            d.type = 'button';
            d.className = 'dot' + (k === activo ? ' active' : '');
            d.setAttribute('aria-label', 'Ver video ' + (k + 1) + ': ' + lista[k].titulo);
            if (k === activo) d.setAttribute('aria-current', 'true');
            (function (k2) { d.addEventListener('click', function () { ir(k2); }); })(k);
            fr.appendChild(d);
          }
        }
        puntos.replaceChildren(fr);
      }
      // Las diapositivas de atrás no se enfocan ni se leen (inert); se llega a ellas con flechas, puntos o deslizando
      slides.forEach(function (s, k) { if (k === activo) s.removeAttribute('inert'); else s.setAttribute('inert', ''); });
      botonSonido();
    }

    function botonSonido() {
      if (!btnSonido) return;
      btnSonido.hidden = !jugador;
      var mudo = jugador ? !!jugador.muted : !sonido;
      btnSonido.textContent = mudo ? '🔇 Activar sonido' : '🔊 Silenciar';
      btnSonido.setAttribute('aria-pressed', mudo ? 'false' : 'true');
    }

    function arrancar() {
      if (arrancada || !cargada || !datos || !raiz) return;
      arrancada = true;
      var ya = function () { if (visible && automatico && !jugador) ponerJugador(false); };
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(ya, { timeout: 1500 });
      else setTimeout(ya, 200);
    }

    function ponerJugador(pedido) {
      var s = slides[activo], v = lista[activo];
      if (!s || !v) return;
      if (jugador && jugador.slide === s) { if (pedido) { comando('playVideo'); aplicarSonido(); } return; }
      quitarJugador();
      var f = document.createElement('iframe');
      // Siempre arranca en silencio (así el navegador nunca bloquea el autoplay); el sonido se pide al estar listo.
      f.src = urlEmbed(v, false);
      f.title = v.titulo;
      f.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen');
      f.setAttribute('allowfullscreen', '');
      f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      // Capa táctil: deja deslizar encima del video (un iframe se queda con los toques); un toque pausa o reanuda.
      // La franja de abajo queda libre para los controles de YouTube.
      var capa = document.createElement('div');
      capa.className = 'fg-capa';
      capa.addEventListener('click', function () {
        if (Date.now() - recien < 600) return;     // ese toque solo activó el sonido
        if (!jugador) return;
        comando(jugador.estado === 1 || jugador.estado === 3 ? 'pauseVideo' : 'playVideo');
      });
      jugador = { el: f, capa: capa, slide: s, v: v, muted: true, estado: -1, desde: Date.now() };
      f.addEventListener('load', function () {
        if (!jugador || jugador.el !== f) return;
        try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'fg', channel: 'widget' }), YT_ORIGEN); } catch (e) { /* nada */ }
        // Por si el reproductor no avisa que está listo: se aplica el sonido igual un momento después
        setTimeout(function () { if (jugador && jugador.el === f && !jugador.listo) aplicarSonido(); }, 1500);
      });
      s.classList.add('fg-reproduciendo');
      s.appendChild(f);
      s.appendChild(capa);
      botonSonido();
    }

    function quitarJugador() {
      if (!jugador) return;
      var j = jugador;
      jugador = null;
      j.slide.classList.remove('fg-reproduciendo');
      if (j.el.parentNode) j.el.parentNode.removeChild(j.el);
      if (j.capa.parentNode) j.capa.parentNode.removeChild(j.capa);
      botonSonido();
    }

    function comando(func, args) {
      if (!jugador || !jugador.el.contentWindow) return;
      try { jugador.el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), YT_ORIGEN); } catch (e) { /* nada */ }
    }

    function aplicarSonido() {
      if (jugador) {
        comando(sonido ? 'unMute' : 'mute');
        if (sonido) comando('playVideo');
        jugador.muted = !sonido;
        jugador.desde = Date.now();
        clearTimeout(tSync);
        tSync = setTimeout(sincronizar, 1600);      // después se compara con lo que YouTube dice de verdad
      }
      botonSonido();
    }

    function escucharGesto() {
      ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { document.addEventListener(ev, primerGesto, true); });
    }

    // Lo que YouTube informa manda: si el navegador no dejó activar el sonido (p. ej. un deslizamiento no cuenta
    // como toque), el botón vuelve a "Activar sonido" y se espera el próximo toque; si el visitante usó el botón
    // de YouTube, se respeta su elección.
    function sincronizar() {
      if (!jugador || typeof jugador.reportado !== 'boolean' || jugador.reportado === jugador.muted) return;
      var bloqueado = jugador.reportado && sonido && Date.now() - jugador.desde < 5000;
      jugador.muted = jugador.reportado;
      sonido = !jugador.reportado;
      if (bloqueado && gesto) { gesto = false; escucharGesto(); }
      botonSonido();
    }

    // Mensajes del reproductor (estado, si está en silencio). Solo se aceptan del iframe activo.
    function alMensaje(e) {
      if (!jugador || e.source !== jugador.el.contentWindow) return;
      if (e.origin !== YT_ORIGEN && e.origin !== 'https://www.youtube.com') return;
      var d;
      try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (x) { return; }
      if (!d || typeof d !== 'object') return;
      if (d.event === 'onReady') { jugador.listo = true; aplicarSonido(); return; }
      var info = d.info;
      if (d.event === 'onStateChange' && typeof info === 'number') info = { playerState: info };
      if (!info || typeof info !== 'object') return;
      if (typeof info.playerState === 'number') {
        jugador.estado = info.playerState;
        // Al terminar un video pasa solo al siguiente (y del último vuelve al primero)
        if (info.playerState === 0 && jugador.v.tipo === 'video' && slides.length > 1) { var sig = (activo + 1) % slides.length; activar(sig); desplazar(sig); return; }
      }
      if (typeof info.muted === 'boolean') {
        jugador.reportado = info.muted;
        if (Date.now() - jugador.desde > 1500) sincronizar();   // antes de eso puede ser el estado anterior al comando
      }
    }

    return {
      init: init,
      pintar: pintar,
      datosListos: function () { datos = true; arrancar(); },
      ir: ir,
      estado: function () {
        return { activo: activo, total: slides.length, sonido: sonido, gesto: gesto, jugador: jugador ? jugador.el.src : '', muted: jugador ? jugador.muted : null };
      }
    };
  })();

  // ---------------------------------------------------------------------------
  // Tarjetas de negocio
  // ---------------------------------------------------------------------------
  function llenarDestacado(n) {
    var card = clonar('tpl-negocio');
    if (!card) return null;
    campos(card, 'enlace').forEach(function (a) { a.href = urlNegocio(n.slug); });
    texto(card, 'nombre', n.nombre);
    ponerImagen(campos(card, 'imagen')[0], n.imagen, n.imagen_mini, n.nombre, '(min-width: 1280px) 220px, (min-width: 1024px) calc((100vw - 420px) / 4), (min-width: 640px) calc(50vw - 28px), calc(100vw - 34px)');
    var logo = campos(card, 'logo')[0];
    if (n.logo) ponerImagen(logo, n.logo, n.logo, 'Logo ' + n.nombre);
    else if (logo) logo.parentNode.parentNode.removeChild(logo.parentNode);
    texto(card, 'estrellas', estrellas(n.rating));
    texto(card, 'rating', rating(n.rating));
    texto(card, 'opiniones', '(' + (n.num_opiniones || 0) + ')');
    texto(card, 'etiqueta', n.etiqueta || n.categoria);
    texto(card, 'ciudad', n.ciudad || '');
    var fav = $('.business-fav-btn', card);
    if (fav) { fav.setAttribute('data-slug', n.slug); marcarFav(fav, !!favs()[n.slug]); }
    return card;
  }

  // prioridad: la primera foto visible (la más grande de la pantalla) se pide primero y sin "lazy".
  function llenarHotel(n, detalle, prioridad) {
    var card = clonar('tpl-hotel');
    if (!card) return null;
    mostrar(campos(card, 'destacado')[0], !!n.destacado);
    campos(card, 'enlace').forEach(function (a) { a.href = urlNegocio(n.slug); });
    texto(card, 'nombre', n.nombre);
    var im = campos(card, 'imagen')[0];
    if (im && (detalle || prioridad)) { im.loading = 'eager'; im.setAttribute('fetchpriority', 'high'); }
    ponerImagen(im, n.imagen, n.imagen_mini, n.nombre,
      '(min-width: 640px) 280px, calc(100vw - 34px)');

    var et = campos(card, 'etiqueta')[0];
    if (et) {
      et.textContent = n.etiqueta || n.categoria || '';
      mostrar(et, !!(n.etiqueta || n.categoria));
      var tono = TONOS[n.etiqueta_tono];
      if (tono) { et.style.background = tono.background; et.style.color = tono.color; }
    }
    texto(card, 'ubicacion', n.direccion || n.ciudad || '');
    texto(card, 'rating', '★ ' + rating(n.rating) + ' / 5');
    texto(card, 'opiniones', (n.num_opiniones || 0) === 1 ? '1 opinión' : (n.num_opiniones || 0) + ' opiniones');

    var am = campos(card, 'amenidades')[0];
    if (am) {
      (n.amenidades || []).forEach(function (a) {
        var s = document.createElement('span');
        s.className = 'amenity-item';
        s.textContent = a;
        am.appendChild(s);
      });
      mostrar(am, (n.amenidades || []).length > 0);
    }

    var tienePrecio = n.precio_desde !== null && n.precio_desde !== undefined;
    texto(card, 'precio_label', tienePrecio ? (n.precio_label || 'Desde') : '');
    texto(card, 'precio', tienePrecio ? precio(n.precio_desde) : '');
    var bloquePrecio = $('.hotel-price', card);
    if (bloquePrecio) bloquePrecio.style.visibility = tienePrecio ? '' : 'hidden';

    var wa = campos(card, 'whatsapp')[0];
    var esHotel = n.categoria_slug === 'hoteles';
    var waUrl = enlaceWhatsapp(n.whatsapp, 'Hola, ' + (esHotel ? 'quisiera reservar en ' : 'quisiera información de ') +
      n.nombre + ' (lo vi en FullGuia.com)');
    if (wa) { if (waUrl) wa.href = waUrl; else wa.parentNode.removeChild(wa); }

    var fav = $('.hotel-fav-btn', card);
    if (fav) { fav.setAttribute('data-slug', n.slug); marcarFav(fav, !!favs()[n.slug]); }

    if (detalle) {
      var ver = $('.btn-outline', card);
      var tel = soloDigitos(n.telefono);
      if (ver) {
        if (tel) { ver.href = 'tel:+' + (tel.length === 10 ? '57' + tel : tel); ver.textContent = 'Llamar'; }
        else ver.parentNode.removeChild(ver);
      }
      var info = $('.hotel-amenities', card) || $('.hotel-header-info', card);
      if (n.descripcion) {
        var p = document.createElement('p');
        p.className = 'fg-descripcion-larga';
        p.textContent = n.descripcion;
        info.parentNode.insertBefore(p, info.nextSibling);
      }
    }
    return card;
  }

  // ---------------------------------------------------------------------------
  // Páginas
  // ---------------------------------------------------------------------------
  function paginaInicio() {
    var grid = $('#fg-destacados');
    var dots = $('#fg-dots');
    var ofertas = $('#fg-ofertas');
    var sel = $('#fg-cat');
    var POR = 4;

    function pintarDestacados(lista, pag) {
      if (!grid) return;
      if (!lista.length) {
        mensaje(grid, 'Muy pronto verás aquí los negocios destacados', '¿Tienes un negocio? Destácalo desde $29.900 COP/mes.');
        if (dots) dots.replaceChildren();
        return;
      }
      var paginas = Math.ceil(lista.length / POR);
      var p = Math.min(Math.max(pag || 0, 0), paginas - 1);
      var frag = document.createDocumentFragment();
      lista.slice(p * POR, p * POR + POR).forEach(function (n) { var c = llenarDestacado(n); if (c) frag.appendChild(c); });
      grid.replaceChildren(frag);
      if (dots) {
        var fd = document.createDocumentFragment();
        if (paginas > 1) {
          for (var i = 0; i < paginas; i++) {
            var d = document.createElement('span');
            d.className = 'dot' + (i === p ? ' active' : '');
            d.setAttribute('role', 'button');
            d.setAttribute('tabindex', '0');
            d.setAttribute('aria-label', 'Ver grupo ' + (i + 1) + ' de destacados');
            (function (i2) {
              var ir = function () { pintarDestacados(lista, i2); };
              d.addEventListener('click', ir);
              d.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); } });
            })(i);
            fd.appendChild(d);
          }
        }
        dots.replaceChildren(fd);
      }
    }

    function pintarOfertas(lista) {
      if (!ofertas) return;
      if (!lista.length) {
        mensaje(ofertas, 'No hay ofertas vigentes en este momento', 'Vuelve pronto.');
        return;
      }
      var frag = document.createDocumentFragment();
      lista.forEach(function (o) {
        var a = clonar('tpl-oferta');
        if (!a) return;
        a.href = urlNegocio(o.negocio_slug);
        texto(a, 'descuento', o.descuento);
        ponerImagen(campos(a, 'imagen')[0], o.imagen, o.imagen_mini, o.titulo + ' · ' + o.negocio,
          '(min-width: 1280px) 300px, (min-width: 1024px) calc(25vw - 28px), (min-width: 640px) calc(50vw - 28px), calc(100vw - 34px)');
        frag.appendChild(a);
      });
      ofertas.replaceChildren(frag);
    }

    function pintarSelect(cats) {
      if (!sel) return;
      var actual = sel.value;
      while (sel.options.length > 1) sel.remove(1);
      cats.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.slug;
        o.textContent = c.nombre;
        sel.appendChild(o);
      });
      sel.value = actual;
    }

    var buscador = $('#fg-buscador');
    if (buscador) {
      buscador.addEventListener('submit', function (e) {
        e.preventDefault();
        var q = ($('#fg-q') || {}).value || '';
        var cat = sel ? sel.value : '';
        var partes = [];
        if (cat) partes.push('cat=' + encodeURIComponent(cat));
        if (q.trim()) partes.push('q=' + encodeURIComponent(q.trim()));
        navegar('categoria.html' + (partes.length ? '?' + partes.join('&') : ''));
      });
    }

    galeria.init();
    return vista('pagina_inicio', {}, function (d) {
      pintarCategorias($('#fg-categorias'), d.categorias, 8);
      pintarSelect(d.categorias || []);
      pintarDestacados(d.destacados || [], 0);
      pintarOfertas(d.ofertas || []);
      galeria.pintar(d.videos);
    }, function () {
      mensaje(grid, ERROR_RED[0], ERROR_RED[1], function () { location.reload(); });
      if (ofertas) ofertas.replaceChildren();
    }).then(function (d) { galeria.datosListos(); return d; });
  }

  function paginaCategorias() {
    var cont = $('#fg-categorias');
    return vista('pagina_inicio', {}, function (d) {
      pintarCategorias(cont, d.categorias, 0);
    }, function () { mensaje(cont, ERROR_RED[0], ERROR_RED[1], function () { location.reload(); }); });
  }

  function parametros() {
    var out = {};
    var q = (window.location.search || '').replace(/^\?/, '');
    if (!q) return out;
    // Un enlace mal formado (ej. "?q=50%") no debe tumbar la página: se usa el texto tal cual.
    var dec = function (s) { s = s.replace(/\+/g, ' '); try { return decodeURIComponent(s); } catch (e) { return s; } };
    q.split('&').forEach(function (par) {
      var i = par.indexOf('=');
      out[dec(i < 0 ? par : par.slice(0, i))] = i < 0 ? '' : dec(par.slice(i + 1));
    });
    return out;
  }

  // Cabecera y barra móvil de las páginas con estilo de hoteles: muestran la categoría actual.
  function marcarCategoria(c) {
    var nombre = c ? c.nombre : 'Negocios';
    var nav = $('#fg-nav-cat');
    if (nav) { nav.textContent = nombre; nav.href = c ? urlCategoria(c.slug) : 'categoria.html'; }
    var bot = $('#fg-bottom-cat');
    if (bot) {
      bot.href = c ? urlCategoria(c.slug) : 'categoria.html';
      var s = $('span', bot);
      if (s) s.textContent = nombre;
    }
    var pub = $('.publish-btn-header');
    if (pub && pub.lastChild && pub.lastChild.nodeType === 3) {
      pub.lastChild.textContent = '\n                        ' + (c && c.slug === 'hoteles' ? 'Publica tu Hotel' : 'Publica tu negocio') + '\n                    ';
    }
  }

  function paginaCategoria() {
    var p = parametros();
    var cat = (p.cat || '').trim().slice(0, 60);
    var q = (p.q || '').trim().slice(0, 80);
    var pagina = Math.max(1, parseInt(p.p, 10) || 1);
    var lista = $('#fg-lista');
    var pag = $('#fg-paginacion');
    var fq = $('#fg-filtro-q');
    var fc = $('#fg-filtro-cat');
    if (fq) fq.value = q;
    if (fc) { fc.value = cat; if (!cat) fc.disabled = true; }

    function urlPagina(n) {
      var partes = [];
      if (cat) partes.push('cat=' + encodeURIComponent(cat));
      if (q) partes.push('q=' + encodeURIComponent(q));
      if (n > 1) partes.push('p=' + n);
      return 'categoria.html' + (partes.length ? '?' + partes.join('&') : '');
    }

    function pintarPaginacion(total, pp) {
      if (!pag) return;
      var paginas = Math.ceil(total / pp);
      var frag = document.createDocumentFragment();
      function enlace(txt, n, activo, etiqueta) {
        var a = document.createElement('a');
        a.className = 'page-link' + (activo ? ' active' : '');
        a.href = urlPagina(n);
        a.textContent = txt;
        if (etiqueta) a.setAttribute('aria-label', etiqueta);
        if (activo) a.setAttribute('aria-current', 'page');
        frag.appendChild(a);
      }
      if (paginas > 1) {
        if (pagina > 1) enlace('<', pagina - 1, false, 'Página anterior');
        var desde = Math.max(1, Math.min(pagina - 2, paginas - 4));
        var hasta = Math.min(paginas, desde + 4);
        for (var i = desde; i <= hasta; i++) enlace(String(i), i, i === pagina);
        if (pagina < paginas) enlace('>', pagina + 1, false, 'Página siguiente');
      }
      pag.replaceChildren(frag);
    }

    function encabezado(d) {
      var c = d.categoria;
      var nombre = c ? c.nombre : 'Negocios';
      var titulo = q ? 'Resultados para “' + q + '”' + (c ? ' en ' + c.nombre : '') : nombre;
      document.title = titulo + ' | FullGuia.com';
      var t = $('#fg-titulo');
      if (t) t.textContent = c ? nombre : (q ? 'resultados' : 'negocios');
      var tot = $('#fg-total');
      if (tot) tot.textContent = String(d.total || 0);
      marcarCategoria(c);
    }

    function pintar(d) {
      encabezado(d);
      if (cat && !d.categoria) {
        mensaje(lista, 'Esta categoría no existe', 'Revisa todas las categorías disponibles.');
        if (pag) pag.replaceChildren();
        return;
      }
      var items = d.items || [];
      if (!items.length) {
        mensaje(lista, q ? 'No encontramos negocios para “' + q + '”' : 'Aún no hay negocios en esta categoría',
          q ? 'Prueba con otra palabra, sin tildes también funciona.' : 'Vuelve pronto.');
        pintarPaginacion(d.total || 0, d.por_pagina || 20);
        return;
      }
      var frag = document.createDocumentFragment();
      var seccion = null;
      var letraActual = null;
      items.forEach(function (n, i) {
        var letra = n.destacado ? '★' : (normalizar(n.nombre).charAt(0).toUpperCase() || '#');
        if (!/^[A-Z★]/.test(letra)) letra = '#';
        if (letra !== letraActual) {
          seccion = clonar('tpl-seccion');
          var h = $('.alphabet-letter-heading', seccion);
          h.textContent = letra;
          h.setAttribute('aria-label', letra === '★' ? 'Destacados' : 'Letra ' + letra);
          h.title = letra === '★' ? 'Destacados' : letra;
          frag.appendChild(seccion);
          letraActual = letra;
        }
        var card = llenarHotel(n, false, i === 0);
        if (card) $('.alphabet-group', seccion).appendChild(card);
      });
      lista.replaceChildren(frag);
      pintarPaginacion(d.total || 0, d.por_pagina || 20);
    }

    return vista('buscar_negocios', { q: q || null, cat: cat || null, pagina: pagina, por_pagina: C.POR_PAGINA || 20 }, pintar,
      function () { mensaje(lista, ERROR_RED[0], ERROR_RED[1], function () { location.reload(); }); });
  }

  function paginaNegocio() {
    var slug = (parametros().slug || '').trim().slice(0, 140);
    var cont = $('#fg-detalle');
    function noExiste() {
      $('#fg-nombre').textContent = 'Negocio no encontrado';
      mensaje(cont, 'Este negocio no existe o ya no está publicado', 'Busca otros negocios desde el inicio.');
    }
    if (!slug) { noExiste(); return Promise.resolve(null); }
    return vista('pagina_negocio', { p_slug: slug }, function (d) {
      var n = d.negocio;
      if (!n) { noExiste(); return; }
      document.title = n.nombre + ' | FullGuia.com';
      var meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute('content', n.nombre + ' en ' + (n.ciudad || 'tu región') + '. Contacto por WhatsApp en FullGuia.com');
      $('#fg-nombre').textContent = n.nombre;
      $('#fg-descripcion').textContent = [n.etiqueta || n.categoria, n.ciudad].filter(Boolean).join(' · ');
      var miga = $('#fg-miga-cat');
      if (miga) { miga.textContent = n.categoria; miga.href = urlCategoria(n.categoria_slug); }
      $('#fg-miga-nombre').textContent = n.nombre;
      marcarCategoria({ nombre: n.categoria, slug: n.categoria_slug });
      var card = llenarHotel(n, true);
      cont.replaceChildren(card);
      var bloque = $('#fg-detalle-ofertas');
      var lo = $('#fg-ofertas-lista');
      var ofs = n.ofertas || [];
      if (bloque && lo) {
        var frag = document.createDocumentFragment();
        ofs.forEach(function (o) {
          var el = clonar('tpl-oferta-detalle');
          texto(el, 'descuento', o.descuento);
          texto(el, 'titulo', o.titulo);
          ponerImagen(campos(el, 'imagen')[0], o.imagen, o.imagen_mini, o.titulo, '(min-width: 640px) 300px, 100vw');
          frag.appendChild(el);
        });
        lo.replaceChildren(frag);
        bloque.hidden = !ofs.length;
      }
    }, function () { mensaje(cont, ERROR_RED[0], ERROR_RED[1], function () { location.reload(); }); });
  }

  // ---------------------------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------------------------
  var PAGINAS = { inicio: paginaInicio, categoria: paginaCategoria, negocio: paginaNegocio, categorias: paginaCategorias };

  function iniciar() {
    activarFavoritos();
    activarPublicar();
    activarPerfil();
    var pg = document.body && document.body.getAttribute('data-fg-pagina');
    var f = PAGINAS[pg];
    return f ? f() : Promise.resolve(null);
  }

  var listo;
  if (document.readyState === 'loading') {
    listo = new Promise(function (res) { document.addEventListener('DOMContentLoaded', function () { res(iniciar()); }); });
  } else {
    listo = Promise.resolve(iniciar());
  }

  // Para pruebas y para el panel (utilidades compartidas, sin datos sensibles).
  window.FG = {
    listo: listo, rpc: rpc, vista: vista, cache: cache, claveDe: claveDe, urlImagen: urlImagen,
    numeroWhatsapp: numeroWhatsapp, precio: precio, estrellas: estrellas, normalizar: normalizar,
    ICONOS: ICONOS, LIMITE: LIMITE, galeria: galeria
  };
})();
