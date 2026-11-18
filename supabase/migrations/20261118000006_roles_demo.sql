-- FullGuia · 006 · Roles del panel (admin / editor) y datos demo que se pueden borrar.
--   admin  : todo (categorías, usuarios, datos demo, negocios, ofertas, fotos).
--   editor : negocios, ofertas, fotos e importación CSV.

alter table public.admins add column if not exists rol text not null default 'admin';
alter table public.admins drop constraint if exists admins_rol_chk;
alter table public.admins add constraint admins_rol_chk check (rol in ('admin', 'editor'));
alter table public.admins add column if not exists email  text;
alter table public.admins add column if not exists nombre text;

alter table public.negocios add column if not exists demo boolean not null default false;
alter table public.ofertas  add column if not exists demo boolean not null default false;
create index if not exists negocios_demo_idx on public.negocios (demo) where demo;

-- Todo lo cargado por la migración 005 es contenido de la maqueta (demo).
update public.negocios set demo = true
 where slug in ('hostal-colonial-los-patios','hotel-boutique-san-diego','hotel-plaza-suite-executiva',
                'resort-campestre-el-manantial','la-parrilla-real','power-gym','tech-solutions');
update public.ofertas o set demo = true from public.negocios n where n.id = o.negocio_id and n.demo;

-- ¿Es administrador (rol admin)?
create or replace function privado.es_jefe()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()) and a.rol = 'admin')
$$;
revoke all on function privado.es_jefe() from public;
grant execute on function privado.es_jefe() to anon, authenticated;

-- Categorías: solo rol admin escribe.
drop policy if exists categorias_crear on public.categorias;
create policy categorias_crear on public.categorias for insert to authenticated
  with check ((select privado.es_jefe()));
drop policy if exists categorias_editar on public.categorias;
create policy categorias_editar on public.categorias for update to authenticated
  using ((select privado.es_jefe())) with check ((select privado.es_jefe()));
drop policy if exists categorias_borrar on public.categorias;
create policy categorias_borrar on public.categorias for delete to authenticated
  using ((select privado.es_jefe()));

-- Usuarios del panel: cada uno ve su fila; el rol admin ve todas (pantalla Usuarios).
-- Las altas, cambios de rol y bajas pasan por la Edge Function "usuarios" (service role).
drop policy if exists admins_leer_propio on public.admins;
create policy admins_leer on public.admins for select to authenticated
  using (user_id = (select auth.uid()) or (select privado.es_jefe()));

-- ---------------------------------------------------------------------------
-- Datos demo
-- ---------------------------------------------------------------------------

-- Carga negocios demo: los de la maqueta (si faltan) + 3 por cada categoría activa.
create or replace function public.cargar_demo()
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  c record;
  i int;
  antes bigint;
  despues bigint;
  fotos text[] := array[
    'photo-1555396273-367ea4eb4db5','photo-1566073771259-6a8506099945','photo-1534438327276-14e5300c3a48',
    'photo-1531297484001-80022131f5a1','photo-1590490360182-c33d57733427','photo-1571896349842-33c89424de2d',
    'photo-1542314831-068cd1dbfeeb','photo-1517248135467-4c7edcad34c4'];
  ciudades text[] := array['Cúcuta','Los Patios','Villa del Rosario','Pamplona','Chinácota','Ocaña'];
  prefijos text[] := array['Central','Express','Premium'];
  f text;
