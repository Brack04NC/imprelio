insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('document-originals', 'document-originals', false, 26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function imprelio_private.document_file_suffix(mime text)
returns text language sql immutable set search_path = '' as $$
  select case mime
    when 'application/pdf' then '.pdf'
    when 'image/jpeg' then '.jpg'
    when 'image/png' then '.png'
    when 'image/webp' then '.webp'
  end;
$$;

create function imprelio_private.valid_document_extraction(value jsonb, document_kind text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  fields jsonb := value->'fields';
  field_name text;
  field_names text[] := array['title', 'number', 'date', 'issuer', 'recipient', 'total', 'currency', 'text'];
begin
  if jsonb_typeof(value) is distinct from 'object' or jsonb_typeof(fields) is distinct from 'object' then return false; end if;
  if value - array['fields', 'kind', 'status'] <> '{}'::jsonb
    or value->>'kind' is distinct from document_kind
    or coalesce(value->>'status', '') not in ('extracted', 'review', 'unreadable')
    or fields - field_names <> '{}'::jsonb then return false;
  end if;

  foreach field_name in array field_names loop
    if jsonb_typeof(fields->field_name) is distinct from 'string' then return false; end if;
  end loop;

  if length(fields->>'title') > 250 or length(fields->>'number') > 100
    or length(fields->>'issuer') > 250 or length(fields->>'recipient') > 250
    or length(fields->>'text') > 24000
    or fields->>'total' !~ '^(|-?[0-9]{1,12}([.][0-9]{1,2})?)$'
    or fields->>'currency' !~ '^(|[A-Z]{3})$' then return false;
  end if;
  if fields->>'date' = '' then return true; end if;
  return fields->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and (fields->>'date')::date >= date '0001-01-01';
exception
  when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;

revoke all on function imprelio_private.document_file_suffix(text),
  imprelio_private.valid_document_extraction(jsonb, text) from public, anon, authenticated;

create table public.document_imports (
  organization_id uuid not null references public.organizations on delete cascade,
  id uuid not null,
  created_by uuid not null,
  kind text not null check (kind in ('invoice', 'quote', 'estimate', 'other')),
  file_name text not null check (
    length(file_name) between 5 and 250 and file_name = btrim(file_name)
    and file_name !~ '[[:cntrl:]]' and strpos(file_name, '/') = 0 and strpos(file_name, chr(92)) = 0
  ),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 26214400),
  site_id uuid,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  extraction jsonb,
  primary key (organization_id, id),
  foreign key (organization_id, site_id) references public.sites (organization_id, id),
  constraint document_imports_extraction_coherent check (
    (uploaded_at is null and extraction is null)
    or (uploaded_at is not null and extraction is not null and imprelio_private.valid_document_extraction(extraction, kind))
  )
);

create index document_imports_ready
  on public.document_imports (organization_id, created_at desc, id) where uploaded_at is not null;

alter table public.document_imports enable row level security;
create policy document_imports_read on public.document_imports for select to authenticated using (
  imprelio_private.has_access(organization_id)
  and (uploaded_at is not null or created_by = auth.uid())
  and not imprelio_private.is_trashed(organization_id, 'site', site_id)
);

revoke all on public.document_imports from public, anon, authenticated;
grant select on public.document_imports to authenticated;

alter table public.estimate_pdf_files add column document_extraction jsonb
  check (document_extraction is null or imprelio_private.valid_document_extraction(document_extraction, 'estimate'));

create function imprelio_private.can_access_document_original(object_name text, for_upload boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if object_name is null or object_name !~ (
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' ||
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|jpg|png|webp)$'
  ) then return false; end if;

  return exists (
    select 1 from public.document_imports as file
    where file.organization_id = substr(object_name, 1, 36)::uuid
      and file.id = substr(object_name, 38, 36)::uuid
      and substr(object_name, 74) = imprelio_private.document_file_suffix(file.mime_type)
      and imprelio_private.has_access(file.organization_id)
      and not imprelio_private.is_trashed(file.organization_id, 'site', file.site_id)
      and case when for_upload then file.uploaded_at is null and file.created_by = auth.uid()
        else file.uploaded_at is not null or file.created_by = auth.uid() end
  );
end;
$$;

revoke all on function imprelio_private.can_access_document_original(text, boolean) from public, anon, authenticated;
grant execute on function imprelio_private.can_access_document_original(text, boolean) to authenticated;

create policy document_original_upload on storage.objects
  for insert to authenticated with check (bucket_id = 'document-originals');
create policy document_original_read on storage.objects
  for select to authenticated using (bucket_id = 'document-originals');
create policy document_original_upload_guard on storage.objects as restrictive
  for insert to authenticated with check (
    bucket_id <> 'document-originals' or imprelio_private.can_access_document_original(name, true)
  );
create policy document_original_read_guard on storage.objects as restrictive
  for select to authenticated using (
    bucket_id <> 'document-originals' or imprelio_private.can_access_document_original(name, false)
  );
create policy document_original_update_guard on storage.objects as restrictive
  for update to authenticated using (bucket_id <> 'document-originals') with check (bucket_id <> 'document-originals');
create policy document_original_delete_guard on storage.objects as restrictive
  for delete to authenticated using (bucket_id <> 'document-originals');
create policy document_original_anon_guard on storage.objects as restrictive
  for all to anon using (bucket_id <> 'document-originals') with check (bucket_id <> 'document-originals');

create function public.imprelio_prepare_document(org uuid, file_id uuid, document_kind text,
  original_name text, mime text, bytes integer, site uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cleaned_name text := btrim(original_name);
  extension text := imprelio_private.document_file_suffix(mime);
  saved public.document_imports%rowtype;
begin
  if not imprelio_private.has_access(org) then raise exception 'Accesso negato' using errcode = '42501'; end if;
  if file_id is null or coalesce(document_kind, '') not in ('invoice', 'quote', 'estimate', 'other')
    or extension is null or cleaned_name is null or length(cleaned_name) not between 5 and 250
    or (right(lower(cleaned_name), length(extension)) <> extension
      and not (mime = 'image/jpeg' and right(lower(cleaned_name), 5) = '.jpeg'))
    or original_name ~ '[[:cntrl:]]' or strpos(cleaned_name, '/') > 0 or strpos(cleaned_name, chr(92)) > 0
    or bytes is null or bytes not between 1 and 26214400 then
    raise exception 'Dati del file non validi' using errcode = '22023';
  end if;

  perform imprelio_private.lock_live_records(org);
  if site is not null and (imprelio_private.is_trashed(org, 'site', site)
    or not exists (select 1 from public.sites where organization_id = org and id = site)) then
    raise exception 'Cantiere non disponibile' using errcode = 'P0002';
  end if;

  insert into public.document_imports (organization_id, id, created_by, kind, file_name, mime_type, size_bytes, site_id)
  values (org, file_id, auth.uid(), document_kind, cleaned_name, mime, bytes, site)
  on conflict (organization_id, id) do nothing returning * into saved;
  if not found then
    select * into saved from public.document_imports where organization_id = org and id = file_id;
    if (saved.uploaded_at is null and saved.created_by is distinct from auth.uid())
      or (saved.kind, saved.file_name, saved.mime_type, saved.size_bytes, saved.site_id)
        is distinct from (document_kind, cleaned_name, mime, bytes, site) then
      raise exception 'Identificativo del file già utilizzato' using errcode = '23505';
    end if;
  end if;
  return to_jsonb(saved);
end;
$$;

create function public.imprelio_finish_document(org uuid, file_id uuid, document_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved public.document_imports%rowtype;
  object_metadata jsonb;
begin
  if not imprelio_private.has_access(org) then raise exception 'Accesso negato' using errcode = '42501'; end if;
  perform imprelio_private.lock_live_records(org);

  select * into saved from public.document_imports
  where organization_id = org and id = file_id for update;
  if not found or (saved.uploaded_at is null and saved.created_by is distinct from auth.uid())
    or imprelio_private.is_trashed(org, 'site', saved.site_id) then
    raise exception 'Documento non disponibile' using errcode = 'P0002';
  end if;
  if saved.uploaded_at is not null then return to_jsonb(saved); end if;
  if not imprelio_private.valid_document_extraction(document_data, saved.kind) then
    raise exception 'Dati del documento non validi' using errcode = '22023';
  end if;

  select metadata into object_metadata from storage.objects where bucket_id = 'document-originals'
    and name = org::text || '/' || file_id::text || imprelio_private.document_file_suffix(saved.mime_type);
  if not found then return null; end if;
  if object_metadata->>'size' is distinct from saved.size_bytes::text
    or lower(object_metadata->>'mimetype') is distinct from saved.mime_type then
    raise exception 'Il file caricato non corrisponde all’originale selezionato' using errcode = '22023';
  end if;

  update public.document_imports set uploaded_at = now(), extraction = document_data
    where organization_id = org and id = file_id returning * into saved;
  return to_jsonb(saved);
end;
$$;

create function public.imprelio_attach_estimate_document(org uuid, file_id uuid, document_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved public.estimate_pdf_files%rowtype;
begin
  if not imprelio_private.has_access(org) then raise exception 'Accesso negato' using errcode = '42501'; end if;
  if not imprelio_private.valid_document_extraction(document_data, 'estimate') then
    raise exception 'Dati del computo non validi' using errcode = '22023';
  end if;

  perform imprelio_private.lock_live_records(org);
  select * into saved from public.estimate_pdf_files where organization_id = org and id = file_id
    and uploaded_at is not null for update;
  if not found or imprelio_private.is_trashed(org, 'estimate_pdf', file_id)
    or imprelio_private.is_trashed(org, 'site', saved.site_id) then
    raise exception 'Computo non disponibile' using errcode = 'P0002';
  end if;
  if saved.document_extraction is null then
    update public.estimate_pdf_files set document_extraction = document_data
      where organization_id = org and id = file_id returning * into saved;
  end if;
  return to_jsonb(saved);
end;
$$;

revoke all on function public.imprelio_prepare_document(uuid, uuid, text, text, text, integer, uuid),
  public.imprelio_finish_document(uuid, uuid, jsonb), public.imprelio_attach_estimate_document(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.imprelio_prepare_document(uuid, uuid, text, text, text, integer, uuid),
  public.imprelio_finish_document(uuid, uuid, jsonb), public.imprelio_attach_estimate_document(uuid, uuid, jsonb)
  to authenticated;
