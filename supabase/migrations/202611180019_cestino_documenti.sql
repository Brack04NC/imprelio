alter table imprelio_private.trashed_records
  drop constraint trashed_records_entity_check,
  add constraint trashed_records_entity_check check (
    entity in ('intervention', 'quote', 'operation', 'client', 'site', 'worker_deadline', 'estimate_pdf', 'document_import')
  );

alter policy document_imports_read on public.document_imports using (
  imprelio_private.has_access(organization_id)
  and (uploaded_at is not null or created_by = auth.uid())
  and not imprelio_private.is_trashed(organization_id, 'site', site_id)
  and not imprelio_private.is_trashed(organization_id, 'document_import', id)
);

-- Copre anche le prenotazioni ripetute con ON CONFLICT durante l'importazione.
create trigger a_cestino_live_write before insert or update on public.document_imports
  for each row execute function imprelio_private.check_live_record('document_import', 'site');

alter function public.imprelio_trash_write(uuid, text, uuid, text) rename to trash_existing_records;
alter function public.trash_existing_records(uuid, text, uuid, text) set schema imprelio_private;
revoke all on function imprelio_private.trash_existing_records(uuid, text, uuid, text) from public, anon, authenticated;

create function public.imprelio_trash_write(org uuid, entity text, target uuid, operation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved public.document_imports%rowtype;
begin
  if entity is distinct from 'document_import' then
    return imprelio_private.trash_existing_records(org, entity, target, operation);
  end if;
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;
  if target is null or coalesce(operation, '') not in ('delete', 'restore') then
    raise exception 'Operazione non valida' using errcode = '22023';
  end if;

  perform imprelio_private.lock_live_records(org);
  select * into saved from public.document_imports
    where organization_id = org and id = target and uploaded_at is not null;
  if not found then raise exception 'Documento non disponibile' using errcode = 'P0002'; end if;

  if operation = 'delete' then
    insert into imprelio_private.trashed_records (organization_id, entity, id, snapshot)
      values (org, 'document_import', target, jsonb_build_object('file_name', saved.file_name))
      on conflict on constraint trashed_records_pkey do nothing;
  elsif imprelio_private.is_trashed(org, 'document_import', target) then
    if imprelio_private.is_trashed(org, 'site', saved.site_id) then
      raise exception 'Il cantiere collegato è nel cestino' using errcode = '23503';
    end if;
    delete from imprelio_private.trashed_records as record
      where record.organization_id = org and record.entity = 'document_import' and record.id = target;
  end if;

  return jsonb_build_object('id', target);
end;
$$;

revoke all on function public.imprelio_trash_write(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.imprelio_trash_write(uuid, text, uuid, text) to authenticated;

create or replace function public.imprelio_trash_list(org uuid)
returns table (id uuid, kind text, label text, deleted_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;

  return query select record.id, record.entity,
    case record.entity
      when 'client' then record.snapshot->>'name'
      when 'site' then record.snapshot->>'name'
      when 'estimate_pdf' then record.snapshot->>'file_name'
      when 'document_import' then record.snapshot->>'file_name'
      when 'intervention' then concat_ws(' · ', case record.snapshot->>'kind'
        when 'survey' then 'Sopralluogo'
        when 'assembly' then 'Montaggio'
        when 'adjustment' then 'Modifica'
        when 'dismantling' then 'Smontaggio'
        else 'Intervento'
      end, nullif(record.snapshot->>'zone', ''))
      else record.snapshot->>'title'
    end,
    record.deleted_at
  from imprelio_private.trashed_records as record
  where record.organization_id = org
  order by record.deleted_at desc, record.entity, record.id;
end;
$$;

create or replace function imprelio_private.can_access_document_original(object_name text, for_upload boolean)
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
      and not imprelio_private.is_trashed(file.organization_id, 'document_import', file.id)
      and case when for_upload then file.uploaded_at is null and file.created_by = auth.uid()
        else file.uploaded_at is not null or file.created_by = auth.uid() end
  );
end;
$$;

create or replace function public.imprelio_finish_document(org uuid, file_id uuid, document_data jsonb)
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
    or imprelio_private.is_trashed(org, 'site', saved.site_id)
    or imprelio_private.is_trashed(org, 'document_import', file_id) then
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
