// Herramienta de una sola vez: convierte public/categoria.html (copia de originales/hoteles.html)
// en la plantilla única de categoría / resultados de búsqueda. Registro de los cambios permitidos.
const fs = require('fs');
const path = require('path');
const F = path.join(__dirname, '..', '..', 'public', 'categoria.html');
let h = fs.readFileSync(F, 'utf8');
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

// 1. head: conexión
h = h.replace(
  '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">',
  '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">\n' +
  '    <!-- FullGuia: conexión a datos (no editar el diseño aquí) -->\n' +
  '    <link rel="preconnect" href="https://biajiyiyjtqocqrabrnu.supabase.co" crossorigin>\n' +
  '    <link rel="preconnect" href="https://images.unsplash.com">\n' +
  '    <link rel="stylesheet" href="css/fullguia.css">\n' +
  '    <script src="js/config.js" defer></script>\n' +
  '    <script src="js/fullguia.js" defer></script>');

// 2. navegación
h = h.replace('<a href="hoteles.html" class="nav-link active" style="color: var(--hotel-blue);">Hoteles</a>',
  '<a href="categoria.html?cat=hoteles" class="nav-link active" style="color: var(--hotel-blue);" id="fg-nav-cat">Hoteles</a>');
h = h.replace('<button class="btn btn-primary publish-btn-header">', '<button class="btn btn-primary publish-btn-header" data-fg="publicar">');

// 3. cabecera del listado: contador + filtro dentro de la categoría
const viejoHeader = '<span class="results-count">Mostrando <strong>&nbsp;</strong> Hoteles disponibles</span>';
must(h.includes(viejoHeader), 'results-count no encontrado');
h = h.replace(viejoHeader,
  '<span class="results-count" id="fg-contador">Mostrando <strong id="fg-total">&nbsp;</strong> <span id="fg-titulo">Hoteles</span> disponibles</span>\n' +
  '                    <form id="fg-filtro" role="search" action="categoria.html" method="get">\n' +
  '                        <input type="hidden" name="cat" id="fg-filtro-cat">\n' +
  '                        <input type="search" name="q" id="fg-filtro-q" class="sort-select" placeholder="Buscar..." aria-label="Buscar en esta categoría" maxlength="80">\n' +
  '                    </form>');

