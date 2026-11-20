create table public.worker_deadlines (
  id uuid not null,
  organization_id uuid not null references public.organizations on delete cascade,
  worker_id uuid not null,
  category text not null check (category in ('medical', 'certificate', 'other')),
  title text not null,
  completed_on date,
  due_on date,
  archived boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (organization_id, id),
  foreign key (organization_id, worker_id) references public.operation_records (organization_id, id),
  constraint worker_deadlines_title check (
    (category = 'medical' and title = 'Visita medica')
    or (category <> 'medical' and length(title) between 1 and 160 and title !~ '(^[[:space:]]|[[:space:]]$)')
  ),
  constraint worker_deadlines_dates check (
    (completed_on is not null or due_on is not null)
    and (completed_on is null or due_on is null or due_on >= completed_on)
  )
);

create index worker_deadlines_worker on public.worker_deadlines (organization_id, worker_id, archived, due_on);

alter table public.worker_deadlines enable row level security;
create policy worker_deadlines_read on public.worker_deadlines for select to authenticated
  using (imprelio_private.has_access(organization_id));
revoke all on public.worker_deadlines from public, anon, authenticated;
grant select on public.worker_deadlines to authenticated;

create function public.imprelio_worker_deadline_write(org uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  operation text := payload->>'action';
  target uuid;
  worker uuid;
  deadline_category text := payload->>'category';
  deadline_title text;
  completed_text text := payload->>'completed_on';
  due_text text := payload->>'due_on';
  completed date;
  due date;
  next_archived boolean;
  saved jsonb;
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text) > 4096
    or coalesce(operation, '') not in ('save', 'archive', 'restore')
    or jsonb_typeof(payload->'id') is distinct from 'string'
    or jsonb_typeof(payload->'worker_id') is distinct from 'string' then
    raise exception 'Dati della scadenza non validi' using errcode = '22023';
  end if;
  target := (payload->>'id')::uuid;
  worker := (payload->>'worker_id')::uuid;

  -- Use the same transaction lock as updates to workers.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('imprelio:operations:' || org::text, 0));
  perform 1 from public.operation_records
  where organization_id = org and id = worker and kind = 'worker' and not archived
  for share;
  if not found then
    raise exception 'Operaio non disponibile' using errcode = 'P0002';
  end if;

  if operation = 'save' then
    if coalesce(deadline_category, '') not in ('medical', 'certificate', 'other')
      or coalesce(jsonb_typeof(payload->'title'), 'null') not in ('string', 'null')
      or coalesce(jsonb_typeof(payload->'completed_on'), 'null') not in ('string', 'null')
      or coalesce(jsonb_typeof(payload->'due_on'), 'null') not in ('string', 'null')
      or (completed_text is null and due_text is null)
      or completed_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or due_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Dati della scadenza non validi' using errcode = '22023';
    end if;
    deadline_title := case when deadline_category = 'medical' then 'Visita medica'
      else regexp_replace(coalesce(payload->>'title', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g')
    end;
    if length(deadline_title) not between 1 and 160 then
      raise exception 'Il titolo deve contenere da 1 a 160 caratteri' using errcode = '22023';
    end if;
    completed := completed_text::date;
    due := due_text::date;
    if due < completed then
      raise exception 'La scadenza deve coincidere con la data di completamento o essere successiva' using errcode = '22023';
    end if;

    insert into public.worker_deadlines as deadline (id, organization_id, worker_id, category, title, completed_on, due_on)
    values (target, org, worker, deadline_category, deadline_title, completed, due)
    on conflict (organization_id, id) do update
      set category = excluded.category, title = excluded.title, completed_on = excluded.completed_on,
        due_on = excluded.due_on, updated_at = now()
      where deadline.worker_id = excluded.worker_id and not deadline.archived
        and (deadline.category, deadline.title, deadline.completed_on, deadline.due_on)
          is distinct from (excluded.category, excluded.title, excluded.completed_on, excluded.due_on)
    returning to_jsonb(deadline) into saved;
  else
    next_archived := operation = 'archive';
    update public.worker_deadlines as deadline
      set archived = next_archived, updated_at = now()
      where deadline.organization_id = org and deadline.id = target and deadline.worker_id = worker
        and deadline.archived <> next_archived
      returning to_jsonb(deadline) into saved;
  end if;

  if saved is null then
    select to_jsonb(deadline) into saved
    from public.worker_deadlines as deadline
    where deadline.organization_id = org and deadline.id = target and deadline.worker_id = worker
      and (operation <> 'save' or not deadline.archived);
    if not found then
      raise exception 'Scadenza non disponibile' using errcode = 'P0002';
    end if;
  end if;
  return saved;
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Dati della scadenza non validi' using errcode = '22023';
end;
$$;

revoke all on function public.imprelio_worker_deadline_write(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.imprelio_worker_deadline_write(uuid, jsonb) to authenticated;
