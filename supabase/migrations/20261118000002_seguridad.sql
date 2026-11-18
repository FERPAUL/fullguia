-- FullGuia · 002 · Seguridad: RLS y permisos.
-- Público (anon): solo lee lo activo y vigente. Escriben solo los usuarios de public.admins.

-- ¿El usuario actual es administrador? (security definer: lee admins sin depender de su RLS)
create or replace function privado.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()))
$$;

revoke all on function privado.es_admin() from public;
grant execute on function privado.es_admin() to anon, authenticated;
grant execute on function privado.hoy(), privado.normalizar(text), privado.consulta(text),
                          privado.slugify(text)
  to anon, authenticated;

alter table public.categorias enable row level security;
alter table public.negocios   enable row level security;
alter table public.ofertas    enable row level security;
alter table public.admins     enable row level security;
alter table public.meta       enable row level security;

-- Defensa en profundidad: anon nunca escribe, aunque falle una política.
revoke insert, update, delete, truncate on public.categorias, public.negocios, public.ofertas,
  public.admins, public.meta from anon;
-- admins y meta no se escriben desde la API.
revoke insert, update, delete, truncate on public.admins, public.meta from authenticated;

-- ---------------- categorias ----------------
drop policy if exists categorias_leer on public.categorias;
create policy categorias_leer on public.categorias for select to anon, authenticated
  using (activa or (select privado.es_admin()));
drop policy if exists categorias_crear on public.categorias;
create policy categorias_crear on public.categorias for insert to authenticated
  with check ((select privado.es_admin()));
drop policy if exists categorias_editar on public.categorias;
create policy categorias_editar on public.categorias for update to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));
drop policy if exists categorias_borrar on public.categorias;
create policy categorias_borrar on public.categorias for delete to authenticated
  using ((select privado.es_admin()));

-- ---------------- negocios ----------------
drop policy if exists negocios_leer on public.negocios;
create policy negocios_leer on public.negocios for select to anon, authenticated
  using (activo or (select privado.es_admin()));
drop policy if exists negocios_crear on public.negocios;
create policy negocios_crear on public.negocios for insert to authenticated
  with check ((select privado.es_admin()));
drop policy if exists negocios_editar on public.negocios;
create policy negocios_editar on public.negocios for update to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));
drop policy if exists negocios_borrar on public.negocios;
create policy negocios_borrar on public.negocios for delete to authenticated
  using ((select privado.es_admin()));

-- ---------------- ofertas ----------------
drop policy if exists ofertas_leer on public.ofertas;
create policy ofertas_leer on public.ofertas for select to anon, authenticated
  using (
    (activa and (vigente_hasta is null or vigente_hasta >= (select privado.hoy())))
    or (select privado.es_admin())
  );
drop policy if exists ofertas_crear on public.ofertas;
create policy ofertas_crear on public.ofertas for insert to authenticated
  with check ((select privado.es_admin()));
drop policy if exists ofertas_editar on public.ofertas;
create policy ofertas_editar on public.ofertas for update to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));
drop policy if exists ofertas_borrar on public.ofertas;
create policy ofertas_borrar on public.ofertas for delete to authenticated
  using ((select privado.es_admin()));

-- ---------------- admins ----------------
-- Cada usuario solo puede ver si él mismo es admin (lo usa el login del panel).
drop policy if exists admins_leer_propio on public.admins;
create policy admins_leer_propio on public.admins for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------- meta ----------------
drop policy if exists meta_leer on public.meta;
create policy meta_leer on public.meta for select to anon, authenticated using (true);
