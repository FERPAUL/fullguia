-- FullGuia · 010 · Galería de videos de YouTube (fase 2).
-- El recuadro de video del inicio se vuelve una galería deslizable. El panel agrega enlaces sin límite.
--   tipo = 'video' → ref es el ID de 11 caracteres (videos, shorts, transmisiones /live/…, no listados)
--   tipo = 'lista' → ref es el ID de la lista de reproducción (?list=…)
--   tipo = 'canal' → ref es el ID del canal (UC…): muestra la transmisión en vivo actual del canal

create table if not exists public.videos (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null default 'video' check (tipo in ('video', 'lista', 'canal')),
  ref         text not null,
  titulo      text not null check (length(trim(titulo)) between 1 and 120),
  miniatura   text check (miniatura is null or (length(miniatura) <= 500 and
                miniatura ~ '^https://(i[0-9]?\.ytimg\.com|yt3\.ggpht\.com|yt3\.googleusercontent\.com)/[^\s"''<>\\]+$')),
  enlace      text check (enlace is null or (length(enlace) <= 500 and enlace ~ '^https://[^\s"''<>\\]+$')),
  orden       int not null default 100,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint videos_ref_chk check (
    (tipo = 'video' and ref ~ '^[A-Za-z0-9_-]{11}$') or
    (tipo = 'lista' and ref ~ '^[A-Za-z0-9_-]{10,64}$') or
    (tipo = 'canal' and ref ~ '^UC[A-Za-z0-9_-]{22}$')
  ),
  constraint videos_tipo_ref_uq unique (tipo, ref)
);
create index if not exists videos_orden_idx on public.videos (orden, created_at) where activo;

-- Triggers: updated_at y versión de datos (la caché del sitio se entera del cambio)
drop trigger if exists t_updated on public.videos;
create trigger t_updated before update on public.videos
  for each row execute function privado.tocar_updated_at();
drop trigger if exists t_version on public.videos;
create trigger t_version after insert or update or delete on public.videos
  for each statement execute function privado.subir_version();

-- Seguridad: el público lee solo los activos; escriben los usuarios del panel (admin y editor)
alter table public.videos enable row level security;
grant select on public.videos to anon, authenticated;
grant insert, update, delete on public.videos to authenticated;
revoke insert, update, delete, truncate on public.videos from anon;

drop policy if exists videos_leer on public.videos;
create policy videos_leer on public.videos for select to anon, authenticated
  using (activo or (select privado.es_admin()));
drop policy if exists videos_crear on public.videos;
create policy videos_crear on public.videos for insert to authenticated
  with check ((select privado.es_admin()));
drop policy if exists videos_editar on public.videos;
create policy videos_editar on public.videos for update to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));
drop policy if exists videos_borrar on public.videos;
create policy videos_borrar on public.videos for delete to authenticated
  using ((select privado.es_admin()));

-- Inicio: categorías, destacados, ofertas y ahora videos, en la misma única llamada.
create or replace function public.pagina_inicio()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'version', public.version_datos(),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'slug', c.slug,
                                          'icono', c.icono, 'color', c.color)
                       order by c.orden, c.nombre)
      from public.categorias c where c.activa), '[]'::jsonb),
    'destacados', coalesce((
      select jsonb_agg(x.j order by x.hasta desc, x.orden)
      from (
        select privado.negocio_json(n, c) as j, n.destacado_hasta as hasta, n.nombre_orden as orden
        from public.negocios n join public.categorias c on c.id = n.categoria_id
        where n.activo and c.activa and n.plan = 'destacado'
          and n.destacado_hasta >= privado.hoy()
        order by n.destacado_hasta desc, n.nombre_orden
        limit 12
      ) x), '[]'::jsonb),
    'ofertas', coalesce((
      select jsonb_agg(x.j order by x.orden)
      from (
        select jsonb_build_object('id', o.id, 'titulo', o.titulo, 'descuento', o.descuento,
                                  'imagen', o.imagen, 'imagen_mini', o.imagen_mini,
                                  'negocio', n.nombre, 'negocio_slug', n.slug) as j,
               o.orden
        from public.ofertas o join public.negocios n on n.id = o.negocio_id
        where o.activa and (o.vigente_hasta is null or o.vigente_hasta >= privado.hoy())
          and n.activo
        order by o.orden, o.created_at desc
        limit 8
      ) x), '[]'::jsonb),
    'videos', coalesce((
      select jsonb_agg(x.j order by x.orden, x.creado)
      from (
        select jsonb_build_object('id', v.id, 'tipo', v.tipo, 'ref', v.ref,
                                  'titulo', v.titulo, 'miniatura', v.miniatura) as j,
               v.orden, v.created_at as creado
        from public.videos v
        where v.activo
        order by v.orden, v.created_at
        limit 200
      ) x), '[]'::jsonb)
  )
$$;
grant execute on function public.pagina_inicio() to anon, authenticated;

-- Resumen del panel: se agrega el número de videos activos.
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
    'videos',         (select count(*) from public.videos where activo),
    'hoy',            privado.hoy(),
    'proximos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre,
                                     'destacado_hasta', destacado_hasta) order by destacado_hasta)
                   from public.negocios
                   where activo and plan = 'destacado'
                     and destacado_hasta between privado.hoy() and privado.hoy() + 7), '[]'::jsonb)
  ) end
$$;
revoke execute on function public.panel_resumen() from public, anon;
grant execute on function public.panel_resumen() to authenticated;

-- Seed: el video que ya tenía el inicio de la maqueta.
insert into public.videos (tipo, ref, titulo, miniatura, enlace, orden)
values ('video', '7vw3rFRuvJ0', 'Descubre lo mejor de nuestra región',
        'https://i.ytimg.com/vi/7vw3rFRuvJ0/hqdefault.jpg', 'https://www.youtube.com/watch?v=7vw3rFRuvJ0', 10)
on conflict (tipo, ref) do nothing;
