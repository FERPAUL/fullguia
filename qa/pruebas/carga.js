// R9: con 2.000 negocios, la búsqueda responde en < 300 ms. Luego se borran los datos sintéticos.
// Se mide (a) el tiempo dentro de la base (EXPLAIN ANALYZE, como visitante anon) y
//         (b) el tiempo completo por internet (REST, desde este equipo hasta el servidor en EE. UU.).
const { rpc } = require('../lib/supa');
const { conectar } = require('../lib/db');

const MARCA = 'QA-CARGA';
const pct = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

module.exports = async function (ctx) {
  const db = await conectar();
  const limpiar = async () => (await db.query('delete from public.negocios where nombre like $1', [MARCA + '%'])).rowCount;
  try {
    await limpiar();
    const t0 = Date.now();
    const ins = await db.query(`
      insert into public.negocios (nombre, categoria_id, etiqueta, ciudad, direccion, amenidades, descripcion, rating, num_opiniones, plan, destacado_hasta, activo)
      select $1 || ' ' || (array['Hotel','Restaurante','Café','Taller','Clínica','Colegio','Tienda','Gimnasio','Ferretería','Panadería'])[1 + g % 10]
               || ' ' || (array['Ñandú','Ámbar','Central','Del Norte','La 10','San José','El Prado','Los Andes','Bella Vista','Real'])[1 + (g / 10) % 10] || ' ' || g,
             c.id, (array['Económico','Premium','Familiar','Ejecutivo'])[1 + g % 4],
             (array['Cúcuta','Los Patios','Villa del Rosario','Pamplona','Ocaña','Chinácota'])[1 + g % 6],
             'Calle ' || g || ' # ' || (g % 50) || '-' || (g % 99) || ', centro',
             array['📶 WiFi','🚗 Parqueadero','❄️ Aire acondicionado'],
             'Negocio sintético de prueba de carga número ' || g || '. Atención de lunes a sábado.',
             round((3 + (g % 20) / 10.0)::numeric, 1), g % 300,
             case when g % 10 = 0 then 'destacado' else 'gratis' end,
             case when g % 10 = 0 then privado.hoy() + (g % 60) - 20 else null end,
             g % 25 <> 0
      from generate_series(1, 2000) g
      join lateral (select id from public.categorias where activa order by orden offset (g % 7) limit 1) c on true`, [MARCA]);
    await db.query('analyze public.negocios');
    const total = (await db.query('select count(*)::int n from public.negocios')).rows[0].n;
    ctx.ok('R9', 'Se cargaron 2.000 negocios sintéticos', ins.rowCount === 2000, ins.rowCount + ' insertados en ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s · total en la base: ' + total);

    const consultas = [
      ['Texto "hotel cucuta"', { q: 'hotel cucuta' }],
      ['Texto "restaurante centro"', { q: 'restaurante centro' }],
      ['Prefijo "pana"', { q: 'pana' }],
      ['Categoría hoteles, página 1', { cat: 'hoteles' }],
      ['Categoría hoteles, página 10', { cat: 'hoteles', pagina: 10 }],
      ['Todo el directorio, página 1', {}],
      ['Todo el directorio, página 80', { pagina: 80 }],
      ['Ciudad "cucuta"', { ciudad: 'cucuta' }],
    ];
    // (a) dentro de la base, como visitante
    const servidor = [];
    for (const [nombre, a] of consultas) {
      const tiempos = [];
      for (let i = 0; i < 7; i++) {
        await db.query('begin; set local role anon');
        const r = await db.query('explain (analyze, format json) select public.buscar_negocios($1, $2, $3, $4, 20)', [a.q || null, a.cat || null, a.ciudad || null, a.pagina || 1]);
        await db.query('commit');
        tiempos.push(r.rows[0]['QUERY PLAN'][0]['Execution Time']);
      }
      const p95 = pct(tiempos.slice(2), 95);   // las 2 primeras calientan la caché
      servidor.push(p95);
      ctx.info(nombre + ': base ' + p95.toFixed(1) + ' ms (p95)');
    }
    ctx.ok('R9', 'Dentro de la base: toda búsqueda < 300 ms (p95)', Math.max(...servidor) < 300, 'máx ' + Math.max(...servidor).toFixed(1) + ' ms');

    // (b) completo por internet (lo que siente el visitante, sin caché)
    const red = [];
    let totalOk = true;
    for (const [nombre, a] of consultas) {
      const tiempos = [];
      for (let i = 0; i < 6; i++) {
        const r = await rpc('buscar_negocios', Object.assign({ por_pagina: 20 }, a));
        if (r.status !== 200) totalOk = false;
        tiempos.push(r.ms);
      }
      const med = pct(tiempos.slice(1), 50);
      red.push(med);
      ctx.info(nombre + ': por internet ' + med.toFixed(0) + ' ms (mediana)');
    }
    const ping = [];
    for (let i = 0; i < 5; i++) ping.push((await rpc('version_datos', {})).ms);
    const latencia = pct(ping.slice(1), 50);
    ctx.info('Latencia de red de este equipo al servidor (consulta mínima): ' + latencia.toFixed(0) + ' ms');
    ctx.ok('R9', 'Por internet: toda búsqueda responde < 300 ms (mediana)', totalOk && Math.max(...red) < 300, 'máx ' + Math.max(...red).toFixed(0) + ' ms');
    const busq = await rpc('buscar_negocios', { q: 'hotel cucuta' });
    ctx.ok('R9', 'Con 2.000 registros la búsqueda sin tildes sigue encontrando', busq.json.total > 50 && busq.json.items.length === 20, 'total ' + busq.json.total);
    const hs = busq.json.items.map((x) => x.destacado);
    ctx.ok('R8', 'Con 2.000 registros, los destacados vigentes siguen primero', hs.indexOf(false) < 0 || hs.slice(hs.indexOf(false)).every((x) => !x));
  } finally {
    const borrados = await limpiar();
    const quedan = (await db.query('select count(*)::int n from public.negocios where nombre like $1', [MARCA + '%'])).rows[0].n;
    ctx.ok('R9', 'Los datos sintéticos se borraron', quedan === 0, borrados + ' borrados');
    await db.query('analyze public.negocios');
    await db.end();
  }
};
