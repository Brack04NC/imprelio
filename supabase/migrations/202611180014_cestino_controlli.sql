-- Share the organization lock with the trash lifecycle and the operational writers.
create function imprelio_private.lock_live_records(org uuid)
returns void language sql set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('imprelio:operations:' || org::text, 0));
$$;

create function imprelio_private.check_live_record()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  entity text := nullif(tg_argv[0], '');
  linked_kind text := tg_argv[1];
  linked_id uuid;
begin
  if tg_table_name = 'estimate_quotes' and tg_op = 'UPDATE' then
    -- Direct quote updates already hold the row lock. Retry if deletion holds the organization lock.
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('imprelio:operations:' || new.organization_id::text, 0)) then
      raise exception 'Preventivo in aggiornamento. Riprova.' using errcode = '55P03';
    end if;
  else
    perform imprelio_private.lock_live_records(new.organization_id);
  end if;

  if entity is not null and imprelio_private.is_trashed(new.organization_id, entity, new.id) then
    raise exception 'La scheda è nel cestino' using errcode = 'P0002';
  end if;

  -- Changing only archival state may preserve the historical site of an existing record.
  if entity = 'operation' and tg_op = 'UPDATE' then
    if new.archived is distinct from old.archived and new.site_id is not distinct from old.site_id then
      return new;
    end if;
  end if;

  if linked_kind = 'client' then
    linked_id := new.client_id;
  elsif linked_kind = 'site' then
    linked_id := new.site_id;
  end if;
  if linked_id is not null and imprelio_private.is_trashed(new.organization_id, linked_kind, linked_id) then
    raise exception 'La scheda collegata è nel cestino' using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function imprelio_private.lock_live_records(uuid), imprelio_private.check_live_record() from public, anon, authenticated;

create trigger a_cestino_live_write before insert or update on public.clients
  for each row execute function imprelio_private.check_live_record('client', '');
create trigger a_cestino_live_write before insert or update on public.sites
  for each row execute function imprelio_private.check_live_record('site', 'client');
create trigger a_cestino_live_write before insert or update on public.operation_records
  for each row execute function imprelio_private.check_live_record('operation', 'site');
create trigger a_cestino_live_write before insert or update on public.interventions
  for each row execute function imprelio_private.check_live_record('', 'site');
create trigger a_cestino_live_write before insert or update on public.estimate_quotes
  for each row execute function imprelio_private.check_live_record('', 'site');
create trigger a_cestino_live_write before insert or update on public.estimate_pdf_files
  for each row execute function imprelio_private.check_live_record('estimate_pdf', 'site');
create trigger a_cestino_live_write before insert or update on public.vehicle_assignments
  for each row execute function imprelio_private.check_live_record('', 'site');
create trigger a_cestino_live_write before insert or update on public.attendance_entries
  for each row execute function imprelio_private.check_live_record('', 'site');
create trigger a_cestino_live_write before insert or update of site_id, organization_id on public.financial_entries
  for each row execute function imprelio_private.check_live_record('', 'site');

-- Take the organization lock before legacy site and intervention writers obtain row locks.
alter function public.imprelio_write(uuid, jsonb) set schema imprelio_private;
revoke all on function imprelio_private.imprelio_write(uuid, jsonb) from public, anon, authenticated;
create function public.imprelio_write(org uuid, payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if payload->>'action' in ('site', 'job', 'jobStatus') then
    if not imprelio_private.has_access(org) then
      raise exception 'Accesso negato' using errcode = '42501';
    end if;
    perform imprelio_private.lock_live_records(org);
  end if;
  perform imprelio_private.imprelio_write(org, payload);
end;
$$;

-- An idempotent archive or restore can return without executing an UPDATE trigger.
alter function public.imprelio_operation_write(uuid, jsonb) set schema imprelio_private;
revoke all on function imprelio_private.imprelio_operation_write(uuid, jsonb) from public, anon, authenticated;
create function public.imprelio_operation_write(org uuid, payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;
  perform imprelio_private.lock_live_records(org);
  if payload->>'action' in ('save', 'archive', 'restore') and jsonb_typeof(payload->'id') = 'string'
    and imprelio_private.is_trashed(org, 'operation', (payload->>'id')::uuid) then
    raise exception 'La scheda è nel cestino' using errcode = 'P0002';
  end if;
  perform imprelio_private.imprelio_operation_write(org, payload);
exception when invalid_text_representation then
  raise exception 'Dati della scheda non validi' using errcode = '22023';
end;
$$;

alter function public.imprelio_worker_deadline_write(uuid, jsonb) set schema imprelio_private;
revoke all on function imprelio_private.imprelio_worker_deadline_write(uuid, jsonb) from public, anon, authenticated;
create function public.imprelio_worker_deadline_write(org uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;
  perform imprelio_private.lock_live_records(org);
  if payload->>'action' in ('save', 'archive', 'restore') and jsonb_typeof(payload->'id') = 'string'
    and imprelio_private.is_trashed(org, 'worker_deadline', (payload->>'id')::uuid) then
    raise exception 'La scadenza è nel cestino' using errcode = 'P0002';
  end if;
  return imprelio_private.imprelio_worker_deadline_write(org, payload);
exception when invalid_text_representation then
  raise exception 'Dati della scadenza non validi' using errcode = '22023';
end;
$$;

-- Finalizing an existing reservation can return metadata without writing the row.
alter function public.imprelio_finish_estimate_pdf(uuid, uuid) set schema imprelio_private;
revoke all on function imprelio_private.imprelio_finish_estimate_pdf(uuid, uuid) from public, anon, authenticated;
create function public.imprelio_finish_estimate_pdf(org uuid, file_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;
  perform imprelio_private.lock_live_records(org);
  if imprelio_private.is_trashed(org, 'estimate_pdf', file_id) then
    raise exception 'Il PDF è nel cestino' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.estimate_pdf_files as file
    where file.organization_id = org and file.id = file_id
      and imprelio_private.is_trashed(org, 'site', file.site_id)
  ) then
    raise exception 'Il cantiere è nel cestino' using errcode = '23503';
  end if;
  return imprelio_private.imprelio_finish_estimate_pdf(org, file_id);
end;
$$;

revoke all on function public.imprelio_write(uuid, jsonb), public.imprelio_operation_write(uuid, jsonb),
  public.imprelio_worker_deadline_write(uuid, jsonb), public.imprelio_finish_estimate_pdf(uuid, uuid) from public, anon, authenticated;
grant execute on function public.imprelio_write(uuid, jsonb), public.imprelio_operation_write(uuid, jsonb),
  public.imprelio_worker_deadline_write(uuid, jsonb), public.imprelio_finish_estimate_pdf(uuid, uuid) to authenticated;
