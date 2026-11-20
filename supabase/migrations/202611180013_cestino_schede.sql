alter table imprelio_private.trashed_records
  drop constraint trashed_records_entity_check,
  add constraint trashed_records_entity_check check (
    entity in ('intervention', 'quote', 'operation', 'client', 'site', 'worker_deadline', 'estimate_pdf')
  );

create index trashed_records_timeline
  on imprelio_private.trashed_records (organization_id, deleted_at desc, entity, id);

create function imprelio_private.is_trashed(org uuid, entity text, target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when target is null or not imprelio_private.has_access(org) then false else exists (
    select 1 from imprelio_private.trashed_records as record
    where record.organization_id = org and record.entity = $2 and record.id = target
  ) end;
$$;

revoke all on function imprelio_private.is_trashed(uuid, text, uuid) from public, anon, authenticated;
grant execute on function imprelio_private.is_trashed(uuid, text, uuid) to authenticated;

alter policy clients_read on public.clients using (
  imprelio_private.has_access(organization_id)
  and not imprelio_private.is_trashed(organization_id, 'client', id)
);
alter policy sites_read on public.sites using (
  imprelio_private.has_access(organization_id)
  and not imprelio_private.is_trashed(organization_id, 'site', id)
);
alter policy interventions_read on public.interventions using (
  imprelio_private.has_access(organization_id)
  and not imprelio_private.is_trashed(organization_id, 'site', site_id)
);
alter policy operation_records_read on public.operation_records using (
  imprelio_private.has_access(organization_id)
  and not imprelio_private.is_trashed(organization_id, 'operation', id)
);
alter policy worker_deadlines_read on public.worker_deadlines using (
  imprelio_private.has_access(organization_id)
  and not imprelio_private.is_trashed(organization_id, 'worker_deadline', id)
  and not imprelio_private.is_trashed(organization_id, 'operation', worker_id)
);
alter policy estimate_pdf_files_read on public.estimate_pdf_files using (
  imprelio_private.has_access(organization_id)
  and not imprelio_private.is_trashed(organization_id, 'estimate_pdf', id)
);

-- Interventions and quotes retain their existing snapshot-and-remove lifecycle.
alter function public.imprelio_trash_write(uuid, text, uuid, text) set schema imprelio_private;
revoke all on function imprelio_private.imprelio_trash_write(uuid, text, uuid, text) from public, anon, authenticated;

create function public.imprelio_trash_write(org uuid, entity text, target uuid, operation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entity_kind text := entity;
  original jsonb;
  archived jsonb;
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;
  if target is null or coalesce(entity_kind, '') not in (
    'intervention', 'quote', 'operation', 'client', 'site', 'worker_deadline', 'estimate_pdf'
  ) or coalesce(operation, '') not in ('delete', 'restore') then
    raise exception 'Operazione non valida' using errcode = '22023';
  end if;

  -- Serialize with stock, links and writes to records which may be moved to the trash.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('imprelio:operations:' || org::text, 0));
  if entity_kind in ('intervention', 'quote') then
    return imprelio_private.imprelio_trash_write(org, entity_kind, target, operation);
  end if;

  select record.snapshot into archived from imprelio_private.trashed_records as record
    where record.organization_id = org and record.entity = entity_kind and record.id = target;

  if operation = 'delete' and archived is not null then
    return jsonb_build_object('id', target);
  end if;

  -- Retain the backing row so dependent documents, attendance and Storage objects keep their identity.
  case entity_kind
    when 'operation' then
      select to_jsonb(record) into original from public.operation_records as record
        where record.organization_id = org and record.id = target;
    when 'client' then
      select to_jsonb(record) into original from public.clients as record
        where record.organization_id = org and record.id = target;
    when 'site' then
      select to_jsonb(record) into original from public.sites as record
        where record.organization_id = org and record.id = target;
    when 'worker_deadline' then
      select to_jsonb(record) into original from public.worker_deadlines as record
        where record.organization_id = org and record.id = target;
    when 'estimate_pdf' then
      select to_jsonb(record) into original from public.estimate_pdf_files as record
        where record.organization_id = org and record.id = target and record.uploaded_at is not null;
  end case;

  if original is null then
    raise exception 'Scheda non disponibile' using errcode = 'P0002';
  end if;

  if operation = 'delete' then
    if entity_kind = 'client' and exists (
      select 1 from public.sites as site
      where site.organization_id = org and site.client_id = target
        and not imprelio_private.is_trashed(org, 'site', site.id)
    ) then
      raise exception 'Cliente con cantieri attivi' using errcode = 'P0001';
    end if;
    if entity_kind = 'operation' and not (original->>'archived')::boolean then
      perform public.imprelio_operation_write(org, jsonb_build_object(
        'action', 'archive', 'kind', original->>'kind', 'id', target
      ));
    end if;
    insert into imprelio_private.trashed_records (organization_id, entity, id, snapshot)
      values (org, entity_kind, target, original);
  elsif archived is not null then
    if entity_kind = 'site' and imprelio_private.is_trashed(org, 'client', (original->>'client_id')::uuid) then
      raise exception 'Il cliente collegato è nel cestino' using errcode = '23503';
    end if;
    if entity_kind = 'worker_deadline' and imprelio_private.is_trashed(org, 'operation', (original->>'worker_id')::uuid) then
      raise exception 'L’operaio collegato è nel cestino' using errcode = '23503';
    end if;

    delete from imprelio_private.trashed_records as record
      where record.organization_id = org and record.entity = entity_kind and record.id = target;
    if entity_kind = 'operation' and not (archived->>'archived')::boolean then
      -- If the stock check fails, PostgreSQL rolls back removal of the tombstone.
      perform public.imprelio_operation_write(org, jsonb_build_object(
        'action', 'restore', 'kind', archived->>'kind', 'id', target
      ));
    end if;
  end if;

  return jsonb_build_object('id', target);
end;
$$;

revoke all on function public.imprelio_trash_write(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.imprelio_trash_write(uuid, text, uuid, text) to authenticated;

create function public.imprelio_trash_list(org uuid)
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

revoke all on function public.imprelio_trash_list(uuid) from public, anon, authenticated;
grant execute on function public.imprelio_trash_list(uuid) to authenticated;

-- Keep the existing filename matching logic for notifications and exclude deleted sources.
alter function public.imprelio_pending_estimate_pdfs(uuid) set schema imprelio_private;
revoke all on function imprelio_private.imprelio_pending_estimate_pdfs(uuid) from public, anon, authenticated;

create function public.imprelio_pending_estimate_pdfs(org uuid)
returns table (id uuid, site_id uuid, file_name text, uploaded_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select file.id, file.site_id, file.file_name, file.uploaded_at
  from imprelio_private.imprelio_pending_estimate_pdfs(org) as file
  where not imprelio_private.is_trashed(org, 'estimate_pdf', file.id)
    and not imprelio_private.is_trashed(org, 'site', file.site_id)
  order by file.uploaded_at desc, file.id;
$$;

revoke all on function public.imprelio_pending_estimate_pdfs(uuid) from public, anon, authenticated;
grant execute on function public.imprelio_pending_estimate_pdfs(uuid) to authenticated;
