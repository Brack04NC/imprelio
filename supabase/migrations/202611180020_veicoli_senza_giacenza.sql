create or replace function imprelio_private.check_vehicle_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- a_cestino_live_write acquisisce prima il lock dei movimenti per l'azienda.
  if new.kind = 'article' and new.fields->>'category' = 'vehicles' then
    if exists (
      select 1 from public.operation_records as movement
      where movement.organization_id = new.organization_id and movement.kind = 'movement' and not movement.archived
        and movement.fields->>'article_id' = new.id::text
    ) then
      raise exception 'Conversione in veicolo con movimenti attivi' using errcode = 'P0001';
    end if;

    new.fields := new.fields - array['unit', 'stock_min'];
    if tg_op = 'UPDATE' and old.fields->>'category' is distinct from 'vehicles' then
      -- I movimenti già nel Cestino tornano nella cronologia quando vengono recuperati.
      update imprelio_private.trashed_records as trash
        set snapshot = jsonb_set(trash.snapshot, '{archived}', 'true'::jsonb)
        from public.operation_records as movement
        where trash.organization_id = new.organization_id and trash.entity = 'operation'
          and movement.organization_id = trash.organization_id and movement.id = trash.id
          and movement.kind = 'movement' and movement.archived
          and movement.fields->>'article_id' = new.id::text and trash.snapshot->>'archived' = 'false';
    end if;
  elsif new.kind = 'movement' and not new.archived and exists (
    select 1 from public.operation_records as article
    where article.organization_id = new.organization_id and article.kind = 'article'
      and article.id = (new.fields->>'article_id')::uuid and article.fields->>'category' = 'vehicles'
  ) then
    raise exception 'I veicoli non hanno movimenti di magazzino' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function imprelio_private.check_vehicle_stock() from public, anon, authenticated;

do $$
declare
  warehouse uuid;
begin
  lock table public.operation_records in access exclusive mode;
  -- Una scrittura può avere acquisito il lock aziendale prima di raggiungere la tabella.
  for warehouse in select distinct organization_id from public.operation_records
    where kind = 'article' and fields->>'category' = 'vehicles' order by organization_id
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('imprelio:operations:' || warehouse::text, 0)) then
      raise exception 'Magazzino in aggiornamento. Riprova la migrazione.' using errcode = '55P03';
    end if;
  end loop;

  -- Il lock esclusivo tiene i trigger attivi per tutte le sessioni applicative.
  -- La pulizia deve raggiungere anche le righe conservate nel Cestino.
  alter table public.operation_records disable trigger a_cestino_live_write;

  -- Conserva date, quantità e riferimenti dei movimenti già registrati.
  update public.operation_records as movement set archived = true
    from public.operation_records as vehicle
    where movement.organization_id = vehicle.organization_id and movement.kind = 'movement' and not movement.archived
      and vehicle.kind = 'article' and vehicle.fields->>'category' = 'vehicles'
      and lower(movement.fields->>'article_id') = vehicle.id::text;

  update imprelio_private.trashed_records as trash
    set snapshot = jsonb_set(trash.snapshot, '{archived}', 'true'::jsonb)
    from public.operation_records as movement join public.operation_records as vehicle
      on vehicle.organization_id = movement.organization_id and lower(movement.fields->>'article_id') = vehicle.id::text
    where trash.organization_id = movement.organization_id and trash.entity = 'operation' and trash.id = movement.id
      and movement.kind = 'movement' and vehicle.kind = 'article' and vehicle.fields->>'category' = 'vehicles'
      and trash.snapshot->>'archived' = 'false';

  alter table public.operation_records disable trigger operation_records_vehicle_maintenance;
  update public.operation_records set fields = fields - array['unit', 'stock_min']
    where kind = 'article' and fields->>'category' = 'vehicles' and fields ?| array['unit', 'stock_min'];
  alter table public.operation_records enable trigger operation_records_vehicle_maintenance;
  alter table public.operation_records enable trigger a_cestino_live_write;

  alter table public.operation_records add constraint operation_records_vehicle_has_no_stock
    check (kind <> 'article' or fields->>'category' is distinct from 'vehicles' or not (fields ?| array['unit', 'stock_min']));

  create trigger operation_records_vehicle_stock_guard
    before insert or update on public.operation_records for each row
    when (new.kind in ('article', 'movement'))
    execute function imprelio_private.check_vehicle_stock();
end;
$$;
