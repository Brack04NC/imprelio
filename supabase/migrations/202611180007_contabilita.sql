create table public.financial_accounts (
  id uuid not null,
  organization_id uuid not null references public.organizations on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120 and name ~ '[^[:space:]]'),
  opening_date date not null,
  opening_cents bigint not null check (opening_cents between -999999999999 and 999999999999),
  updated_at timestamptz not null default now(),
  primary key (organization_id, id)
);

create table public.financial_entries (
  id uuid not null,
  organization_id uuid not null references public.organizations on delete cascade,
  account_id uuid not null,
  site_id uuid,
  record_date date not null,
  description text not null check (length(btrim(description)) between 1 and 250 and description ~ '[^[:space:]]'),
  direction text not null check (direction in ('in', 'out')),
  amount_cents bigint not null check (amount_cents between 1 and 999999999999),
  reference text not null check (length(reference) <= 100),
  voided boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (organization_id, id),
  foreign key (organization_id, account_id) references public.financial_accounts (organization_id, id),
  foreign key (organization_id, site_id) references public.sites (organization_id, id)
);

create unique index financial_accounts_name on public.financial_accounts (organization_id, lower(name));
create index financial_entries_date on public.financial_entries (organization_id, record_date desc, id);
create index financial_entries_account on public.financial_entries (organization_id, account_id, record_date);
create index financial_entries_site on public.financial_entries (organization_id, site_id, record_date) where site_id is not null;

alter table public.financial_accounts enable row level security;
alter table public.financial_entries enable row level security;
create policy financial_accounts_read on public.financial_accounts for select to authenticated
  using (imprelio_private.has_access(organization_id));
create policy financial_entries_read on public.financial_entries for select to authenticated
  using (imprelio_private.has_access(organization_id));
revoke all on public.financial_accounts, public.financial_entries from public, anon, authenticated;
grant select on public.financial_accounts, public.financial_entries to authenticated;

