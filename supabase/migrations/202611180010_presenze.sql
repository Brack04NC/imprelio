create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

create table public.attendance_entries (
  id uuid not null,
  organization_id uuid not null references public.organizations on delete cascade,
  person_id uuid not null,
  work_date date not null,
  kind text not null check (kind in ('work', 'vacation', 'leave', 'sick', 'rest', 'other')),
  start_time time,
  end_time time,
  workplace text check (workplace in ('site', 'warehouse', 'office')),
  site_id uuid,
  updated_at timestamptz not null default now(),
  primary key (organization_id, id),
  foreign key (organization_id, person_id) references public.operation_records (organization_id, id),
  foreign key (organization_id, site_id) references public.sites (organization_id, id),
  constraint attendance_entries_times check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is not null and start_time < end_time and end_time < time '24:00'
      and extract(second from start_time) = 0 and extract(second from end_time) = 0)
  ),
  constraint attendance_entries_place check (
    (kind = 'work' and start_time is not null and workplace is not null
      and ((workplace = 'site') = (site_id is not null)))
    or (kind <> 'work' and workplace is null and site_id is null)
  ),
  constraint attendance_entries_no_overlap exclude using gist (
    organization_id with =,
    person_id with =,
    tsrange(work_date + coalesce(start_time, time '00:00'), work_date + coalesce(end_time, time '24:00'), '[)') with &&
  )
);

create index attendance_entries_calendar on public.attendance_entries (organization_id, work_date);
create index attendance_entries_person on public.attendance_entries (organization_id, person_id, work_date);
create index attendance_entries_site on public.attendance_entries (organization_id, site_id) where site_id is not null;

alter table public.attendance_entries enable row level security;
create policy attendance_entries_read on public.attendance_entries for select to authenticated
  using (imprelio_private.has_access(organization_id));
revoke all on public.attendance_entries from public, anon, authenticated;
grant select on public.attendance_entries to authenticated;

create function public.imprelio_attendance_write(org uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  operation text := payload->>'action';
  target uuid;
  person uuid;
  attendance_day date;
  entry_kind text := payload->>'kind';
  start_text text := payload->>'start_time';
  end_text text := payload->>'end_time';
  begins_at time;
  ends_at time;
  place text := payload->>'workplace';
  site uuid;
  saved jsonb;
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;

  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text) > 2048
    or coalesce(operation, '') not in ('save', 'remove')
    or jsonb_typeof(payload->'id') is distinct from 'string' then
    raise exception 'Dati della presenza non validi' using errcode = '22023';
  end if;
  target := (payload->>'id')::uuid;

  -- Coordinate overlap checks and staff archives with the operation records writer.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('imprelio:operations:' || org::text, 0));

  if exists (
    select 1 from public.attendance_entries as entry
    join public.operation_records as staff on staff.organization_id = entry.organization_id and staff.id = entry.person_id
    where entry.organization_id = org and entry.id = target
      and (staff.archived or staff.kind not in ('employee', 'worker'))
  ) then
    raise exception 'Persona non disponibile' using errcode = 'P0002';
  end if;

  if operation = 'remove' then
    delete from public.attendance_entries where organization_id = org and id = target;
    return null;
  end if;

  if jsonb_typeof(payload->'person_id') is distinct from 'string'
    or jsonb_typeof(payload->'work_date') is distinct from 'string'
    or (payload->>'work_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or coalesce(entry_kind, '') not in ('work', 'vacation', 'leave', 'sick', 'rest', 'other')
    or coalesce(jsonb_typeof(payload->'workplace'), 'null') not in ('null', 'string')
    or coalesce(jsonb_typeof(payload->'site_id'), 'null') not in ('null', 'string') then
    raise exception 'Dati della presenza non validi' using errcode = '22023';
  end if;
  person := (payload->>'person_id')::uuid;
  attendance_day := (payload->>'work_date')::date;
  site := (payload->>'site_id')::uuid;

  if coalesce(jsonb_typeof(payload->'start_time'), 'null') not in ('null', 'string')
    or coalesce(jsonb_typeof(payload->'end_time'), 'null') not in ('null', 'string')
    or (start_text is null) <> (end_text is null)
    or start_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or end_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Inserisci un orario di inizio e uno di fine validi' using errcode = '22023';
  end if;
  begins_at := start_text::time;
  ends_at := end_text::time;
  if begins_at >= ends_at then
    raise exception 'L’orario di fine deve essere successivo all’inizio' using errcode = '22023';
  end if;

  if entry_kind = 'work' then
    if begins_at is null or coalesce(place, '') not in ('site', 'warehouse', 'office')
      or ((place = 'site') <> (site is not null)) then
      raise exception 'Indica l’orario e il luogo di lavoro' using errcode = '22023';
    end if;
  elsif place is not null or site is not null then
    raise exception 'Il luogo di lavoro si applica alle presenze lavorate' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.operation_records
    where organization_id = org and id = person and kind in ('employee', 'worker') and not archived
  ) then
    raise exception 'Persona non disponibile' using errcode = 'P0002';
  end if;
  if site is not null and not exists (
    select 1 from public.sites where organization_id = org and id = site
  ) then
    raise exception 'Cantiere non disponibile' using errcode = 'P0002';
  end if;

  insert into public.attendance_entries as entry (id, organization_id, person_id, work_date, kind, start_time, end_time, workplace, site_id)
  values (target, org, person, attendance_day, entry_kind, begins_at, ends_at, place, site)
  on conflict (organization_id, id) do update
    set person_id = excluded.person_id, work_date = excluded.work_date, kind = excluded.kind,
      start_time = excluded.start_time, end_time = excluded.end_time, workplace = excluded.workplace,
      site_id = excluded.site_id, updated_at = now()
    where (entry.person_id, entry.work_date, entry.kind, entry.start_time, entry.end_time, entry.workplace, entry.site_id)
      is distinct from (excluded.person_id, excluded.work_date, excluded.kind, excluded.start_time,
        excluded.end_time, excluded.workplace, excluded.site_id)
  returning to_jsonb(entry) into saved;
  if not found then
    select to_jsonb(entry) into saved
    from public.attendance_entries as entry where entry.organization_id = org and entry.id = target;
  end if;
  return saved;
exception
  when exclusion_violation then
    raise exception 'La registrazione si sovrappone a una presenza o assenza di questa persona' using errcode = '23P01';
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Dati della presenza non validi' using errcode = '22023';
end;
$$;

revoke all on function public.imprelio_attendance_write(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.imprelio_attendance_write(uuid, jsonb) to authenticated;
