// Herramienta de una sola vez: crea negocio.html (a partir de categoria.html, estilo hoteles)
// y categorias.html (a partir de index.html). Reutilizan cabecera, pie y CSS de las maquetas.
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..', '..', 'public');
const must = (c, m) => { if (!c) throw new Error(m); };

// ---------------- negocio.html ----------------
let n = fs.readFileSync(path.join(P, 'categoria.html'), 'utf8');
const mi = n.indexOf('    <main class="container">');
const mf = n.indexOf('    </main>') + '    </main>'.length;
must(mi > 0 && mf > mi, 'main no encontrado');
const tplHotel = n.slice(n.indexOf('<template id="tpl-hotel">'), n.indexOf('</template>', n.indexOf('<template id="tpl-hotel">')) + 11);
const mainNegocio = `    <!-- ==========================================================================
         DETALLE DEL NEGOCIO
         ========================================================================== -->
    <section class="hotel-hero">
        <div class="container">
            <nav class="breadcrumb" aria-label="Ruta">
                <a href="index.html">Inicio</a> <span>›</span>
                <a href="categoria.html" id="fg-miga-cat">Categoría</a> <span>›</span>
                <span id="fg-miga-nombre">Negocio</span>
            </nav>
            <div class="hotel-hero-header">
                <h1 class="hotel-hero-title" id="fg-nombre"><span class="fg-sk fg-sk-linea" style="display:inline-block;width:60%"></span></h1>
                <p class="hotel-hero-desc" id="fg-descripcion"></p>
            </div>
        </div>
    </section>

    <main class="container">
        <div class="directory-layout">
            <section class="hotels-listing">
                <div class="hotels-list" id="fg-detalle" aria-live="polite">
                    <article class="hotel-card fg-sk-hotel" aria-hidden="true"><div class="hotel-img-wrapper fg-sk"></div><div class="hotel-info"><span class="fg-sk fg-sk-linea"></span><span class="fg-sk fg-sk-linea fg-sk-corta"></span></div></article>
                </div>
                <div id="fg-detalle-ofertas" class="fg-ofertas-detalle" hidden>
                    <h2 class="section-title">Ofertas vigentes</h2>
                    <div class="fg-ofertas-grid" id="fg-ofertas-lista"></div>
                </div>
            </section>
        </div>
        ${tplHotel}
        <template id="tpl-oferta-detalle">
            <div class="fg-oferta">
                <span class="badge-featured" data-f="descuento"></span>
                <img src="" alt="" data-f="imagen" loading="lazy" width="400" height="160">
                <span class="fg-oferta-titulo" data-f="titulo"></span>
            </div>
        </template>
    </main>`;
n = n.slice(0, mi) + mainNegocio + n.slice(mf);
// quitar "HERO SECTION DE HOTELES" comentario previo y ajustar textos
n = n.replace('<body data-fg-pagina="categoria">', '<body data-fg-pagina="negocio">');
n = n.replace(/<title>[^<]*<\/title>/, '<title>Negocio | FullGuia.com</title>');
n = n.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="FullGuia.com - Información, ubicación y contacto por WhatsApp de negocios de tu región.">');
fs.writeFileSync(path.join(P, 'negocio.html'), n);

// ---------------- categorias.html ----------------
let c = fs.readFileSync(path.join(P, 'index.html'), 'utf8');
const ci = c.indexOf('    <main class="container">');
const cf = c.indexOf('    </main>') + '    </main>'.length;
const tplCat = c.slice(c.indexOf('<template id="tpl-categoria">'), c.indexOf('</template>', c.indexOf('<template id="tpl-categoria">')) + 11);
const mainCats = `    <main class="container">
        <!-- ==========================================================================
             TODAS LAS CATEGORÍAS
             ========================================================================== -->
        <section class="categories-section">
            <div class="section-header">
                <h1 class="section-title">Todas las categorías</h1>
                <a href="categoria.html" class="see-all-link">Ver todos los negocios</a>
            </div>
            <div class="categories-grid" id="fg-categorias" aria-live="polite"></div>
        </section>
        ${tplCat}
    </main>`;
c = c.slice(0, ci) + mainCats + c.slice(cf);
c = c.replace('<body data-fg-pagina="inicio">', '<body data-fg-pagina="categorias">');
c = c.replace('<a href="index.html" class="nav-link active">Inicio</a>', '<a href="index.html" class="nav-link">Inicio</a>')
     .replace('<a href="categorias.html" class="nav-link">Categorías</a>', '<a href="categorias.html" class="nav-link active">Categorías</a>');
c = c.replace(/<a href="index.html" class="bottom-nav-item active">/, '<a href="index.html" class="bottom-nav-item">')
     .replace('<a href="categorias.html" class="bottom-nav-item">', '<a href="categorias.html" class="bottom-nav-item active">')
     .replace('<a href="#buscar" class="bottom-nav-item">', '<a href="index.html#buscar" class="bottom-nav-item">')
     .replace('<a href="#ofertas" class="bottom-nav-item">', '<a href="index.html#ofertas" class="bottom-nav-item">')
     .replace(/<a href="#ofertas">Ofertas<\/a>/g, '<a href="index.html#ofertas">Ofertas</a>')
     .replace('<a href="#ofertas" class="nav-link">Ofertas</a>', '<a href="index.html#ofertas" class="nav-link">Ofertas</a>');
c = c.replace(/<title>[^<]*<\/title>/, '<title>Categorías | FullGuia.com</title>');
fs.writeFileSync(path.join(P, 'categorias.html'), c);
console.log('negocio.html y categorias.html creados');
