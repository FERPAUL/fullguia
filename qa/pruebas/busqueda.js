// R7 búsqueda sin tildes · R8 orden (destacados vigentes primero; vencidos bajan solos) · paginado.
const { rpc } = require('../lib/supa');
const { conectar } = require('../lib/db');

const MARCA = 'QA-BUS';

module.exports = async function (ctx) {
  const db = await conectar();
  const limpiar = () => db.query('delete from public.negocios where nombre like $1', [MARCA + '%']);
  try {
    await limpiar();
    const cat = (await db.query("select id from public.categorias where slug='educacion'")).rows[0].id;
    const hoy = (await db.query('select privado.hoy()::text h')).rows[0].h;
    // En "educacion": A vencido ayer, Z vigente, Á normal, M destacado que vence HOY (sigue vigente), B pausado.
    await db.query(`insert into public.negocios (nombre, categoria_id, ciudad, plan, destacado_hasta, activo, descripcion) values
      ($1, $6, 'Ocaña', 'destacado', privado.hoy() - 1, true, 'academia de inglés'),
      ($2, $6, 'Ocaña', 'destacado', privado.hoy() + 10, true, 'academia de música'),
      ($3, $6, 'Ocaña', 'gratis', null, true, 'ábaco y matemáticas'),
      ($4, $6, 'Ocaña', 'destacado', privado.hoy(), true, 'colegio'),
      ($5, $6, 'Ocaña', 'destacado', privado.hoy() + 10, false, 'pausado')`,
    [MARCA + ' Aaa Vencido', MARCA + ' Zzz Vigente', MARCA + ' Ábaco Normal', MARCA + ' Mmm Vence Hoy', MARCA + ' Bbb Pausado', cat]);

    // --- R7: sin tildes / mayúsculas / prefijos ---
    const casos = [['hotel cucuta', 'Hotel Plaza Suite Executiva'], ['HOTEL CÚCUTA', 'Hotel Plaza Suite Executiva'], ['cucu', 'Hotel Boutique San Diego'],
      ['chinacota', 'Resort Campestre El Manantial'], ['parrilla', 'La Parrilla Real'], ['ocana abaco', MARCA + ' Ábaco Normal'],
      ['musica', MARCA + ' Zzz Vigente'], ['wifi', 'Hostal Colonial Los Patios']];
    for (const [q, espera] of casos) {
      const r = await rpc('buscar_negocios', { q });
      const nombres = (r.json && r.json.items || []).map((x) => x.nombre);
      ctx.ok('R7', 'Buscar "' + q + '" encuentra ' + espera, r.status === 200 && nombres.indexOf(espera) >= 0, nombres.slice(0, 4).join(', '));
    }
    const r0 = await rpc('buscar_negocios', { q: 'hotel cucuta' });
    ctx.ok('R7', '"hotel cucuta" no trae negocios que no son de Cúcuta', (r0.json.items || []).every((x) => /c[uú]cuta/i.test((x.ciudad || '') + ' ' + (x.direccion || ''))));
    const r1 = await rpc('buscar_negocios', { q: 'xyzzy-no-existe' });
    ctx.ok('R7', 'Una búsqueda sin coincidencias devuelve total 0 (sin error)', r1.status === 200 && r1.json.total === 0 && r1.json.items.length === 0);
    const r2 = await rpc('buscar_negocios', { q: "'); drop table negocios; --" });
    ctx.ok('R7', 'Texto malicioso en la búsqueda no rompe nada', r2.status === 200);
    const r3 = await rpc('buscar_negocios', { q: 'ábaco', cat: 'hoteles' });
    ctx.ok('R7', 'La búsqueda respeta el filtro de categoría', r3.status === 200 && r3.json.total === 0);
    const r3b = await rpc('buscar_negocios', { ciudad: 'cucuta' });
    ctx.ok('R7', 'El filtro por ciudad funciona sin tildes', r3b.status === 200 && r3b.json.total >= 3 && r3b.json.items.every((x) => /c[uú]cuta/i.test(x.ciudad)), 'total ' + r3b.json.total);

    // --- R8: orden ---
    const e = await rpc('buscar_negocios', { cat: 'educacion' });
    const lista = (e.json.items || []).filter((x) => x.nombre.indexOf(MARCA) === 0).map((x) => x.nombre.replace(MARCA + ' ', '') + (x.destacado ? '*' : ''));
    ctx.info('Orden en Educación: ' + lista.join(' · '));
    ctx.ok('R8', 'Destacados vigentes primero (incluido el que vence hoy), luego A-Z sin tildes',
      JSON.stringify(lista) === JSON.stringify(['Mmm Vence Hoy*', 'Zzz Vigente*', 'Aaa Vencido', 'Ábaco Normal']), lista.join(', '));
    ctx.ok('R8', 'Un destacado vencido se muestra como normal (sin insignia) y no va primero',
      (e.json.items || []).some((x) => x.nombre === MARCA + ' Aaa Vencido' && x.destacado === false));
    ctx.ok('R2', 'Un negocio pausado no aparece en la búsqueda pública', lista.every((x) => x.indexOf('Pausado') < 0));
    const ini = await rpc('pagina_inicio', {});
    const dest = (ini.json.destacados || []).map((x) => x.nombre);
    ctx.ok('R8', 'El inicio muestra solo destacados vigentes', dest.indexOf(MARCA + ' Zzz Vigente') >= 0 && dest.indexOf(MARCA + ' Aaa Vencido') < 0 && dest.indexOf(MARCA + ' Bbb Pausado') < 0);
    ctx.ok('R8', 'Todos los destacados del inicio están vigentes', (ini.json.destacados || []).every((x) => x.destacado === true));
    ctx.ok('R8', 'La fecha de corte es la de Colombia (America/Bogota)', /^\d{4}-\d{2}-\d{2}$/.test(hoy), hoy);

    // --- Paginado (R9) ---
    const p1 = await rpc('buscar_negocios', { pagina: 1, por_pagina: 3 });
    const p2 = await rpc('buscar_negocios', { pagina: 2, por_pagina: 3 });
    const fuera = await rpc('buscar_negocios', { pagina: 999, por_pagina: 3 });
    const ids1 = p1.json.items.map((x) => x.id), ids2 = p2.json.items.map((x) => x.id);
    ctx.ok('R9', 'Paginado: 3 por página, páginas distintas y mismo total', ids1.length === 3 && ids2.length === 3 && !ids1.some((i) => ids2.indexOf(i) >= 0) && p1.json.total === p2.json.total);
    ctx.ok('R9', 'Página fuera de rango: lista vacía pero informa el total', fuera.json.items.length === 0 && fuera.json.total === p1.json.total, 'total ' + fuera.json.total);
    const def = await rpc('buscar_negocios', {});
    ctx.ok('R9', 'Por defecto entrega 20 por página', def.json.por_pagina === 20 && def.json.items.length <= 20);
    const max = await rpc('buscar_negocios', { por_pagina: 5000 });
    ctx.ok('R9', 'No se pueden pedir más de 50 por página', max.json.por_pagina === 50);
    const neg = await rpc('pagina_negocio', { p_slug: 'hotel-plaza-suite-executiva' });
    ctx.ok('R11', 'Detalle de negocio por slug', neg.status === 200 && neg.json.negocio && neg.json.negocio.nombre === 'Hotel Plaza Suite Executiva');
    const no = await rpc('pagina_negocio', { p_slug: 'no-existe-' + Date.now() });
    ctx.ok('R11', 'Detalle de un slug inexistente devuelve negocio null', no.status === 200 && no.json.negocio === null);
    const pausado = (await db.query('select slug from public.negocios where nombre=$1', [MARCA + ' Bbb Pausado'])).rows[0].slug;
    const np = await rpc('pagina_negocio', { p_slug: pausado });
    ctx.ok('R2', 'El detalle de un negocio pausado no es visible al público', np.json.negocio === null);
    const slugs = (await db.query("select slug from public.negocios where nombre like $1 order by slug", [MARCA + '%'])).rows.map((x) => x.slug);
    ctx.ok('R11', 'Los slugs se generan solos, sin tildes y únicos', slugs.every((s) => /^[a-z0-9-]+$/.test(s)) && new Set(slugs).size === slugs.length, slugs[0]);
    const v1 = (await rpc('version_datos', {})).json;
    await db.query('delete from public.negocios where nombre=$1', [MARCA + ' Bbb Pausado']);
    const v2 = (await rpc('version_datos', {})).json;
    ctx.ok('R12', 'Borrar un negocio cambia la versión de datos (la caché se invalida)', v1 !== v2, v1 + ' → ' + v2);
  } finally {
    await limpiar();
    await db.end();
  }
};
