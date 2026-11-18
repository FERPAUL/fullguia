-- FullGuia · 005 · Datos iniciales: categorías del index y negocios de las maquetas.
-- Idempotente: si ya existen (por slug) no se duplican ni se pisan.

insert into public.categorias (nombre, slug, icono, color, orden) values
  ('Comidas',    'comidas',    'comidas',    'orange', 10),
  ('Hoteles',    'hoteles',    'hoteles',    'blue',   20),
  ('Salud',      'salud',      'salud',      'green',  30),
  ('Vehículos',  'vehiculos',  'vehiculos',  'purple', 40),
  ('Hogar',      'hogar',      'hogar',      'yellow', 50),
  ('Tecnología', 'tecnologia', 'tecnologia', 'cyan',   60),
  ('Educación',  'educacion',  'educacion',  'red',    70)
on conflict (slug) do nothing;

with c as (select id, slug from public.categorias)
insert into public.negocios
  (nombre, slug, categoria_id, etiqueta, etiqueta_tono, ciudad, direccion, whatsapp,
   precio_desde, precio_label, amenidades, imagen, imagen_mini, logo, descripcion,
   rating, num_opiniones, plan, destacado_hasta)
values
  ('Hostal Colonial Los Patios', 'hostal-colonial-los-patios', (select id from c where slug='hoteles'),
   'Hostal Económico', 'amarillo', 'Los Patios', 'Los Patios, Norte de Santander', '573000000000',
   90000, 'Desde por noche', array['☕ Desayuno Casero','📶 WiFi','📺 TV Cable'],
   'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=70',
   'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=400&q=70',
   null, 'Hostal familiar de estilo colonial con desayuno casero incluido.',
   4.5, 41, 'gratis', null),
  ('Hotel Boutique San Diego', 'hotel-boutique-san-diego', (select id from c where slug='hoteles'),
   'Hotel Boutique', 'morado', 'Cúcuta', 'Barrio Caobos, Cúcuta', '573000000000',
   150000, 'Desde por noche', array['🍸 Bar / Rooftop','📶 WiFi Fibra Óptica','❄️ Aire Acondicionado'],
   'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=70',
   'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=400&q=70',
   null, 'Hotel boutique con bar en la terraza en el barrio Caobos.',
   4.6, 64, 'gratis', null),
  ('Hotel Plaza Suite Executiva', 'hotel-plaza-suite-executiva', (select id from c where slug='hoteles'),
   'Hotel 4 Estrellas', 'azul', 'Cúcuta', 'Zona Centro, Cúcuta (A 5 min del Parque Santander)', '573000000000',
   180000, 'Desde por noche',
   array['📶 WiFi de Alta Velocidad','🏊 Piscina Templada','🍳 Desayuno Buffet','🚗 Parqueadero Cubierto'],
   'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=70',
   'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=400&q=70',
   'https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=200&q=70',
   'Hotel ejecutivo en pleno centro de Cúcuta, a 5 minutos del Parque Santander.',
   4.8, 98, 'destacado', current_date + 365),
  ('Resort Campestre El Manantial', 'resort-campestre-el-manantial', (select id from c where slug='hoteles'),
   'Hotel Campestre', 'verde', 'Chinácota', 'Chinácota, Norte de Santander', '573000000000',
   240000, 'Desde por noche',
   array['🌲 Zonas Verdes','🏊 Piscina al Aire Libre','🔥 Zona de Fogatas','🐶 Pet Friendly'],
   'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1200&q=70',
   'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=400&q=70',
   null, 'Resort campestre rodeado de naturaleza, ideal para descansar en familia.',
   4.9, 142, 'destacado', current_date + 365),
  ('La Parrilla Real', 'la-parrilla-real', (select id from c where slug='comidas'),
   'Restaurante', 'amarillo', 'Cúcuta', 'Cúcuta, Norte de Santander', '573000000000',
   null, 'Desde', array['🥩 Carnes a la parrilla','🚗 Parqueadero'],
   'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=70',
   'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=400&q=70',
   'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=200&q=70',
   'Restaurante de carnes a la parrilla.', 4.8, 124, 'destacado', current_date + 365),
  ('Power Gym', 'power-gym', (select id from c where slug='salud'),
   'Gimnasio', 'verde', 'Los Patios', 'Los Patios, Norte de Santander', '573000000000',
   null, 'Desde', array['🏋️ Pesas','🧘 Clases grupales'],
   'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1200&q=70',
   'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=400&q=70',
   'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?auto=format&fit=crop&w=200&q=70',
   'Gimnasio con zona de pesas y clases grupales.', 4.9, 76, 'destacado', current_date + 365),
  ('Tech Solutions', 'tech-solutions', (select id from c where slug='tecnologia'),
   'Tecnología', 'azul', 'Cúcuta', 'Cúcuta, Norte de Santander', '573000000000',
   null, 'Desde', array['💻 Soporte técnico','🛠️ Reparación'],
   'https://images.unsplash.com/photo-1531297484001-80022131f5a1?auto=format&fit=crop&w=1200&q=70',
   'https://images.unsplash.com/photo-1531297484001-80022131f5a1?auto=format&fit=crop&w=400&q=70',
   'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=200&q=70',
   'Soporte y soluciones tecnológicas para empresas y hogares.', 4.7, 53, 'destacado', current_date + 365)
on conflict (slug) do nothing;

with n as (select id, slug from public.negocios)
insert into public.ofertas (negocio_id, titulo, descuento, imagen, imagen_mini, vigente_hasta, orden)
select v.neg, v.titulo, v.descuento, v.img, v.mini, current_date + 365, v.orden
from (values
  ((select id from n where slug='la-parrilla-real'), 'Oferta Pizza', '-20%',
   'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1200&q=70',
   'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=400&q=70', 10),
  ((select id from n where slug='hotel-boutique-san-diego'), 'Oferta Café', '-15%',
   'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=1200&q=70',
   'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=400&q=70', 20),
  ((select id from n where slug='hotel-boutique-san-diego'), 'Oferta Bebidas', '2x1',
   'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=1200&q=70',
   'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=400&q=70', 30),
  ((select id from n where slug='la-parrilla-real'), 'Oferta Comida', '-30%',
   'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=1200&q=70',
   'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=400&q=70', 40)
) as v(neg, titulo, descuento, img, mini, orden)
where not exists (select 1 from public.ofertas o where o.titulo = v.titulo and o.negocio_id = v.neg);