create function public.imprelio_finance_write(org uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  operation text := payload->>'action';
  target uuid;
  account uuid;
  site uuid;
  account_name text;
  opening_day date;
  entry_day date;
  entry_description text;
  entry_direction text;
  entry_reference text;
  cents bigint;
  saved_account public.financial_accounts%rowtype;
  saved_entry public.financial_entries%rowtype;
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text) > 8192
    or coalesce(operation, '') not in ('save_account', 'save_entry', 'void_entry')
    or jsonb_typeof(payload->'id') is distinct from 'string' then
    raise exception 'Dati contabili non validi' using errcode = '22023';
  end if;
  target := (payload->>'id')::uuid;

  -- Serialize changes to opening dates and entries for the same organization.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('imprelio:finance:' || org::text, 0));

  if operation = 'save_account' then
    account_name := btrim(payload->>'name');
    if jsonb_typeof(payload->'name') is distinct from 'string' or length(account_name) not between 1 and 120
      or account_name !~ '[^[:space:]]' or jsonb_typeof(payload->'opening_date') is distinct from 'string'
      or (payload->>'opening_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(jsonb_typeof(payload->'opening_cents'), '') not in ('string', 'number')
      or (payload->>'opening_cents') !~ '^-?[0-9]{1,12}$' then
      raise exception 'Dati del conto non validi' using errcode = '22023';
    end if;
    opening_day := (payload->>'opening_date')::date;
    cents := (payload->>'opening_cents')::bigint;
    if exists (
      select 1 from public.financial_entries
      where organization_id = org and account_id = target and not voided and record_date < opening_day
    ) then
      raise exception 'La data di apertura è successiva a un movimento del conto' using errcode = '22023';
    end if;

    insert into public.financial_accounts as current_account (id, organization_id, name, opening_date, opening_cents)
    values (target, org, account_name, opening_day, cents)
    on conflict (organization_id, id) do update
      set name = excluded.name, opening_date = excluded.opening_date, opening_cents = excluded.opening_cents, updated_at = now()
      where (current_account.name, current_account.opening_date, current_account.opening_cents)
        is distinct from (excluded.name, excluded.opening_date, excluded.opening_cents)
    returning * into saved_account;
    if not found then
      select * into saved_account from public.financial_accounts where organization_id = org and id = target;
    end if;
    return to_jsonb(saved_account) || jsonb_build_object('opening_cents', saved_account.opening_cents::text);
  end if;

  if operation = 'save_entry' then
    entry_description := btrim(payload->>'description');
    entry_direction := payload->>'direction';
    entry_reference := btrim(coalesce(payload->>'reference', ''));
    if jsonb_typeof(payload->'account_id') is distinct from 'string'
      or coalesce(jsonb_typeof(payload->'site_id'), 'null') not in ('null', 'string')
      or jsonb_typeof(payload->'record_date') is distinct from 'string'
      or (payload->>'record_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(payload->'description') is distinct from 'string' or length(entry_description) not between 1 and 250
      or entry_description !~ '[^[:space:]]' or coalesce(entry_direction, '') not in ('in', 'out')
      or coalesce(jsonb_typeof(payload->'amount_cents'), '') not in ('string', 'number')
      or (payload->>'amount_cents') !~ '^[0-9]{1,12}$'
      or coalesce(jsonb_typeof(payload->'reference'), 'null') not in ('null', 'string')
      or length(entry_reference) > 100 then
      raise exception 'Dati del movimento non validi' using errcode = '22023';
    end if;
    account := (payload->>'account_id')::uuid;
    site := (payload->>'site_id')::uuid;
    entry_day := (payload->>'record_date')::date;
    cents := (payload->>'amount_cents')::bigint;
    if cents <= 0 then
      raise exception 'L’importo deve essere positivo' using errcode = '22023';
    end if;

    if exists (select 1 from public.financial_entries where organization_id = org and id = target and voided) then
      raise exception 'Il movimento è stato annullato' using errcode = 'P0002';
    end if;
    select opening_date into opening_day from public.financial_accounts where organization_id = org and id = account;
    if not found then
      raise exception 'Conto non disponibile' using errcode = 'P0002';
    end if;
    if entry_day < opening_day then
      raise exception 'Il movimento precede la data di apertura del conto' using errcode = '22023';
    end if;

    insert into public.financial_entries as current_entry (
      id, organization_id, account_id, site_id, record_date, description, direction, amount_cents, reference
    )
    values (target, org, account, site, entry_day, entry_description, entry_direction, cents, entry_reference)
    on conflict (organization_id, id) do update
      set account_id = excluded.account_id, site_id = excluded.site_id, record_date = excluded.record_date,
        description = excluded.description, direction = excluded.direction, amount_cents = excluded.amount_cents,
        reference = excluded.reference, updated_at = now()
      where not current_entry.voided
        and (current_entry.account_id, current_entry.site_id, current_entry.record_date,
          current_entry.description, current_entry.direction, current_entry.amount_cents, current_entry.reference)
        is distinct from (excluded.account_id, excluded.site_id, excluded.record_date,
          excluded.description, excluded.direction, excluded.amount_cents, excluded.reference)
    returning * into saved_entry;
    if not found then
      select * into saved_entry from public.financial_entries where organization_id = org and id = target;
    end if;
  else
    update public.financial_entries set voided = true, updated_at = now()
    where organization_id = org and id = target and not voided
    returning * into saved_entry;
    if not found then
      select * into saved_entry from public.financial_entries where organization_id = org and id = target;
      if not found then
        raise exception 'Movimento non disponibile' using errcode = 'P0002';
      end if;
    end if;
  end if;

  return to_jsonb(saved_entry) || jsonb_build_object('amount_cents', saved_entry.amount_cents::text);
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Dati contabili non validi' using errcode = '22023';
end;
$$;

revoke all on function public.imprelio_finance_write(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.imprelio_finance_write(uuid, jsonb) to authenticated;
