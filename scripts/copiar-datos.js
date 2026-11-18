// Copia categorías, negocios y ofertas de un proyecto Supabase a otro (plan B de la migración).
// Conserva ids, slugs, fechas y rutas de fotos; no copia usuarios (se crean de nuevo en el destino).
// Las conexiones se pasan SOLO por variables de entorno (cadena de conexión de Postgres, "Session pooler"):
//   FG_ORIGEN_DB  = postgresql://postgres.<ref>:<contraseña>@aws-…pooler.supabase.com:5432/postgres
//   FG_DESTINO_DB = postgresql://postgres.<ref-nuevo>:<contraseña>@aws-…pooler.supabase.com:5432/postgres
// Uso: node scripts/copiar-datos.js            (el destino ya debe tener las migraciones aplicadas;
//                                               su contenido de categorías/negocios/ofertas se REEMPLAZA)
//      node scripts/copiar-datos.js --sin-demo (no copia los negocios marcados como demo)
const { Client } = require('pg');

const TABLAS = [
  ['categorias', ['id', 'nombre', 'slug', 'icono', 'color', 'orden', 'activa', 'created_at', 'updated_at']],
  ['negocios', ['id', 'nombre', 'slug', 'categoria_id', 'etiqueta', 'etiqueta_tono', 'ciudad', 'direccion', 'whatsapp', 'telefono', 'precio_desde',
    'precio_label', 'amenidades', 'imagen', 'imagen_mini', 'logo', 'descripcion', 'rating', 'num_opiniones', 'plan', 'destacado_hasta', 'activo', 'demo',
    'created_at', 'updated_at']],
  ['ofertas', ['id', 'negocio_id', 'titulo', 'descuento', 'imagen', 'imagen_mini', 'vigente_hasta', 'activa', 'orden', 'demo', 'created_at', 'updated_at']],
];

async function main() {
  if (!process.env.FG_ORIGEN_DB || !process.env.FG_DESTINO_DB) throw new Error('Faltan FG_ORIGEN_DB y FG_DESTINO_DB (variables de entorno).');
  const sinDemo = process.argv.includes('--sin-demo');
  const o = new Client({ connectionString: process.env.FG_ORIGEN_DB, ssl: { rejectUnauthorized: false } });
  const d = new Client({ connectionString: process.env.FG_DESTINO_DB, ssl: { rejectUnauthorized: false } });
  await o.connect(); await d.connect();
  try {
    await d.query('begin');
    // El destino recién creado trae los datos iniciales de las migraciones: se reemplazan por los del origen.
    const previos = (await d.query('select (select count(*) from public.negocios)::int n')).rows[0].n;
    await d.query('delete from public.ofertas; delete from public.negocios; delete from public.categorias;');
    console.log('Destino vaciado (' + previos + ' negocios previos)');
    const copiados = new Set();
    for (const [tabla, cols] of TABLAS) {
      let filas = (await o.query('select ' + cols.join(', ') + ' from public.' + tabla)).rows;
      if (sinDemo && tabla === 'negocios') filas = filas.filter((f) => !f.demo);
      // Ofertas: solo las de negocios que sí se copiaron (si no, fallaría la llave foránea)
      if (tabla === 'ofertas') filas = filas.filter((f) => copiados.has(f.negocio_id) && !(sinDemo && f.demo));
      if (tabla === 'negocios') filas.forEach((f) => copiados.add(f.id));
      for (const f of filas) {
        const vals = cols.map((c) => f[c]);
        const marcas = cols.map((_, i) => '$' + (i + 1)).join(', ');
        const upd = cols.filter((c) => c !== 'id').map((c) => c + ' = excluded.' + c).join(', ');
        await d.query('insert into public.' + tabla + ' (' + cols.join(', ') + ') values (' + marcas + ') on conflict (id) do update set ' + upd, vals);
      }
      console.log(tabla + ': ' + filas.length + ' filas');
    }
    await d.query('commit');
    console.log('Datos copiados. Ahora copia las fotos con scripts/subir-fotos.js copiar');
  } catch (e) {
    await d.query('rollback');
    throw e;
  } finally {
    await o.end(); await d.end();
  }
}
main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