// 4. plantilla de tarjeta: la del Hotel Plaza Suite (tiene la insignia Destacado)
const ini = h.indexOf('<!-- Hotel Plaza Suite Executiva -->');
const cardIni = h.indexOf('<article class="hotel-card">', ini);
const cardFin = h.indexOf('</article>', cardIni) + '</article>'.length;
must(ini > 0 && cardIni > 0, 'tarjeta plantilla no encontrada');
let card = h.slice(cardIni, cardFin);
card = card
  .replace(/<img src="[^"]*" alt="Hotel Plaza Suite">/, '<a data-f="enlace" tabindex="-1"><img data-f="imagen" src="" alt="" loading="lazy" width="400" height="260"></a>')
  .replace('<span class="badge-tag">Hotel 4 Estrellas</span>', '<span class="badge-tag" data-f="etiqueta"></span>')
  .replace('<h2 class="hotel-name">Hotel Plaza Suite Executiva</h2>', '<h2 class="hotel-name"><a data-f="nombre enlace"></a></h2>')
  .replace(/(<path d="M21 10c0 7[^>]*><\/path><\/svg>)\s*Zona Centro, Cúcuta \(A 5 min del Parque Santander\)/, '$1\n                                                <span data-f="ubicacion"></span>')
  .replace('<div class="rating-score">★ 4.8 / 5</div>', '<div class="rating-score" data-f="rating"></div>')
  .replace('<div class="rating-reviews">98 opiniones</div>', '<div class="rating-reviews" data-f="opiniones"></div>')
  .replace(/<div class="hotel-amenities">[\s\S]*?<\/div>/, '<div class="hotel-amenities" data-f="amenidades"></div>')
  .replace('<span class="price-label">Desde por noche</span>', '<span class="price-label" data-f="precio_label"></span>')
  .replace('<span class="price-amount">$ 180.000 COP</span>', '<span class="price-amount" data-f="precio"></span>')
  .replace('<a href="#" class="btn btn-outline">Ver Detalle</a>', '<a href="#" class="btn btn-outline" data-f="enlace">Ver Detalle</a>')
  .replace(/<a href="https:\/\/wa\.me\/[^"]*" target="_blank" class="btn btn-whatsapp">/, '<a href="#" target="_blank" rel="noopener" class="btn btn-whatsapp" data-f="whatsapp">');
must(card.includes('data-f="whatsapp"') && card.includes('data-f="ubicacion"') && card.includes('data-f="imagen"'), 'plantilla incompleta');
card = card.replace('<span class="badge-featured">Destacado</span>', '<span class="badge-featured" data-f="destacado">Destacado</span>');

// 5. listado: esqueletos dentro de la zona editable; la plantilla fuera de ella
const li = h.indexOf('<div class="hotels-list">');
const lf = h.indexOf('<!-- TemplateEndEditable -->', li);
must(li > 0 && lf > 0, 'hotels-list no encontrado');
const sk = '                    <article class="hotel-card fg-sk-hotel" aria-hidden="true"><div class="hotel-img-wrapper fg-sk"></div><div class="hotel-info"><span class="fg-sk fg-sk-linea"></span><span class="fg-sk fg-sk-linea fg-sk-corta"></span><span class="fg-sk fg-sk-linea"></span></div></article>\n';
h = h.slice(0, li) +
  '<div class="hotels-list" id="fg-lista" aria-live="polite">\n' + sk.repeat(3) + '                </div>\n                ' +
  h.slice(lf);

// 6. paginación
h = h.replace(/<div class="pagination">[\s\S]*?<\/div>/, '<div class="pagination" id="fg-paginacion"></div>');

// 7. plantillas al final del main
const tpls =
  '        <template id="tpl-seccion">\n' +
  '            <div class="alphabet-section">\n' +
  '                <h2 class="alphabet-letter-heading"></h2>\n' +
  '                <div class="alphabet-group"></div>\n' +
  '            </div>\n' +
  '        </template>\n' +
  '        <template id="tpl-hotel">\n                            ' + card + '\n        </template>\n';
h = h.replace('    </main>', tpls + '    </main>');

// 8. enlaces del pie y barra móvil
h = h.replace('<a href="hoteles.html">Directori de Hoteles</a>', '<a href="categoria.html?cat=hoteles">Directori de Hoteles</a>')
  .replace('<a href="#">Publica tu Hotel</a>', '<a href="#" data-fg="publicar">Publica tu Hotel</a>')
  .replace('<a href="hoteles.html" class="bottom-nav-item active">', '<a href="categoria.html?cat=hoteles" class="bottom-nav-item active" id="fg-bottom-cat">');
h = h.replace(/(<a href="#">Ofertas<\/a>\s*<a href="#">Noticias<\/a>)/, (m) => m.replace('<a href="#">Ofertas</a>', '<a href="index.html#ofertas">Ofertas</a>'));
h = h.replace(/(<nav class="bottom-nav">[\s\S]*?)<a href="#" class="bottom-nav-item">(\s*<svg[^>]*><polygon)/, '$1<a href="index.html#ofertas" class="bottom-nav-item">$2');

// 9. script original -> fullguia.js
const s = h.lastIndexOf('    <script>');
const e = h.indexOf('</script>', s) + 9;
must(s > 0, 'script original no encontrado');
h = h.slice(0, s) + '    <!-- Interacciones (favoritos, listado, paginación): ver js/fullguia.js -->' + h.slice(e);
h = h.replace('<body>', '<body data-fg-pagina="categoria">');

fs.writeFileSync(F, h);
console.log('categoria.html transformado', h.length);
