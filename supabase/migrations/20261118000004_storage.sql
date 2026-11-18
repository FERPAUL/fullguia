-- FullGuia · 004 · Storage: bucket "negocios" (lectura pública por URL, escritura solo admin).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('negocios', 'negocios', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Sin política de SELECT para anon: los archivos se sirven por la URL pública del bucket,
-- pero nadie de afuera puede listar el contenido. El admin sí lista (necesario para borrar).
drop policy if exists negocios_admin_ver on storage.objects;
create policy negocios_admin_ver on storage.objects for select to authenticated
  using (bucket_id = 'negocios' and (select privado.es_admin()));
drop policy if exists negocios_admin_subir on storage.objects;
create policy negocios_admin_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'negocios' and (select privado.es_admin()));
drop policy if exists negocios_admin_cambiar on storage.objects;
create policy negocios_admin_cambiar on storage.objects for update to authenticated
  using (bucket_id = 'negocios' and (select privado.es_admin()))
  with check (bucket_id = 'negocios' and (select privado.es_admin()));
drop policy if exists negocios_admin_borrar on storage.objects;
create policy negocios_admin_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'negocios' and (select privado.es_admin()));
