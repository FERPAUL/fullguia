// Fidelidad de diseño: el <style> original queda idéntico y la estructura (clases) de cabecera, pie,
// barra móvil, barra lateral y tarjetas coincide con originales/. Solo se permiten cambios en
// href, id, data-*, aria-*, loading, width/height, src/srcset (los llena el JS) y el texto dinámico.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const leer = (ctx, ...p) => fs.readFileSync(path.join(ctx.RAIZ, ...p), 'utf8').replace(/\r\n/g, '\n');
const estilo = (h) => ((/<style>([\s\S]*?)<\/style>/.exec(h) || [])[1] || '').trim();
const dom = (h) => new JSDOM(h).window.document;

// Firma estructural: etiquetas + clases en orden (sin textos ni atributos permitidos).
function firma(el) {
  if (!el) return '(no existe)';
  const partes = [];
  (function rec(n, nivel) {
    if (n.nodeType !== 1) return;
    const tag = n.tagName.toLowerCase();
    if (tag === 'svg') { partes.push('  '.repeat(nivel) + 'svg'); return; }  // íconos: se comparan aparte
    // Envoltorios del texto dinámico (<span data-f> / <a data-f> sin clase): transparentes
    if ((tag === 'span' || tag === 'a') && n.hasAttribute('data-f') && !n.className) { for (const c of n.children) rec(c, nivel); return; }
    // "active" es estado de navegación: cambia según la página
    const clases = (n.className && typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter((c) => c !== 'active') : []).sort();
    partes.push('  '.repeat(nivel) + tag + (clases.length ? '.' + clases.join('.') : ''));
    for (const c of n.children) rec(c, nivel + 1);
  })(el, 0);
  return partes.join('\n');
}
function diferencia(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return 'línea ' + (i + 1) + ': original «' + (x[i] || '') + '» vs «' + (y[i] || '') + '»';
  return '';
}

