alter table public.vehicle_assignments
  alter column assignee_id drop not null,
  add column site_id uuid,
  add constraint vehicle_assignments_site_fkey
    foreign key (organization_id, site_id) references public.sites (organization_id, id),
  add constraint vehicle_assignments_one_destination
    check (num_nonnulls(assignee_id, site_id) = 1);

create index vehicle_assignments_site on public.vehicle_assignments (organization_id, site_id)
  where site_id is not null;

create function imprelio_private.vehicle_maintenance_period(vehicle_fields jsonb)
returns daterange language plpgsql immutable set search_path = '' as $$
declare
  from_text text := nullif(vehicle_fields->>'maintenance_from', '');
  to_text text := nullif(vehicle_fields->>'maintenance_to', '');
  from_day date;
  to_day date;
begin
  if coalesce(jsonb_typeof(vehicle_fields->'maintenance_from'), 'string') <> 'string'
    or coalesce(jsonb_typeof(vehicle_fields->'maintenance_to'), 'string') <> 'string' then
    raise exception 'Inserisci date di manutenzione valide' using errcode = '22023';
  end if;
  if from_text is null and to_text is null then
    return null;
  end if;
  if vehicle_fields->>'category' is distinct from 'vehicles' then
    raise exception 'Il periodo di manutenzione si applica ai veicoli' using errcode = '22023';
  end if;
  if from_text is null or to_text is null
    or from_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or to_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Inserisci date di manutenzione valide' using errcode = '22023';
  end if;

  from_day := from_text::date;
  to_day := to_text::date;
  if from_day > to_day then
    raise exception 'La fine della manutenzione deve coincidere con l’inizio o essere successiva' using errcode = '22023';
  end if;
  return daterange(from_day, to_day, '[]');
exception
  when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Inserisci date di manutenzione valide' using errcode = '22023';
end;
$$;

revoke all on function imprelio_private.vehicle_maintenance_period(jsonb) from public, anon, authenticated;

create function imprelio_private.check_vehicle_maintenance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  maintenance daterange;
begin
  maintenance := imprelio_private.vehicle_maintenance_period(new.fields);
  if maintenance is null then
    return new;
  end if;

  -- Use the same transaction lock as both warehouse and vehicle assignment writes.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('imprelio:operations:' || new.organization_id::text, 0));
  if exists (
    select 1 from public.vehicle_assignments as assignment
    cross join lateral jsonb_array_elements(assignment.periods) as booked(period)
    where assignment.organization_id = new.organization_id and assignment.vehicle_id = new.id
      and daterange((booked.period->>'start_date')::date, (booked.period->>'end_date')::date, '[]') && maintenance
  ) then
    raise exception 'Il periodo di manutenzione si sovrappone a un’assegnazione del veicolo' using errcode = '23P01';
  end if;
  return new;
end;
$$;

revoke all on function imprelio_private.check_vehicle_maintenance() from public, anon, authenticated;

create trigger operation_records_vehicle_maintenance
  before insert or update of fields, kind on public.operation_records
  for each row when (new.kind = 'article')
  execute function imprelio_private.check_vehicle_maintenance();

