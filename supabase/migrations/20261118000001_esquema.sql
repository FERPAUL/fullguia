-- FullGuia · 001 · Esquema: extensiones, utilidades, tablas, índices y triggers.
-- Idempotente en lo posible para poder recrear el proyecto desde cero.

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Esquema privado: funciones internas que NO se exponen por la API REST.
create schema if not exists privado;
revoke all on schema privado from public;
grant usage on schema privado to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

-- Quita tildes y pasa a minúsculas (inmutable para poder indexar).
create or replace function privado.normalizar(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')))
$$;

-- "Hoy" en Colombia: los destacados vencen a medianoche de Bogotá.
create or replace function privado.hoy()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Bogota')::date
$$;

-- Convierte un texto en slug: "Hotel Plaza Suite Cúcuta" -> "hotel-plaza-suite-cucuta".
create or replace function privado.slugify(t text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(privado.normalizar(t), '[^a-z0-9]+', '-', 'g'))
$$;

-- Configuración de búsqueda en español sin tildes.
do $$
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'es_sin_tildes'
                 and cfgnamespace = 'privado'::regnamespace) then
    create text search configuration privado.es_sin_tildes (copy = pg_catalog.spanish);
    alter text search configuration privado.es_sin_tildes
      alter mapping for hword, hword_part, word with extensions.unaccent, spanish_stem;
  end if;
end $$;

-- Convierte lo que escribe la persona en una consulta de prefijos: "hotel cucu" -> 'hotel':* & 'cucu':*
create or replace function privado.consulta(q text)
returns tsquery
language sql
stable
set search_path = ''
as $$
  select case when count(*) = 0 then null
              else to_tsquery('privado.es_sin_tildes',
                     string_agg(quote_literal(w) || ':*', ' & '))
         end
  from regexp_split_to_table(privado.normalizar(q), '[^a-z0-9]+') as w
  where length(w) > 0
