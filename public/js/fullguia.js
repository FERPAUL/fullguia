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
  function rpc(fn, args) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    return fetch(C.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: C.SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
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
      var btn = e.target.closest && e.target.closest('.business-fav-btn, .hotel-fav-btn, .icon-btn');
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
          window.location.href = 'index.html#publicar';
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Fachada de YouTube
  // ---------------------------------------------------------------------------
  function activarVideo() {
    $$('.fg-video').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = (b.getAttribute('data-video') || '').replace(/[^A-Za-z0-9_-]/g, '');
        if (!id) return;
        var f = document.createElement('iframe');
        f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?controls=1&autoplay=1';
        f.title = b.getAttribute('aria-label') || 'Video';
        f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        f.setAttribute('allowfullscreen', '');
        b.parentNode.replaceChild(f, b);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Tarjetas de negocio
  // ---------------------------------------------------------------------------
  function llenarDestacado(n) {
    var card = clonar('tpl-negocio');
    if (!card) return null;
    campos(card, 'enlace').forEach(function (a) { a.href = urlNegocio(n.slug); });
    texto(card, 'nombre', n.nombre);
    ponerImagen(campos(card, 'imagen')[0], n.imagen, n.imagen_mini, n.nombre, '(min-width: 1200px) 300px, (min-width: 640px) 50vw, 100vw');
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

  function llenarHotel(n, detalle) {
    var card = clonar('tpl-hotel');
    if (!card) return null;
    mostrar(campos(card, 'destacado')[0], !!n.destacado);
    campos(card, 'enlace').forEach(function (a) { a.href = urlNegocio(n.slug); });
    texto(card, 'nombre', n.nombre);
    ponerImagen(campos(card, 'imagen')[0], n.imagen, n.imagen_mini, n.nombre,
      detalle ? '(min-width: 640px) 400px, 100vw' : '(min-width: 640px) 300px, 100vw');
    if (detalle) { var im = campos(card, 'imagen')[0]; if (im) im.loading = 'eager'; }

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
          '(min-width: 1024px) 300px, (min-width: 640px) 50vw, 100vw');
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
        window.location.href = 'categoria.html' + (partes.length ? '?' + partes.join('&') : '');
      });
    }

    return vista('pagina_inicio', {}, function (d) {
      pintarCategorias($('#fg-categorias'), d.categorias, 8);
      pintarSelect(d.categorias || []);
      pintarDestacados(d.destacados || [], 0);
      pintarOfertas(d.ofertas || []);
    }, function () {
      mensaje(grid, ERROR_RED[0], ERROR_RED[1], function () { location.reload(); });
      if (ofertas) ofertas.replaceChildren();
    });
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
    q.split('&').forEach(function (par) {
      var i = par.indexOf('=');
      var k = decodeURIComponent((i < 0 ? par : par.slice(0, i)).replace(/\+/g, ' '));
      var v = i < 0 ? '' : decodeURIComponent(par.slice(i + 1).replace(/\+/g, ' '));
      out[k] = v;
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
      items.forEach(function (n) {
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
        var card = llenarHotel(n, false);
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
    activarVideo();
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
    ICONOS: ICONOS, LIMITE: LIMITE
  };
})();
