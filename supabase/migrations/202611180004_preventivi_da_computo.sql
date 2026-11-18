create table public.estimate_rates (
  organization_id uuid not null references public.organizations on delete cascade,
  id uuid not null,
  label text not null check (length(btrim(label)) between 1 and 120),
  code text not null check (length(code) <= 80),
  phrase text not null check (length(phrase) <= 200),
  unit text not null check (length(btrim(unit)) between 1 and 40),
  kind text not null check (kind in ('standard', 'rental', 'extension')),
  months smallint,
  price text not null check (price ~ '^[0-9]{1,9}([.][0-9]{1,2})?$'),
  primary key (organization_id, id),
  check (length(btrim(code)) > 0 or length(btrim(phrase)) > 0),
  check ((kind = 'rental' and months is not null and months between 1 and 120)
    or (kind <> 'rental' and months is null))
);

create function imprelio_private.valid_estimate_quote_lines(lines jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(lines) <> 'array' then false else
    jsonb_array_length(lines) between 1 and 350 and octet_length(lines::text) <= 2097152 and not exists (
      select 1 from jsonb_array_elements(lines) as e(line)
      where jsonb_typeof(line) <> 'object'
        or jsonb_typeof(line->'reference') is distinct from 'string'
        or jsonb_typeof(line->'code') is distinct from 'string'
        or jsonb_typeof(line->'title') is distinct from 'string'
        or jsonb_typeof(line->'description') is distinct from 'string'
        or jsonb_typeof(line->'page') is distinct from 'number'
        or coalesce(line->>'page', '') !~ '^[1-9][0-9]?$|^100$'
        or jsonb_typeof(line->'unit') is distinct from 'string'
        or jsonb_typeof(line->'quantity') is distinct from 'string'
        or jsonb_typeof(line->'price') is distinct from 'string'
        or jsonb_typeof(line->'sourcePrice') is distinct from 'string'
        or jsonb_typeof(line->'sourceTotal') is distinct from 'string'
        or length(line->>'reference') > 40 or length(line->>'code') > 80
        or length(btrim(line->>'title')) not between 1 and 300
        or length(line->>'description') > 4000 or length(btrim(line->>'unit')) not between 1 and 40
        or coalesce(line->>'sourcePrice', '') !~ '^([0-9]{1,9}([.][0-9]{1,3})?)?$'
        or coalesce(line->>'sourceTotal', '') !~ '^([0-9]{1,9}([.][0-9]{1,3})?)?$'
        or case when line->>'quantity' ~ '^[0-9]{1,9}([.][0-9]{1,3})?$'
          then (line->>'quantity')::numeric <= 0 else true end
        or coalesce(line->>'price', '') !~ '^[0-9]{1,9}([.][0-9]{1,2})?$'
    ) end;
$$;

create table public.estimate_quotes (
  organization_id uuid not null references public.organizations on delete cascade,
  id uuid not null,
  site_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 160),
  source_name text not null check (length(btrim(source_name)) between 1 and 250),
  lines jsonb not null check (imprelio_private.valid_estimate_quote_lines(lines)),
  created_at timestamptz not null default now(),
  primary key (organization_id, id),
  foreign key (organization_id, site_id) references public.sites (organization_id, id)
);

create index estimate_quotes_org_date on public.estimate_quotes (organization_id, created_at desc, id);
create index estimate_quotes_org_site on public.estimate_quotes (organization_id, site_id);

create function imprelio_private.keep_estimate_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.organization_id is distinct from new.organization_id or old.id is distinct from new.id then
    raise exception 'Azienda e identificativo della scheda non possono cambiare' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function imprelio_private.keep_estimate_identity() from public, anon;
create trigger estimate_rates_keep_identity before update of organization_id, id on public.estimate_rates
  for each row execute function imprelio_private.keep_estimate_identity();
create trigger estimate_quotes_keep_identity before update of organization_id, id on public.estimate_quotes
  for each row execute function imprelio_private.keep_estimate_identity();

alter table public.estimate_rates enable row level security;
alter table public.estimate_quotes enable row level security;

create policy estimate_rates_access on public.estimate_rates for all to authenticated
  using (imprelio_private.has_access(organization_id)) with check (imprelio_private.has_access(organization_id));
create policy estimate_quotes_access on public.estimate_quotes for all to authenticated
  using (imprelio_private.has_access(organization_id)) with check (imprelio_private.has_access(organization_id));

revoke all on public.estimate_rates, public.estimate_quotes from public, anon, authenticated;
grant select on public.estimate_rates, public.estimate_quotes to authenticated;
grant insert (organization_id,id,label,code,phrase,unit,kind,months,price),
  update (label,code,phrase,unit,kind,months,price,organization_id,id) on public.estimate_rates to authenticated;
grant delete on public.estimate_rates to authenticated;
grant insert (organization_id,id,site_id,title,source_name,lines),
  update (organization_id,id,site_id,title,source_name,lines) on public.estimate_quotes to authenticated;
revoke all on function imprelio_private.valid_estimate_quote_lines(jsonb) from public, anon;
grant execute on function imprelio_private.valid_estimate_quote_lines(jsonb) to authenticated;
