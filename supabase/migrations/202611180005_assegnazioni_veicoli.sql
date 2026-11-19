alter table public.operation_records
  add constraint operation_records_organization_id_id_key unique (organization_id, id);

create table public.vehicle_assignments (
  id uuid not null,
  organization_id uuid not null references public.organizations on delete cascade,
  vehicle_id uuid not null,
  assignee_id uuid not null,
  periods jsonb not null check (
    case when jsonb_typeof(periods) = 'array' then jsonb_array_length(periods) between 1 and 50 else false end
  ),
  updated_at timestamptz not null default now(),
  primary key (organization_id, id),
  foreign key (organization_id, vehicle_id) references public.operation_records (organization_id, id),
  foreign key (organization_id, assignee_id) references public.operation_records (organization_id, id)
);

create index vehicle_assignments_vehicle on public.vehicle_assignments (organization_id, vehicle_id);
create index vehicle_assignments_assignee on public.vehicle_assignments (organization_id, assignee_id);

alter table public.vehicle_assignments enable row level security;
create policy vehicle_assignments_read on public.vehicle_assignments for select to authenticated
  using (imprelio_private.has_access(organization_id));
revoke all on public.vehicle_assignments from public, anon, authenticated;
grant select on public.vehicle_assignments to authenticated;

create function public.imprelio_vehicle_assignment_write(org uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  operation text := payload->>'action';
  target uuid;
  vehicle uuid;
  assignee uuid;
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
    or jsonb_typeof(payload->'assignee_id') is distinct from 'string'
    or jsonb_typeof(periods) is distinct from 'array' then
    raise exception 'Dati dell’assegnazione non validi' using errcode = '22023';
  end if;
  if jsonb_array_length(periods) not between 1 and 50 then
    raise exception 'Inserisci da uno a 50 periodi' using errcode = '22023';
  end if;

  vehicle := (payload->>'vehicle_id')::uuid;
  assignee := (payload->>'assignee_id')::uuid;
  if not exists (
    select 1 from public.operation_records
    where organization_id = org and id = vehicle and kind = 'article'
      and fields->>'category' = 'vehicles' and status = 'active' and not archived
  ) then
    raise exception 'Veicolo non disponibile' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.operation_records
    where organization_id = org and id = assignee and kind in ('employee', 'worker', 'crew') and not archived
  ) then
    raise exception 'Assegnatario non disponibile' using errcode = 'P0002';
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

  insert into public.vehicle_assignments as assignment (id, organization_id, vehicle_id, assignee_id, periods)
  values (target, org, vehicle, assignee, normalized)
  on conflict (organization_id, id) do update
    set vehicle_id = excluded.vehicle_id, assignee_id = excluded.assignee_id,
      periods = excluded.periods, updated_at = now()
    where (assignment.vehicle_id, assignment.assignee_id, assignment.periods)
      is distinct from (excluded.vehicle_id, excluded.assignee_id, excluded.periods)
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

revoke all on function public.imprelio_vehicle_assignment_write(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.imprelio_vehicle_assignment_write(uuid, jsonb) to authenticated;
