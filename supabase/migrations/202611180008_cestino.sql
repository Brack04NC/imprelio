create table imprelio_private.trashed_records (
  organization_id uuid not null references public.organizations on delete cascade,
  entity text not null check (entity in ('intervention', 'quote')),
  id uuid not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  deleted_at timestamptz not null default now(),
  primary key (organization_id, entity, id)
);

revoke all on imprelio_private.trashed_records from public, anon, authenticated;

create function imprelio_private.prevent_trashed_record_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  entity_kind text := tg_argv[0];
begin
  -- Existing save paths use upserts. Keep a stale save from recreating a deleted row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('imprelio:trash:' || entity_kind || ':' || new.id::text, 0));
  if exists (
    select 1 from imprelio_private.trashed_records as archived
    where archived.organization_id = new.organization_id and archived.entity = entity_kind and archived.id = new.id
  ) then
    raise exception 'La scheda è stata eliminata' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

revoke all on function imprelio_private.prevent_trashed_record_insert() from public, anon, authenticated;

create trigger interventions_prevent_trashed_insert before insert on public.interventions
  for each row execute function imprelio_private.prevent_trashed_record_insert('intervention');
create trigger estimate_quotes_prevent_trashed_insert before insert on public.estimate_quotes
  for each row execute function imprelio_private.prevent_trashed_record_insert('quote');

create function public.imprelio_trash_write(org uuid, entity text, target uuid, operation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entity_kind text := entity;
  original jsonb;
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;
  if target is null or coalesce(entity_kind, '') not in ('intervention', 'quote')
    or coalesce(operation, '') not in ('delete', 'restore') then
    raise exception 'Operazione non valida' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('imprelio:trash:' || entity_kind || ':' || target::text, 0));

  if operation = 'delete' then
    if entity_kind = 'intervention' then
      delete from public.interventions as record
        where record.organization_id = org and record.id = target
        returning to_jsonb(record) into original;
    else
      delete from public.estimate_quotes as record
        where record.organization_id = org and record.id = target
        returning to_jsonb(record) into original;
    end if;
    if found then
      insert into imprelio_private.trashed_records (organization_id, entity, id, snapshot)
        values (org, entity_kind, target, original);
    elsif not exists (
      select 1 from imprelio_private.trashed_records as archived
      where archived.organization_id = org and archived.entity = entity_kind and archived.id = target
    ) then
      raise exception 'Scheda non disponibile' using errcode = 'P0002';
    end if;
  else
    -- If reinsertion fails, PostgreSQL rolls back the removal of the snapshot.
    delete from imprelio_private.trashed_records as archived
      where archived.organization_id = org and archived.entity = entity_kind and archived.id = target
      returning archived.snapshot into original;
    if not found then
      -- A retry can follow a committed restore whose response never arrived.
      if (entity_kind = 'intervention' and exists (select 1 from public.interventions where organization_id = org and id = target))
        or (entity_kind = 'quote' and exists (select 1 from public.estimate_quotes where organization_id = org and id = target)) then
        return jsonb_build_object('id', target);
      end if;
      raise exception 'Scheda non disponibile per il ripristino' using errcode = 'P0002';
    end if;

    if entity_kind = 'intervention' then
      insert into public.interventions select saved.* from jsonb_populate_record(null::public.interventions, original) as saved;
    else
      insert into public.estimate_quotes select saved.* from jsonb_populate_record(null::public.estimate_quotes, original) as saved;
    end if;
  end if;

  return jsonb_build_object('id', target);
end;
$$;

revoke all on function public.imprelio_trash_write(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.imprelio_trash_write(uuid, text, uuid, text) to authenticated;
