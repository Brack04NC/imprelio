insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('estimate-source-pdfs', 'estimate-source-pdfs', false, 26214400, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.estimate_pdf_files (
  organization_id uuid not null references public.organizations on delete cascade,
  id uuid not null,
  site_id uuid not null,
  file_name text not null check (
    length(file_name) between 5 and 250 and right(lower(file_name), 4) = '.pdf'
    and file_name = btrim(file_name) and file_name !~ '[[:cntrl:]]'
    and strpos(file_name, '/') = 0 and strpos(file_name, chr(92)) = 0
  ),
  size_bytes integer not null check (size_bytes between 1 and 26214400),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  primary key (organization_id, id),
  foreign key (organization_id, site_id) references public.sites (organization_id, id)
);

create index estimate_pdf_files_site on public.estimate_pdf_files (organization_id, site_id, uploaded_at desc, id);

alter table public.estimate_pdf_files enable row level security;
create policy estimate_pdf_files_read on public.estimate_pdf_files
  for select to authenticated using (imprelio_private.has_access(organization_id));
revoke all on public.estimate_pdf_files from public, anon, authenticated;
grant select on public.estimate_pdf_files to authenticated;

create function imprelio_private.can_access_estimate_pdf(object_name text, finalized boolean)
returns boolean language plpgsql stable set search_path = '' as $$
begin
  if object_name is null or object_name !~ (
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' ||
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]pdf$'
  ) then
    return false;
  end if;
  return exists (
    select 1 from public.estimate_pdf_files as file
    where file.organization_id = substr(object_name, 1, 36)::uuid
      and file.id = substr(object_name, 38, 36)::uuid
      and (file.uploaded_at is not null) = finalized
  );
end;
$$;

revoke all on function imprelio_private.can_access_estimate_pdf(text, boolean) from public, anon, authenticated;
grant execute on function imprelio_private.can_access_estimate_pdf(text, boolean) to authenticated;

create policy estimate_pdf_object_upload on storage.objects
  for insert to authenticated with check (bucket_id = 'estimate-source-pdfs');
create policy estimate_pdf_object_download on storage.objects
  for select to authenticated using (bucket_id = 'estimate-source-pdfs');

-- Existing permissive Storage policies must not unlock this bucket.
create policy estimate_pdf_object_upload_guard on storage.objects as restrictive
  for insert to authenticated with check (
    bucket_id <> 'estimate-source-pdfs' or imprelio_private.can_access_estimate_pdf(name, false)
  );
create policy estimate_pdf_object_download_guard on storage.objects as restrictive
  for select to authenticated using (
    bucket_id <> 'estimate-source-pdfs' or imprelio_private.can_access_estimate_pdf(name, true)
  );
create policy estimate_pdf_object_update_guard on storage.objects as restrictive
  for update to authenticated using (bucket_id <> 'estimate-source-pdfs') with check (bucket_id <> 'estimate-source-pdfs');
create policy estimate_pdf_object_delete_guard on storage.objects as restrictive
  for delete to authenticated using (bucket_id <> 'estimate-source-pdfs');
create policy estimate_pdf_object_anon_guard on storage.objects as restrictive
  for all to anon using (bucket_id <> 'estimate-source-pdfs') with check (bucket_id <> 'estimate-source-pdfs');

create function public.imprelio_prepare_estimate_pdf(org uuid, site uuid, file_id uuid, original_name text, bytes integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cleaned_name text := btrim(original_name);
  saved public.estimate_pdf_files%rowtype;
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;

  if file_id is null or cleaned_name is null or length(cleaned_name) not between 5 and 250
    or right(lower(cleaned_name), 4) <> '.pdf' or original_name ~ '[[:cntrl:]]'
    or strpos(cleaned_name, '/') > 0 or strpos(cleaned_name, chr(92)) > 0
    or bytes is null or bytes not between 1 and 26214400 then
    raise exception 'Nome o dimensione del PDF non validi' using errcode = '22023';
  end if;

  if not exists (select 1 from public.sites where organization_id = org and id = site) then
    raise exception 'Cantiere non disponibile' using errcode = 'P0002';
  end if;

  insert into public.estimate_pdf_files (organization_id, id, site_id, file_name, size_bytes)
  values (org, file_id, site, cleaned_name, bytes)
  on conflict (organization_id, id) do nothing
  returning * into saved;
  if not found then
    select * into saved from public.estimate_pdf_files where organization_id = org and id = file_id;
    if (saved.site_id, saved.file_name, saved.size_bytes) is distinct from (site, cleaned_name, bytes) then
      raise exception 'L’identificativo del PDF è già associato a un altro file' using errcode = '23505';
    end if;
  end if;
  return to_jsonb(saved);
end;
$$;

create function public.imprelio_finish_estimate_pdf(org uuid, file_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved public.estimate_pdf_files%rowtype;
  object_metadata jsonb;
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;

  select * into saved from public.estimate_pdf_files where organization_id = org and id = file_id for update;
  if not found then
    raise exception 'PDF non disponibile' using errcode = 'P0002';
  end if;

  -- Only Storage's metadata for the reserved object can finalize a reservation.
  select metadata into object_metadata from storage.objects
  where bucket_id = 'estimate-source-pdfs' and name = org::text || '/' || file_id::text || '.pdf';
  if not found then return null; end if;

  if object_metadata->>'size' is distinct from saved.size_bytes::text
    or lower(object_metadata->>'mimetype') is distinct from 'application/pdf' then
    raise exception 'Il PDF caricato non corrisponde al file selezionato' using errcode = '22023';
  end if;

  if saved.uploaded_at is null then
    update public.estimate_pdf_files set uploaded_at = now() where organization_id = org and id = file_id
    returning * into saved;
  end if;
  return to_jsonb(saved);
end;
$$;

revoke all on function public.imprelio_prepare_estimate_pdf(uuid, uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.imprelio_finish_estimate_pdf(uuid, uuid) from public, anon, authenticated;
grant execute on function public.imprelio_prepare_estimate_pdf(uuid, uuid, uuid, text, integer) to authenticated;
grant execute on function public.imprelio_finish_estimate_pdf(uuid, uuid) to authenticated;
