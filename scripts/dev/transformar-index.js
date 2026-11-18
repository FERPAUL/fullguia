// Herramienta de una sola vez: aplica a public/index.html (copia de originales/index.html)
// los cambios permitidos para conectarlo a datos. Se deja como registro de qué se cambió.
const fs = require('fs');
const path = require('path');
const F = path.join(__dirname, '..', '..', 'public', 'index.html');
let h = fs.readFileSync(F, 'utf8');
const rep = (a, b, txt) => {
  const i = h.indexOf(a); const j = h.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('no encontrado ' + a);
  h = h.slice(0, i) + txt + h.slice(j);
};
const nombres = { Salud: 'salud', 'Vehículos': 'vehiculos', Hogar: 'hogar', 'Tecnología': 'tecnologia', 'Educación': 'educacion', 'Más categorías': null };
h = h.replace(/<a href="#" class="category-card">([\s\S]*?)<span class="category-name">([^<]+)<\/span>/g, (m, mid, n) => {
  const s = nombres[n];
  return '<a href="' + (s ? 'categoria.html?cat=' + s : 'categorias.html') + '" class="category-card">' + mid + '<span class="category-name">' + n + '</span>';
});
const sk = '                    <div class="business-card fg-sk-card" aria-hidden="true"><div class="business-image-wrapper fg-sk"></div><div class="business-content"><span class="fg-sk fg-sk-linea"></span><span class="fg-sk fg-sk-linea fg-sk-corta"></span></div></div>\n';
rep('<div class="businesses-grid">', '<!-- Pagination Pointers -->',
  '<div class="businesses-grid" id="fg-destacados" aria-live="polite">\n' + sk.repeat(4) + '                </div>\n\n                ');
rep('<div class="pagination-dots">', '</section>', '<div class="pagination-dots" id="fg-dots"></div>\n            ');
const tplCard = fs.readFileSync(path.join(__dirname, 'tpl-negocio-index.html'), 'utf8').trimEnd();
const tplCat = [
  '<template id="tpl-categoria">',
  '            <a href="" class="category-card">',
  '                <div class="category-icon-box"></div>',
  '                <span class="category-name"></span>',
  '            </a>',
  '        </template>'].join('\n');
const skO = '                <div class="offer-card fg-sk-oferta" aria-hidden="true"><div class="offer-image fg-sk"></div></div>\n';
rep('<div class="offers-grid">', '</section>',
  '<div class="offers-grid" id="fg-ofertas">\n' + skO.repeat(4) + '            </div>\n' +
  '            <template id="tpl-oferta">\n' +
  '                <a class="offer-card" data-f="enlace">\n' +
  '                    <span class="badge-discount" data-f="descuento"></span>\n' +
  '                    <img src="" alt="" class="offer-image" data-f="imagen" loading="lazy" width="500" height="160">\n' +
  '                </a>\n' +
  '            </template>\n        ');
h = h.replace('<section class="offers-section">', '<section class="offers-section" id="ofertas">');
h = h.replace('    </main>', '        ' + tplCard + '\n        ' + tplCat + '\n    </main>');
h = h.replace('<a href="#" class="nav-link active">Inicio</a>', '<a href="index.html" class="nav-link active">Inicio</a>')
  .replace('<a href="#" class="nav-link">Negocios</a>', '<a href="categoria.html" class="nav-link">Negocios</a>')
  .replace('<a href="#" class="nav-link">Ofertas</a>', '<a href="#ofertas" class="nav-link">Ofertas</a>')
  .replace('<a href="#" class="logo-container" title="FullGuia.com">', '<a href="index.html" class="logo-container" title="FullGuia.com">')
  .replace(/(<h2 class="section-title">Negocios destacados<\/h2>\s*)<a href="#" class="see-all-link">/, '$1<a href="categoria.html" class="see-all-link">')
  .replace(/(<h2 class="section-title">Ofertas destacadas<\/h2>\s*)<a href="#" class="see-all-link">/, '$1<a href="#ofertas" class="see-all-link">');
h = h.replace('<button class="btn btn-primary publish-btn-header">', '<button class="btn btn-primary publish-btn-header" data-fg="publicar">')
  .replace('<button class="btn btn-primary cta-button">', '<button class="btn btn-primary cta-button" data-fg="publicar">');
h = h.replace(/<a href="#">Inicio<\/a>(\s*)<a href="#">Categorías<\/a>(\s*)<a href="#">Empresas<\/a>(\s*)<a href="#">Ofertas<\/a>/,
  '<a href="index.html">Inicio</a>$1<a href="categorias.html">Categorías</a>$2<a href="categoria.html">Empresas</a>$3<a href="#ofertas">Ofertas</a>');
h = h.replace('<a href="#">Publica tu empresa</a>', '<a href="#" data-fg="publicar">Publica tu empresa</a>');
h = h.replace(/(<nav class="bottom-nav">[\s\S]*?)<\/nav>/, (m) => {
  let i = 0; const dest = ['index.html', 'categorias.html', '#buscar', '#ofertas', '#'];
  return m.replace(/<a href="#" class="bottom-nav-item/g, () => '<a href="' + dest[i++] + '" class="bottom-nav-item');
});
const s = h.indexOf('    <!-- Vanilla JS Lighter interacciones (Opcional) -->');
const e = h.indexOf('</script>', s) + 9;
if (s < 0) throw new Error('script original no encontrado');
h = h.slice(0, s) + '    <!-- Interacciones (favoritos, buscador, datos): ver js/fullguia.js -->' + h.slice(e);
h = h.replace('<body>', '<body data-fg-pagina="inicio">');
fs.writeFileSync(F, h);
console.log('index.html transformado', h.length);
