-- FullGuia · 007 · Endurecimiento señalado por los advisors de Supabase.
-- Algunos proyectos traen public.rls_auto_enable() (activa RLS automáticamente en tablas nuevas).
-- Es SECURITY DEFINER y quedaba ejecutable por la API (anon/authenticated). Se le quita ese permiso:
-- el disparador de eventos que la usa sigue funcionando igual.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
