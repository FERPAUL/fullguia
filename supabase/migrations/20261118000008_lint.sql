-- FullGuia · 008 · Corrección señalada por supabase db lint:
-- en cargar_demo la variable del FOR (i) se declaraba dos veces. Mismo comportamiento.

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

revoke execute on function public.cargar_demo() from public, anon;
grant execute on function public.cargar_demo() to authenticated;
