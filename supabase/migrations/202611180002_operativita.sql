create table public.operation_records (
  id uuid primary key,
  organization_id uuid not null references public.organizations on delete cascade,
  kind text not null check (kind in ('article', 'movement', 'employee', 'worker', 'crew', 'invoice', 'order', 'ddt', 'estimate')),
  site_id uuid,
  title text not null check (length(btrim(title)) between 1 and 160),
  status text not null check (length(btrim(status)) between 1 and 64),
  record_date date,
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 100),
  archived boolean not null default false,
  updated_at timestamptz not null default now(),
  foreign key (organization_id, site_id) references public.sites (organization_id, id)
);

create index operation_records_list on public.operation_records (organization_id, kind, updated_at desc, id);
create index operation_records_site on public.operation_records (organization_id, site_id, kind) where site_id is not null;
create index operation_records_stock on public.operation_records (organization_id, (fields->>'article_id'))
  where kind = 'movement' and not archived;

alter table public.operation_records enable row level security;
create policy operation_records_read on public.operation_records for select to authenticated
  using (imprelio_private.has_access(organization_id));
revoke all on public.operation_records from public, anon, authenticated;
grant select on public.operation_records to authenticated;

create function public.imprelio_operation_write(org uuid, payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  operation text := payload->>'action';
  record_kind text := payload->>'kind';
  target uuid;
  existing public.operation_records%rowtype;
  new_site uuid;
  new_title text;
  new_status text;
  new_date date;
  new_fields jsonb;
  new_lines jsonb;
  prior_article text;
  next_article text;
  movement_quantity text;
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;

  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text) > 131072
    or operation is null or operation not in ('save', 'archive', 'restore')
    or record_kind is null or record_kind not in ('article', 'movement', 'employee', 'worker', 'crew', 'invoice', 'order', 'ddt', 'estimate')
    or jsonb_typeof(payload->'id') is distinct from 'string' then
    raise exception 'Dati della scheda non validi' using errcode = '22023';
  end if;
  target := (payload->>'id')::uuid;

  -- Serialize the stock check and its associated write for each organization.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('imprelio:operations:' || org::text, 0));

  select * into existing from public.operation_records
    where id = target and organization_id = org and kind = record_kind;
  if operation <> 'save' and existing.id is null then
    raise exception 'Scheda non disponibile' using errcode = 'P0002';
  end if;
  if operation = 'save' and existing.archived then
    raise exception 'Scheda non disponibile' using errcode = 'P0002';
  end if;

  if record_kind = 'movement' then
    prior_article := existing.fields->>'article_id';
  end if;

  if operation = 'save' then
    new_title := btrim(payload->>'title');
    new_status := btrim(payload->>'status');
    new_fields := payload->'fields';
    new_lines := payload->'lines';
    if jsonb_typeof(payload->'title') is distinct from 'string' or length(new_title) not between 1 and 160
      or jsonb_typeof(payload->'status') is distinct from 'string' or length(new_status) not between 1 and 64
      or jsonb_typeof(new_fields) is distinct from 'object'
      or jsonb_typeof(new_lines) is distinct from 'array'
      or coalesce(jsonb_typeof(payload->'site_id'), 'null') not in ('null', 'string')
      or coalesce(jsonb_typeof(payload->'record_date'), 'null') not in ('null', 'string')
      or (payload->>'record_date' is not null and (payload->>'record_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
      raise exception 'Dati della scheda non validi' using errcode = '22023';
    end if;
    if jsonb_array_length(new_lines) > 100
      or exists (select 1 from jsonb_each(new_fields) as field where jsonb_typeof(field.value) <> 'string')
      or exists (select 1 from jsonb_array_elements(new_lines) as line where jsonb_typeof(line.value) <> 'object') then
      raise exception 'Dati della scheda non validi' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(new_lines) as line
      cross join lateral jsonb_each(line.value) as field
      where jsonb_typeof(field.value) <> 'string'
    ) then
      raise exception 'Dati della scheda non validi' using errcode = '22023';
    end if;
    new_site := (payload->>'site_id')::uuid;
    new_date := (payload->>'record_date')::date;

    if not (new_status = any(case record_kind
      when 'article' then array['active', 'inactive']
      when 'movement' then array['recorded']
      when 'employee' then array['active', 'on_leave', 'inactive']
      when 'worker' then array['active', 'on_leave', 'inactive']
      when 'crew' then array['available', 'engaged', 'unavailable']
      when 'invoice' then array['draft', 'open', 'paid']
      when 'order' then array['draft', 'sent', 'confirmed', 'delivered', 'cancelled']
      when 'ddt' then array['draft', 'in_transit', 'delivered', 'cancelled']
      when 'estimate' then array['draft', 'review', 'approved']
    end))
      or (record_kind = 'estimate' and new_site is null)
      or (record_kind = 'article' and new_site is not null)
      or (record_kind in ('movement', 'invoice', 'order', 'ddt', 'estimate') and new_date is null)
      or (record_kind in ('invoice', 'order', 'ddt', 'estimate') and jsonb_array_length(new_lines) = 0) then
      raise exception 'Dati della scheda non validi' using errcode = '22023';
    end if;

    if record_kind = 'movement' then
      movement_quantity := new_fields->>'quantity';
      if coalesce(new_fields->>'direction', '') not in ('in', 'out')
        or movement_quantity is null or movement_quantity !~ '^[0-9]{1,9}([.][0-9]{1,3})?$'
        or new_fields->>'article_id' is null then
        raise exception 'Dati del movimento non validi' using errcode = '22023';
      end if;
      if movement_quantity::numeric <= 0 then
        raise exception 'La quantità deve essere positiva' using errcode = '22023';
      end if;
      next_article := (new_fields->>'article_id')::uuid::text;
      new_fields := jsonb_set(new_fields, '{article_id}', to_jsonb(next_article));
    end if;
  elsif operation = 'restore' and record_kind = 'movement' then
    next_article := prior_article;
  end if;

  if next_article is not null and not exists (
    select 1 from public.operation_records
    where organization_id = org and kind = 'article' and id = next_article::uuid and not archived
  ) then
    raise exception 'Articolo non disponibile' using errcode = 'P0002';
  end if;

  if operation = 'archive' and record_kind = 'article' and exists (
    select 1 from public.operation_records
    where organization_id = org and kind = 'movement' and not archived and fields->>'article_id' = target::text
  ) then
    raise exception 'Articolo con movimenti attivi' using errcode = 'P0001';
  end if;

  if operation = 'save' then
    insert into public.operation_records (id, organization_id, kind, site_id, title, status, record_date, fields, lines)
    values (target, org, record_kind, new_site, new_title, new_status, new_date, new_fields, new_lines)
    on conflict (id) do update set site_id = excluded.site_id, title = excluded.title, status = excluded.status,
      record_date = excluded.record_date, fields = excluded.fields, lines = excluded.lines, updated_at = now()
      where operation_records.organization_id = org and operation_records.kind = record_kind and not operation_records.archived;
    if not found then raise exception 'Scheda non disponibile' using errcode = 'P0002'; end if;
  else
    update public.operation_records set archived = (operation = 'archive'), updated_at = now()
      where id = target and organization_id = org and kind = record_kind and archived <> (operation = 'archive');
  end if;

  if record_kind = 'movement' and exists (
    select 1 from public.operation_records
    where organization_id = org and kind = 'movement' and not archived
      and (fields->>'article_id' = prior_article or fields->>'article_id' = next_article)
    group by fields->>'article_id'
    having sum(case when fields->>'direction' = 'in' then (fields->>'quantity')::numeric else -(fields->>'quantity')::numeric end) < 0
  ) then
    raise exception 'Stock insufficiente' using errcode = 'P0001';
  end if;
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Dati della scheda non validi' using errcode = '22023';
end;
$$;

revoke all on function public.imprelio_operation_write(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.imprelio_operation_write(uuid, jsonb) to authenticated;
