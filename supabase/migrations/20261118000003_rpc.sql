-- FullGuia · 003 · Funciones RPC: una sola llamada por página.
-- Todas son SECURITY INVOKER: respetan RLS (anon solo ve lo activo y vigente).

-- Versión de datos + fecha de hoy en Bogotá (si cambia el día, un destacado puede vencer).
create or replace function public.version_datos()
returns text
language sql
stable
set search_path = ''
as $$
  select m.version::text || '-' || to_char(privado.hoy(), 'YYYYMMDD')
  from public.meta m where m.id = 1
$$;

-- Fila de negocio tal como la pinta el sitio.
create or replace function privado.negocio_json(n public.negocios, c public.categorias)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', n.id, 'nombre', n.nombre, 'slug', n.slug,
    'categoria', c.nombre, 'categoria_slug', c.slug, 'categoria_icono', c.icono,
    'etiqueta', n.etiqueta, 'etiqueta_tono', n.etiqueta_tono,
    'ciudad', n.ciudad, 'direccion', n.direccion,
    'whatsapp', n.whatsapp, 'telefono', n.telefono,
    'precio_desde', n.precio_desde, 'precio_label', n.precio_label,
    'amenidades', to_jsonb(n.amenidades),
    'imagen', n.imagen, 'imagen_mini', n.imagen_mini, 'logo', n.logo,
    'rating', n.rating, 'num_opiniones', n.num_opiniones,
    'destacado', (n.plan = 'destacado' and n.destacado_hasta is not null
                  and n.destacado_hasta >= privado.hoy())
  )
$$;
grant execute on function privado.negocio_json(public.negocios, public.categorias) to anon, authenticated;

-- Inicio: categorías, destacados vigentes y ofertas vigentes.
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
      ) x), '[]'::jsonb)
  )
$$;

-- Búsqueda / listado por categoría: destacados vigentes primero, luego A-Z sin tildes. 20 por página.
create or replace function public.buscar_negocios(
  q          text default null,
  cat        text default null,
  ciudad     text default null,
  pagina     int  default 1,
  por_pagina int  default 20
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  tsq    tsquery := privado.consulta(q);
  ciu    text    := nullif(privado.normalizar(ciudad), '');
  pp     int     := least(greatest(coalesce(por_pagina, 20), 1), 50);
  pg     int     := greatest(coalesce(pagina, 1), 1);
  hoy    date    := privado.hoy();
  cat_j  jsonb;
  cat_id uuid;
  res    jsonb;
begin
  if nullif(trim(cat), '') is not null then
    select c.id, jsonb_build_object('id', c.id, 'nombre', c.nombre, 'slug', c.slug,
                                    'icono', c.icono, 'color', c.color)
      into cat_id, cat_j
    from public.categorias c where c.slug = trim(cat) and c.activa;
    if cat_id is null then
      return jsonb_build_object('total', 0, 'pagina', pg, 'por_pagina', pp,
                                'categoria', null, 'items', '[]'::jsonb,
                                'version', public.version_datos());
    end if;
  end if;

  with base as (
    select n, c,
           (n.plan = 'destacado' and n.destacado_hasta >= hoy) as dest
    from public.negocios n
    join public.categorias c on c.id = n.categoria_id
    where n.activo and c.activa
      and (cat_id is null or n.categoria_id = cat_id)
      and (tsq is null or n.busqueda @@ tsq)
      and (ciu is null or privado.normalizar(n.ciudad) like ciu || '%')
  ), pagina_ as (
    select b.*, count(*) over () as total
    from base b
    order by b.dest desc, (b.n).nombre_orden, (b.n).id
    limit pp offset (pg - 1) * pp
  )
  select jsonb_build_object(
           'total', coalesce(max(p.total), 0),
           'items', coalesce(jsonb_agg(privado.negocio_json(p.n, p.c)
                                       order by p.dest desc, (p.n).nombre_orden, (p.n).id), '[]'::jsonb))
    into res
  from pagina_ p;

  -- Si la página pedida está fuera de rango, el total igual debe venir.
  if (res->>'total')::bigint = 0 then
    select jsonb_set(res, '{total}', to_jsonb(count(*))) into res from (
      select 1 from public.negocios n join public.categorias c on c.id = n.categoria_id
      where n.activo and c.activa
        and (cat_id is null or n.categoria_id = cat_id)
        and (tsq is null or n.busqueda @@ tsq)
        and (ciu is null or privado.normalizar(n.ciudad) like ciu || '%')
    ) t;
  end if;

  return res || jsonb_build_object('pagina', pg, 'por_pagina', pp, 'categoria', cat_j,
                                   'version', public.version_datos());
end $$;

-- Detalle de un negocio.
create or replace function public.pagina_negocio(p_slug text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'version', public.version_datos(),
    'negocio', (
      select privado.negocio_json(n, c) || jsonb_build_object(
        'descripcion', n.descripcion,
        'categoria_color', c.color,
        'ofertas', coalesce((
          select jsonb_agg(jsonb_build_object('id', o.id, 'titulo', o.titulo, 'descuento', o.descuento,
                                              'imagen', o.imagen, 'imagen_mini', o.imagen_mini)
                           order by o.orden)
          from public.ofertas o
          where o.negocio_id = n.id and o.activa
            and (o.vigente_hasta is null or o.vigente_hasta >= privado.hoy())), '[]'::jsonb))
      from public.negocios n join public.categorias c on c.id = n.categoria_id
      where n.slug = p_slug and n.activo and c.activa
    )
  )
$$;

grant execute on function public.version_datos(), public.pagina_inicio(),
  public.buscar_negocios(text, text, text, int, int), public.pagina_negocio(text)
  to anon, authenticated;
