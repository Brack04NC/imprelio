create table public.vehicle_log_entries (
  organization_id uuid not null references public.organizations on delete cascade,
  id uuid not null,
  vehicle_id uuid not null,
  kind text not null check (kind in ('usage', 'maintenance', 'extraordinary')),
  state text not null check (state in ('planned', 'done')),
  title text not null check (length(title) between 1 and 160 and title !~ '(^[[:space:]]|[[:space:]]$)'),
  start_date date not null,
  end_date date not null,
  operator_id uuid,
  site_id uuid,
  location text not null default '' check (length(location) <= 200),
  notes text not null default '' check (length(notes) <= 2000),
  operator_name text not null default '',
  site_name text not null default '',
  updated_at timestamptz not null default now(),
  primary key (organization_id, id),
  foreign key (organization_id, vehicle_id) references public.operation_records (organization_id, id),
  foreign key (organization_id, operator_id) references public.operation_records (organization_id, id),
  foreign key (organization_id, site_id) references public.sites (organization_id, id),
  check (start_date between '0001-01-01' and '9999-12-31' and end_date between start_date and '9999-12-31'),
  check (kind <> 'usage' or (state = 'done' and operator_id is not null and (site_id is not null or location ~ '[^[:space:]]')))
);

create index vehicle_log_entries_vehicle_dates
  on public.vehicle_log_entries (organization_id, vehicle_id, start_date desc, id);
create index vehicle_log_entries_operator
  on public.vehicle_log_entries (organization_id, operator_id) where operator_id is not null;
create index vehicle_log_entries_site
  on public.vehicle_log_entries (organization_id, site_id) where site_id is not null;

alter table public.vehicle_log_entries enable row level security;
create policy vehicle_log_entries_read on public.vehicle_log_entries for select to authenticated using (
  imprelio_private.has_access(organization_id)
  and not imprelio_private.is_trashed(organization_id, 'operation', vehicle_id)
);
revoke all on public.vehicle_log_entries from public, anon, authenticated;
grant select on public.vehicle_log_entries to authenticated;

create function public.imprelio_vehicle_log_save(org uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry_id uuid;
  vehicle uuid;
  entry_kind text := payload->>'kind';
  entry_state text := payload->>'state';
  entry_title text := regexp_replace(coalesce(payload->>'title', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  entry_start date;
  entry_end date;
  entry_operator uuid;
  entry_site uuid;
  entry_location text := regexp_replace(coalesce(payload->>'location', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  entry_notes text := regexp_replace(coalesce(payload->>'notes', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  operator_label text := '';
  site_label text := '';
  previous public.vehicle_log_entries%rowtype;
  saved jsonb;
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text) > 16384
    or jsonb_typeof(payload->'id') is distinct from 'string'
    or jsonb_typeof(payload->'vehicle_id') is distinct from 'string'
    or jsonb_typeof(payload->'title') is distinct from 'string'
    or jsonb_typeof(payload->'start_date') is distinct from 'string'
    or jsonb_typeof(payload->'end_date') is distinct from 'string'
    or coalesce(jsonb_typeof(payload->'operator_id'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(payload->'site_id'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(payload->'location'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(payload->'notes'), 'null') not in ('string', 'null')
    or coalesce(entry_kind, '') not in ('usage', 'maintenance', 'extraordinary')
    or coalesce(entry_state, '') not in ('planned', 'done')
    or length(entry_title) not between 1 and 160
    or length(entry_location) > 200 or length(entry_notes) > 2000
    or payload->>'start_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or payload->>'end_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Dati del registro non validi' using errcode = '22023';
  end if;

  entry_id := (payload->>'id')::uuid;
  vehicle := (payload->>'vehicle_id')::uuid;
  entry_start := (payload->>'start_date')::date;
  entry_end := (payload->>'end_date')::date;
  entry_operator := (payload->>'operator_id')::uuid;
  entry_site := (payload->>'site_id')::uuid;
  if entry_end < entry_start
    or (entry_state = 'done' and entry_end > (now() at time zone 'Europe/Rome')::date)
    or (entry_kind = 'usage' and (entry_state <> 'done' or entry_operator is null or (entry_site is null and entry_location = ''))) then
    raise exception 'Controlla le date e i dati della registrazione' using errcode = '22023';
  end if;

  -- Serialize the availability check with archive, restore and reassignment writers.
  perform imprelio_private.lock_live_records(org);
  perform 1 from public.operation_records
  where organization_id = org and id = vehicle and kind = 'article'
    and fields->>'category' = 'vehicles' and not archived
    and not imprelio_private.is_trashed(org, 'operation', id);
  if not found then
    raise exception 'Veicolo non disponibile per le modifiche' using errcode = 'P0002';
  end if;

  select * into previous from public.vehicle_log_entries
    where organization_id = org and id = entry_id;
  if found and (previous.vehicle_id <> vehicle or previous.kind <> entry_kind) then
    raise exception 'Registrazione non disponibile' using errcode = 'P0002';
  end if;

  -- Unchanged links keep their original labels, including when their records enter the trash.
  if entry_operator is not null then
    if previous.operator_id is not distinct from entry_operator then
      operator_label := previous.operator_name;
    else
      select title into operator_label from public.operation_records
      where organization_id = org and id = entry_operator and kind in ('employee', 'worker', 'crew')
        and not archived and not imprelio_private.is_trashed(org, 'operation', id);
      if not found then
        raise exception 'Operatore non disponibile' using errcode = '23503';
      end if;
    end if;
  end if;
  if entry_site is not null then
    if previous.site_id is not distinct from entry_site then
      site_label := previous.site_name;
    else
      select name into site_label from public.sites
      where organization_id = org and id = entry_site and not imprelio_private.is_trashed(org, 'site', id);
      if not found then
        raise exception 'Cantiere non disponibile' using errcode = '23503';
      end if;
    end if;
  end if;

  insert into public.vehicle_log_entries as entry (
    organization_id, id, vehicle_id, kind, state, title, start_date, end_date, operator_id, site_id, location, notes, operator_name, site_name
  ) values (
    org, entry_id, vehicle, entry_kind, entry_state, entry_title, entry_start, entry_end, entry_operator, entry_site,
    entry_location, entry_notes, operator_label, site_label
  )
  on conflict (organization_id, id) do update
    set state = excluded.state, title = excluded.title, start_date = excluded.start_date, end_date = excluded.end_date,
      operator_id = excluded.operator_id, site_id = excluded.site_id, location = excluded.location, notes = excluded.notes,
      operator_name = excluded.operator_name, site_name = excluded.site_name, updated_at = now()
    where (entry.state, entry.title, entry.start_date, entry.end_date, entry.operator_id, entry.site_id,
      entry.location, entry.notes, entry.operator_name, entry.site_name) is distinct from
      (excluded.state, excluded.title, excluded.start_date, excluded.end_date, excluded.operator_id, excluded.site_id,
      excluded.location, excluded.notes, excluded.operator_name, excluded.site_name)
  returning to_jsonb(entry) into saved;

  return coalesce(saved, to_jsonb(previous));
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Dati del registro non validi' using errcode = '22023';
end;
$$;

revoke all on function public.imprelio_vehicle_log_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.imprelio_vehicle_log_save(uuid, jsonb) to authenticated;