module.exports = async function (ctx) {
  const oIndex = leer(ctx, 'originales', 'index.html');
  const oHoteles = leer(ctx, 'originales', 'hoteles.html');
  const pares = [
    ['index.html', oIndex], ['categorias.html', oIndex], ['categoria.html', oHoteles], ['negocio.html', oHoteles]
  ];

  // Las maquetas originales siguen intactas (comparadas con Descargas si existen).
  for (const [orig, desc] of [['index.html', 'index (6).html'], ['hoteles.html', 'hoteles.html']]) {
    const d = path.join(process.env.USERPROFILE || '', 'Downloads', desc);
    if (fs.existsSync(d)) ctx.ok('R10', 'originales/' + orig + ' es copia exacta de la maqueta del cliente', fs.readFileSync(d).equals(fs.readFileSync(path.join(ctx.RAIZ, 'originales', orig))));
  }

  for (const [pag, orig] of pares) {
    const h = leer(ctx, 'public', pag);
    ctx.ok('R10', pag + ': el bloque <style> es idéntico al original', estilo(h) === estilo(orig) && estilo(h).length > 1000,
      estilo(h) === estilo(orig) ? (estilo(h).length / 1024).toFixed(1) + ' KB' : 'distinto');
    const a = dom(orig), b = dom(h);
    for (const sel of ['header.site-header', 'footer.site-footer', 'nav.bottom-nav']) {
      const d = diferencia(firma(a.querySelector(sel)), firma(b.querySelector(sel)));
      ctx.ok('R10', pag + ': estructura de ' + sel + ' igual al original', !d, d);
    }
    // Íconos SVG iguales en cabecera, pie y barra móvil
    for (const sel of ['header.site-header', 'footer.site-footer', 'nav.bottom-nav']) {
      const sv = (doc) => Array.from(doc.querySelectorAll(sel + ' svg')).map((s) => s.outerHTML.replace(/\s+/g, ' ')).join('|');
      ctx.ok('R10', pag + ': íconos de ' + sel + ' idénticos', sv(a) === sv(b));
    }
    // Textos visibles de la cabecera iguales (salvo el enlace de la categoría, que el JS ajusta)
    const textos = (doc) => Array.from(doc.querySelectorAll('header.site-header a, header.site-header button')).map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join('|');
    ctx.ok('R10', pag + ': textos de la cabecera iguales al original', textos(a) === textos(b), textos(a) === textos(b) ? '' : textos(b));
    ctx.ok('R10', pag + ': mismas fuentes (Google Fonts Poppins)', h.indexOf('family=Poppins:wght@400;500;600;700;800') > 0);
  }

  // Tarjetas: las plantillas conservan la estructura de las tarjetas originales
  const a = dom(oIndex), b = dom(leer(ctx, 'public', 'index.html'));
  const tplNeg = b.getElementById('tpl-negocio').content.firstElementChild;
  const quitarEnlaces = (el) => { const c = el.cloneNode(true); c.querySelectorAll('span[data-f="opiniones"]').forEach((x) => x.replaceWith(x.ownerDocument.createTextNode(''))); return c; };
  const d1 = diferencia(firma(a.querySelector('.business-card')), firma(quitarEnlaces(tplNeg)));
  ctx.ok('R10', 'Tarjeta de destacado (index): misma estructura que la original', !d1, d1);
  const d2 = diferencia(firma(a.querySelector('.offer-card')), firma(b.getElementById('tpl-oferta').content.firstElementChild).replace(/^a\./, 'div.'));
  ctx.ok('R10', 'Tarjeta de oferta (index): misma estructura que la original', !d2, d2);
  const d3 = diferencia(firma(a.querySelector('aside.sidebar')), firma(b.querySelector('aside.sidebar')));
  ctx.ok('R10', 'Barra lateral (¿Tienes un negocio? / Noticias) igual a la original', !d3, d3);
  const tplCat = b.getElementById('tpl-categoria').content.firstElementChild.cloneNode(true);
  tplCat.querySelector('.category-icon-box').appendChild(b.createElementNS('http://www.w3.org/2000/svg', 'svg'));   // el JS pone el ícono
  const d4 = diferencia(firma(a.querySelector('.categories-grid .category-card')), firma(tplCat).replace('div.category-icon-box', 'div.cat-orange.category-icon-box'));
  ctx.ok('R10', 'Ícono de categoría: misma estructura que el original', !d4, d4);

  const c = dom(oHoteles), e = dom(leer(ctx, 'public', 'categoria.html'));
  const origHotel = Array.from(c.querySelectorAll('article.hotel-card')).find((x) => x.querySelector('.badge-featured'));
  const tplHotel = quitarEnlaces(e.getElementById('tpl-hotel').content.firstElementChild);
  const amen = tplHotel.querySelector('.hotel-amenities');
  origHotel.querySelectorAll('.amenity-item').forEach((x) => amen.appendChild(x.cloneNode(true)));   // el JS las agrega
  const d5 = diferencia(firma(origHotel), firma(tplHotel));
  ctx.ok('R10', 'Tarjeta de hotel (categoría): misma estructura que la original', !d5, d5);
  ctx.ok('R10', 'La zona editable de Dreamweaver (TemplateBeginEditable) se conserva', /TemplateBeginEditable name="ListaHotelesEditable"/.test(leer(ctx, 'public', 'categoria.html')));

  // Único bloque de estilos añadido: <style id="fg-estilos"> (no redefine clases del diseño original)
  const extra = ((/<style id="fg-estilos">([\s\S]*?)<\/style>/.exec(leer(ctx, 'public', 'index.html')) || [])[1] || '');
  const clasesOrig = new Set([...(estilo(oIndex) + estilo(oHoteles)).matchAll(/\.([a-z][a-z0-9-]*)\s*[{,:]/g)].map((m) => m[1]));
  const reglas = [...extra.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim());
  const pisadas = reglas.filter((sel) => sel.split(',').some((s) => { const t = s.trim(); return /^\.[a-z-]+$/.test(t) && clasesOrig.has(t.slice(1)); }));
  ctx.ok('R10', 'Los estilos añadidos (fg-estilos) no redefinen ninguna clase original por sí sola', !pisadas.length, pisadas.join(', '));
};