create or replace function public.imprelio_vehicle_assignment_write(org uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  operation text := payload->>'action';
  target uuid;
  vehicle uuid;
  assignee uuid;
  site uuid;
  maintenance daterange;
  periods jsonb;
  period jsonb;
  start_day date;
  end_day date;
  previous_end date;
  normalized jsonb := '[]';
  saved jsonb;
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;

  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text) > 16384
    or coalesce(operation, '') not in ('save', 'remove')
    or jsonb_typeof(payload->'id') is distinct from 'string' then
    raise exception 'Dati dell’assegnazione non validi' using errcode = '22023';
  end if;
  target := (payload->>'id')::uuid;

  -- Coordinate availability checks with updates to the warehouse and personnel records.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('imprelio:operations:' || org::text, 0));

  if operation = 'remove' then
    delete from public.vehicle_assignments where organization_id = org and id = target;
    return null;
  end if;

  periods := payload->'periods';
  if jsonb_typeof(payload->'vehicle_id') is distinct from 'string'
    or coalesce(jsonb_typeof(payload->'assignee_id'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(payload->'site_id'), 'null') not in ('string', 'null')
    or jsonb_typeof(periods) is distinct from 'array' then
    raise exception 'Dati dell’assegnazione non validi' using errcode = '22023';
  end if;
  if jsonb_array_length(periods) not between 1 and 50 then
    raise exception 'Inserisci da uno a 50 periodi' using errcode = '22023';
  end if;

  vehicle := (payload->>'vehicle_id')::uuid;
  assignee := (payload->>'assignee_id')::uuid;
  site := (payload->>'site_id')::uuid;
  if num_nonnulls(assignee, site) <> 1 then
    raise exception 'Seleziona un assegnatario o un cantiere' using errcode = '22023';
  end if;

  select imprelio_private.vehicle_maintenance_period(fields) into maintenance
  from public.operation_records
  where organization_id = org and id = vehicle and kind = 'article'
    and fields->>'category' = 'vehicles' and status = 'active' and not archived;
  if not found then
    raise exception 'Veicolo non disponibile' using errcode = 'P0002';
  end if;
  if assignee is not null and not exists (
    select 1 from public.operation_records
    where organization_id = org and id = assignee and kind in ('employee', 'worker', 'crew') and not archived
  ) then
    raise exception 'Assegnatario non disponibile' using errcode = 'P0002';
  end if;
  if site is not null and not exists (
    select 1 from public.sites
    where organization_id = org and id = site
  ) then
    raise exception 'Cantiere non disponibile' using errcode = 'P0002';
  end if;

  for period in select value from jsonb_array_elements(periods) order by value->>'start_date', value->>'end_date'
  loop
    if jsonb_typeof(period) is distinct from 'object'
      or jsonb_typeof(period->'start_date') is distinct from 'string'
      or jsonb_typeof(period->'end_date') is distinct from 'string'
      or (period->>'start_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (period->>'end_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Inserisci date di inizio e fine valide' using errcode = '22023';
    end if;
    start_day := (period->>'start_date')::date;
    end_day := (period->>'end_date')::date;
    if start_day > end_day then
      raise exception 'La fine del periodo deve coincidere con l’inizio o essere successiva' using errcode = '22023';
    end if;
    if maintenance && daterange(start_day, end_day, '[]') then
      raise exception 'Il veicolo è in manutenzione in uno dei periodi scelti' using errcode = '23P01';
    end if;
    if start_day <= previous_end then
      raise exception 'I periodi della stessa assegnazione si sovrappongono' using errcode = '23P01';
    end if;
    previous_end := end_day;
    normalized := normalized || jsonb_build_array(jsonb_build_object(
      'start_date', period->>'start_date', 'end_date', period->>'end_date'
    ));
  end loop;

  if exists (
    select 1 from public.vehicle_assignments as other
    cross join lateral jsonb_array_elements(other.periods) as booked(period)
    cross join jsonb_array_elements(normalized) as requested(period)
    where other.organization_id = org and other.vehicle_id = vehicle and other.id <> target
      and (booked.period->>'start_date')::date <= (requested.period->>'end_date')::date
      and (requested.period->>'start_date')::date <= (booked.period->>'end_date')::date
  ) then
    raise exception 'Il veicolo è già assegnato in uno dei periodi scelti' using errcode = '23P01';
  end if;

  insert into public.vehicle_assignments as assignment (id, organization_id, vehicle_id, assignee_id, site_id, periods)
  values (target, org, vehicle, assignee, site, normalized)
  on conflict (organization_id, id) do update
    set vehicle_id = excluded.vehicle_id, assignee_id = excluded.assignee_id, site_id = excluded.site_id,
      periods = excluded.periods, updated_at = now()
    where (assignment.vehicle_id, assignment.assignee_id, assignment.site_id, assignment.periods)
      is distinct from (excluded.vehicle_id, excluded.assignee_id, excluded.site_id, excluded.periods)
  returning to_jsonb(assignment) into saved;
  if not found then
    select to_jsonb(assignment) into saved
    from public.vehicle_assignments as assignment where organization_id = org and id = target;
  end if;
  return saved;
exception
  when invalid_text_representation then
    raise exception 'Dati dell’assegnazione non validi' using errcode = '22023';
  when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Inserisci date di inizio e fine valide' using errcode = '22023';
end;
$$;
