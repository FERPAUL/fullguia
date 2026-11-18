// R1: las migraciones recrean la base de datos desde cero.
// Dentro de UNA transacción que al final se revierte (ROLLBACK): se borran todos los objetos de FullGuia,
// se ejecutan las migraciones en orden y se comprueba el resultado. Nada queda cambiado.
// Además: la base real no tiene objetos que no estén en las migraciones (sin "deriva").
const fs = require('fs');
const path = require('path');
const { conectar } = require('../lib/db');

module.exports = async function (ctx) {
  const dir = path.join(ctx.RAIZ, 'supabase', 'migrations');
  const migs = fs.readdirSync(dir).filter((f) => /\.sql$/.test(f)).sort();
  const sqlTodo = migs.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const c = await conectar();
  try {
    // --- Deriva: todo lo que existe en la base está declarado en las migraciones ---
    const objs = await c.query(`
      select 'tabla' t, tablename n from pg_tables where schemaname = 'public'
      union all select 'funcion', p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname in ('public','privado') and p.proname <> 'rls_auto_enable'
      union all select 'politica', policyname from pg_policies where schemaname = 'public'
        or (schemaname = 'storage' and policyname like 'negocios_%')
      union all select 'trigger', tgname from pg_trigger g join pg_class k on k.oid = g.tgrelid
        join pg_namespace s on s.oid = k.relnamespace where s.nspname = 'public' and not g.tgisinternal`);
    const sinDeclarar = objs.rows.filter((o) => sqlTodo.indexOf(o.n) < 0).map((o) => o.t + ' ' + o.n);
    ctx.ok('R1', 'Todo objeto de la base (tablas, funciones, políticas, triggers) está en supabase/migrations', !sinDeclarar.length,
      sinDeclarar.length ? sinDeclarar.join(', ') : objs.rowCount + ' objetos');
    const hist = await c.query('select version from supabase_migrations.schema_migrations order by 1');
    const aplicadas = hist.rows.map((r) => r.version);
    const locales = migs.map((f) => f.split('_')[0]);
    ctx.ok('R1', 'Todas las migraciones locales están aplicadas en el proyecto', locales.every((v) => aplicadas.indexOf(v) >= 0),
      locales.filter((v) => aplicadas.indexOf(v) < 0).join(', '));

    // --- Reconstrucción desde cero (se revierte) ---
    const politicasReales = (await c.query("select count(*)::int n from pg_policies where schemaname='public'")).rows[0].n;
    await c.query('begin');
    await c.query(`
      drop table if exists public.ofertas, public.negocios, public.categorias, public.admins, public.meta cascade;
      drop function if exists public.version_datos(), public.pagina_inicio(), public.buscar_negocios(text,text,text,int,int),
        public.pagina_negocio(text), public.cargar_demo(), public.borrar_demo(), public.panel_resumen() cascade;
      drop schema if exists privado cascade;`);
    const vacia = await c.query("select count(*)::int n from pg_tables where schemaname='public' and tablename in ('negocios','categorias','ofertas','admins','meta')");
    ctx.ok('R1', 'Base vaciada dentro de la transacción de prueba', vacia.rows[0].n === 0);
    let error = '';
    for (const f of migs) {
      try { await c.query(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { error = f + ': ' + e.message; break; }
    }
    ctx.ok('R1', 'Las ' + migs.length + ' migraciones se aplican en orden sobre una base vacía', !error, error);
    if (!error) {
      const q1 = async (sql) => (await c.query(sql)).rows[0];
      const t = await q1("select count(*)::int n, bool_and(rowsecurity) rls from pg_tables where schemaname='public' and tablename in ('negocios','categorias','ofertas','admins','meta')");
      ctx.ok('R1', 'Se crean las 5 tablas con RLS activado', t.n === 5 && t.rls, JSON.stringify(t));
      const s = await q1("select (select count(*) from public.categorias)::int cats, (select count(*) from public.negocios where demo)::int demo, (select count(*) from public.ofertas)::int ofertas");
      ctx.ok('R1', 'El seed carga 7 categorías, 7 negocios demo y 4 ofertas', s.cats === 7 && s.demo === 7 && s.ofertas === 4, JSON.stringify(s));
      const p = await q1("select count(*)::int n from pg_policies where schemaname='public'");
      const sp = await q1("select count(*)::int n from pg_policies where schemaname='storage' and policyname like 'negocios_%'");
      ctx.ok('R1', 'Se crean las mismas políticas RLS que tiene la base real (tablas y Storage)', p.n === politicasReales && p.n >= 14 && sp.n === 4,
        p.n + ' de tablas (real ' + politicasReales + '), ' + sp.n + ' de Storage');
      const b = await q1("select count(*)::int n from storage.buckets where id='negocios' and public");
      ctx.ok('R1', 'Existe el bucket público "negocios"', b.n === 1);
      await c.query('set local role anon');
      const r = await q1("select public.buscar_negocios('hotel cucuta') j");
      await c.query('reset role');
      ctx.ok('R1', 'Tras recrear, la búsqueda funciona como visitante (anon)', r.j && r.j.total >= 1, 'total ' + (r.j && r.j.total));
      const ix = await q1("select count(*)::int n from pg_indexes where schemaname='public' and indexname='negocios_busqueda_gin'");
      ctx.ok('R1', 'Se crea el índice de búsqueda (GIN)', ix.n === 1);
    }
    await c.query('rollback');
    const sigue = await c.query("select count(*)::int n from public.categorias");
    ctx.ok('R1', 'La transacción de prueba se revirtió: la base real sigue intacta', sigue.rows[0].n >= 7, sigue.rows[0].n + ' categorías');
  } catch (e) {
    try { await c.query('rollback'); } catch (x) { /* nada */ }
    throw e;
  } finally {
    await c.end();
  }
};