begin
  if not privado.es_jefe() then
    raise exception 'Solo un administrador puede cargar datos demo' using errcode = '42501';
  end if;
  select count(*) into antes from public.negocios where demo;

  for c in select id, nombre, slug from public.categorias where activa order by orden loop
    for i in 1..3 loop
      f := fotos[1 + ((abs(hashtext(c.slug)) + i) % array_length(fotos, 1))];
      insert into public.negocios
        (nombre, slug, categoria_id, etiqueta, ciudad, direccion, precio_label, amenidades,
         imagen, imagen_mini, descripcion, rating, num_opiniones, plan, destacado_hasta, demo)
      values
        (c.nombre || ' ' || prefijos[i] || ' (demo)', 'demo-' || c.slug || '-' || i, c.id,
         c.nombre, ciudades[1 + ((abs(hashtext(c.slug)) + i) % 6)],
         'Dirección de ejemplo ' || i || ', Norte de Santander', 'Desde',
         array['📶 WiFi', '🚗 Parqueadero'],
         'https://images.unsplash.com/' || f || '?auto=format&fit=crop&w=1200&q=70',
         'https://images.unsplash.com/' || f || '?auto=format&fit=crop&w=400&q=70',
         'Negocio de demostración. Se borra con "Borrar datos demo".',
         round((3.8 + (i * 0.3))::numeric, 1), 10 * i,
         case when i = 1 then 'destacado' else 'gratis' end,
         case when i = 1 then privado.hoy() + 30 else null end,
         true)
      on conflict (slug) do nothing;
    end loop;
  end loop;

  select count(*) into despues from public.negocios where demo;
  return jsonb_build_object('agregados', despues - antes, 'demo_total', despues);
end $$;

-- Borra todos los negocios y ofertas demo. Devuelve las rutas de Storage que el panel debe eliminar.
create or replace function public.borrar_demo()
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  rutas text[];
  n_neg bigint;
  n_ofe bigint;
begin
  if not privado.es_jefe() then
    raise exception 'Solo un administrador puede borrar datos demo' using errcode = '42501';
  end if;

  select coalesce(array_agg(r), '{}') into rutas from (
    select unnest(array[n.imagen, n.imagen_mini, n.logo]) r from public.negocios n where n.demo
    union
    select unnest(array[o.imagen, o.imagen_mini]) from public.ofertas o
      where o.demo or o.negocio_id in (select id from public.negocios where demo)
  ) t where r is not null and r !~ '^https?://';

  with d as (delete from public.ofertas o
             where o.demo or o.negocio_id in (select id from public.negocios where demo) returning 1)
  select count(*) into n_ofe from d;
  with d as (delete from public.negocios where demo returning 1)
  select count(*) into n_neg from d;

  return jsonb_build_object('negocios', n_neg, 'ofertas', n_ofe, 'rutas', to_jsonb(rutas));
end $$;

-- Resumen para el panel (Inicio): KPIs en una sola llamada.
create or replace function public.panel_resumen()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when not privado.es_admin() then null else jsonb_build_object(
    'activos',        (select count(*) from public.negocios where activo),
    'inactivos',      (select count(*) from public.negocios where not activo),
    'destacados',     (select count(*) from public.negocios
                        where activo and plan = 'destacado' and destacado_hasta >= privado.hoy()),
    'por_vencer',     (select count(*) from public.negocios
                        where activo and plan = 'destacado'
                          and destacado_hasta between privado.hoy() and privado.hoy() + 7),
    'vencidos',       (select count(*) from public.negocios
                        where plan = 'destacado' and destacado_hasta < privado.hoy()),
    'demo',           (select count(*) from public.negocios where demo),
    'ofertas',        (select count(*) from public.ofertas
                        where activa and (vigente_hasta is null or vigente_hasta >= privado.hoy())),
    'categorias',     (select count(*) from public.categorias where activa),
    'hoy',            privado.hoy(),
    'proximos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre,
                                     'destacado_hasta', destacado_hasta) order by destacado_hasta)
                   from public.negocios
                   where activo and plan = 'destacado'
                     and destacado_hasta between privado.hoy() and privado.hoy() + 7), '[]'::jsonb)
  ) end
$$;

revoke execute on function public.cargar_demo(), public.borrar_demo(), public.panel_resumen() from public, anon;
grant execute on function public.cargar_demo(), public.borrar_demo(), public.panel_resumen() to authenticated;

-- WhatsApp solo Colombia: 57 + 10 dígitos de celular (empieza por 3).
alter table public.negocios drop constraint if exists negocios_whatsapp_check;
alter table public.negocios drop constraint if exists negocios_whatsapp_co_chk;
alter table public.negocios add constraint negocios_whatsapp_co_chk
  check (whatsapp is null or whatsapp ~ '^573[0-9]{9}$');
