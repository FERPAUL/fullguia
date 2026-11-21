-- FullGuia · 011 · Videos de ejemplo (demo) para la galería, que se borran con "Borrar datos demo".
-- El video original de la maqueta (migración 010) NO es demo: es contenido del cliente.

alter table public.videos add column if not exists demo boolean not null default false;

-- Videos públicos de ejemplo (turismo de Norte de Santander + una cámara en vivo 24 h).
create or replace function privado.insertar_videos_demo()
returns bigint
language sql
volatile
set search_path = ''
as $$
  with n as (
    insert into public.videos (tipo, ref, titulo, miniatura, enlace, orden, demo)
    select 'video', x.ref, x.titulo, 'https://i.ytimg.com/vi/' || x.ref || '/hqdefault.jpg',
           'https://www.youtube.com/watch?v=' || x.ref,
           coalesce((select max(v.orden) from public.videos v), 0) + x.k * 10, true
    from (values
      (1, '7XQmW6sYCXo', '7 pueblos bonitos de Norte de Santander (demo)'),
      (2, 'HfgIFGbdGJ0', 'Cámara en vivo · The World Live (demo)'),
      (3, 'Jav7UkPwfzA', 'Cácota, Norte de Santander (demo)'),
      (4, 'hZAoqIyS2Ws', 'Centro de Cúcuta (demo)')
    ) as x(k, ref, titulo)
    on conflict (tipo, ref) do nothing
    returning 1
  )
  select count(*) from n
$$;
revoke all on function privado.insertar_videos_demo() from public, anon;
grant execute on function privado.insertar_videos_demo() to authenticated;

select privado.insertar_videos_demo();

-- Cargar demo: lo mismo que antes (009) + los videos de ejemplo.
create or replace function public.cargar_demo()
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  c record;
  antes bigint;
  despues bigint;
  n_vid bigint;
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
         'https://images.unsplash.com/' || f || '?fit=crop&w=1000&h=667&q=40&fm=webp',
         'https://images.unsplash.com/' || f || '?fit=crop&w=400&h=267&q=35&fm=webp',
         'Negocio de demostración. Se borra con "Borrar datos demo".',
         round((3.8 + (i * 0.3))::numeric, 1), 10 * i,
         case when i = 1 then 'destacado' else 'gratis' end,
         case when i = 1 then privado.hoy() + 30 else null end,
         true)
      on conflict (slug) do nothing;
    end loop;
  end loop;
  n_vid := privado.insertar_videos_demo();

  select count(*) into despues from public.negocios where demo;
  return jsonb_build_object('agregados', despues - antes, 'demo_total', despues, 'videos', n_vid);
end $$;
revoke execute on function public.cargar_demo() from public, anon;
grant execute on function public.cargar_demo() to authenticated;

-- Borrar demo: lo mismo que antes (006) + los videos de ejemplo (los videos reales no se tocan).
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
  n_vid bigint;
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
  with d as (delete from public.videos where demo returning 1)
  select count(*) into n_vid from d;

  return jsonb_build_object('negocios', n_neg, 'ofertas', n_ofe, 'videos', n_vid, 'rutas', to_jsonb(rutas));
end $$;
revoke execute on function public.borrar_demo() from public, anon;
grant execute on function public.borrar_demo() to authenticated;
