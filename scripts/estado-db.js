// Muestra el estado real de la base de datos: tablas, extensiones, buckets, políticas y migraciones.
// Uso: node scripts/estado-db.js
const { conectar } = require('../qa/lib/db');

(async () => {
  const c = await conectar();
  const q = async (titulo, sql) => {
    const r = await c.query(sql);
    console.log('\n## ' + titulo + ' (' + r.rowCount + ')');
    for (const f of r.rows) console.log('  ' + Object.values(f).join(' | '));
  };
  try {
    await q('Versión', 'select version()');
    await q('Tablas public', "select tablename, rowsecurity from pg_tables where schemaname='public' order by 1");
    await q('Funciones public', "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1");
    await q('Extensiones', 'select extname, extversion, extnamespace::regnamespace from pg_extension order by 1');
    await q('Disponibles (unaccent/pg_trgm)', "select name, installed_version from pg_available_extensions where name in ('unaccent','pg_trgm')");
    await q('Buckets', 'select id, public, file_size_limit from storage.buckets');
    await q('Políticas public+storage', "select schemaname, tablename, policyname, cmd from pg_policies where schemaname in ('public','storage') order by 1,2");
    await q('Migraciones', "select version, name from supabase_migrations.schema_migrations order by 1").catch(e => console.log('  sin historial: ' + e.message));
    await q('Usuarios auth', 'select count(*) from auth.users');
    await q('Config auth (confirmación email)', "select 'ver dashboard'");
  } finally {
    await c.end();
  }
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