$$;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table if not exists public.categorias (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (length(trim(nombre)) between 2 and 60),
  slug        text not null unique,
  icono       text not null default 'mas',
  color       text not null default 'gray'
              check (color in ('orange','blue','green','purple','yellow','cyan','red','gray')),
  orden       int  not null default 100,
  activa      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.negocios (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null check (length(trim(nombre)) between 2 and 120),
  slug            text not null unique,
  categoria_id    uuid not null references public.categorias(id) on delete restrict,
  etiqueta        text check (etiqueta is null or length(etiqueta) <= 60),
  etiqueta_tono   text not null default 'azul'
                  check (etiqueta_tono in ('azul','amarillo','morado','verde')),
  ciudad          text check (ciudad is null or length(ciudad) <= 80),
  direccion       text check (direccion is null or length(direccion) <= 200),
  whatsapp        text check (whatsapp is null or whatsapp ~ '^[0-9]{8,15}$'),
  telefono        text check (telefono is null or length(telefono) <= 30),
  precio_desde    integer check (precio_desde is null or precio_desde >= 0),
  precio_label    text not null default 'Desde',
  amenidades      text[] not null default '{}',
  imagen          text,          -- ruta en Storage o URL completa (grande, 1200 px)
  imagen_mini     text,          -- ruta en Storage o URL completa (mini, 400 px)
  logo            text,          -- ruta en Storage o URL completa (200 px)
  descripcion     text check (descripcion is null or length(descripcion) <= 4000),
  rating          numeric(2,1) not null default 0 check (rating between 0 and 5),
  num_opiniones   integer not null default 0 check (num_opiniones >= 0),
  plan            text not null default 'gratis' check (plan in ('gratis','destacado')),
  destacado_hasta date,
  activo          boolean not null default true,
  nombre_orden    text not null default '',
  busqueda        tsvector,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.ofertas (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references public.negocios(id) on delete cascade,
  titulo         text not null check (length(trim(titulo)) between 2 and 120),
  descuento      text not null check (length(trim(descuento)) between 1 and 12),
  imagen         text,
  imagen_mini    text,
  vigente_hasta  date,
  activa         boolean not null default true,
  orden          int not null default 100,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Versión de los datos: la usa la caché del sitio para saber si debe refrescar.
create table if not exists public.meta (
  id          int primary key default 1 check (id = 1),
  version     bigint not null default 1,
  updated_at  timestamptz not null default now()
);
insert into public.meta (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------
create index if not exists negocios_busqueda_gin   on public.negocios using gin (busqueda);
create index if not exists negocios_cat_orden_idx  on public.negocios (categoria_id, nombre_orden) where activo;
create index if not exists negocios_orden_idx      on public.negocios (nombre_orden) where activo;
create index if not exists negocios_destacado_idx  on public.negocios (destacado_hasta) where activo and plan = 'destacado';
create index if not exists ofertas_negocio_idx     on public.ofertas (negocio_id);
create index if not exists ofertas_vigencia_idx    on public.ofertas (vigente_hasta) where activa;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function privado.tocar_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Slug único a partir del nombre si viene vacío; normaliza el que venga.
create or replace function privado.poner_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  base text;
  cand text;
  n    int := 1;
  existe boolean;
begin
  base := privado.slugify(coalesce(nullif(trim(new.slug), ''), new.nombre));
  if base = '' then base := 'item'; end if;
  cand := base;
  loop
    execute format('select exists(select 1 from %I.%I where slug = $1 and id <> $2)',
                   tg_table_schema, tg_table_name)
      into existe using cand, new.id;
    exit when not existe;
    n := n + 1;
    cand := base || '-' || n;
  end loop;
  new.slug := cand;
  return new;
end $$;

-- Columna de búsqueda y orden alfabético sin tildes.
create or replace function privado.indexar_negocio()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cat text;
begin
  select c.nombre into cat from public.categorias c where c.id = new.categoria_id;
  new.nombre_orden := privado.normalizar(new.nombre);
  new.busqueda :=
       setweight(to_tsvector('privado.es_sin_tildes', coalesce(new.nombre, '')), 'A')
    || setweight(to_tsvector('privado.es_sin_tildes', coalesce(cat, '') || ' ' || coalesce(new.etiqueta, '')), 'B')
    || setweight(to_tsvector('privado.es_sin_tildes', coalesce(new.ciudad, '') || ' ' || coalesce(new.direccion, '')), 'B')
    || setweight(to_tsvector('privado.es_sin_tildes',
                   array_to_string(new.amenidades, ' ') || ' ' || coalesce(new.descripcion, '')), 'C');
  return new;
end $$;

-- Si cambia el nombre de una categoría, se reindexan sus negocios.
create or replace function privado.reindexar_categoria()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.nombre is distinct from old.nombre then
    update public.negocios set nombre = nombre where categoria_id = new.id;
  end if;
  return null;
end $$;

-- Sube la versión de datos en cada cambio (incluye borrados).
create or replace function privado.subir_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.meta set version = version + 1, updated_at = now() where id = 1;
  return null;
end $$;
revoke all on function privado.subir_version() from public, anon, authenticated;

drop trigger if exists t_updated on public.categorias;
create trigger t_updated before update on public.categorias
  for each row execute function privado.tocar_updated_at();
drop trigger if exists t_updated on public.negocios;
create trigger t_updated before update on public.negocios
  for each row execute function privado.tocar_updated_at();
drop trigger if exists t_updated on public.ofertas;
create trigger t_updated before update on public.ofertas
  for each row execute function privado.tocar_updated_at();

drop trigger if exists t_slug on public.categorias;
create trigger t_slug before insert or update of nombre, slug on public.categorias
  for each row execute function privado.poner_slug();
drop trigger if exists t_slug on public.negocios;
create trigger t_slug before insert or update of nombre, slug on public.negocios
  for each row execute function privado.poner_slug();

drop trigger if exists t_indexar on public.negocios;
create trigger t_indexar before insert or update on public.negocios
  for each row execute function privado.indexar_negocio();

drop trigger if exists t_reindexar on public.categorias;
create trigger t_reindexar after update of nombre on public.categorias
  for each row execute function privado.reindexar_categoria();

drop trigger if exists t_version on public.categorias;
create trigger t_version after insert or update or delete on public.categorias
  for each statement execute function privado.subir_version();
drop trigger if exists t_version on public.negocios;
create trigger t_version after insert or update or delete on public.negocios
  for each statement execute function privado.subir_version();
drop trigger if exists t_version on public.ofertas;
create trigger t_version after insert or update or delete on public.ofertas
  for each statement execute function privado.subir_version();
