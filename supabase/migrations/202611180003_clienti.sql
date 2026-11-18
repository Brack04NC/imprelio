alter table public.clients
  add column contact_name text not null default '' check (length(contact_name) <= 140),
  add column email text not null default '' check (
    length(email) <= 254 and (email = '' or email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
  ),
  add column phone text not null default '' check (length(phone) <= 50),
  add column address text not null default '' check (length(address) <= 200),
  add column notes text not null default '' check (length(notes) <= 2000);

create index sites_org_client on public.sites (organization_id, client_id, number desc);

create function imprelio_private.require_site_client()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.client_id is null and (TG_OP = 'INSERT' or old.client_id is not null) then
    raise exception 'Seleziona un cliente per il cantiere.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function imprelio_private.require_site_client() from public;

create trigger sites_require_client
before insert or update of client_id on public.sites
for each row execute function imprelio_private.require_site_client();

create function public.imprelio_client_directory(org uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id, 'name', c.name, 'contact_name', c.contact_name, 'email', c.email,
      'phone', c.phone, 'address', c.address, 'notes', c.notes, 'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'city', s.city, 'address', s.address, 'status', s.status,
        'code', 'CAN-' || lpad(s.number::text, greatest(3, length(s.number::text)), '0')
      ) order by s.number desc)
      from public.sites s where s.organization_id = c.organization_id and s.client_id = c.id
    ), '[]')) order by lower(c.name), c.id
  ), '[]')
  from public.clients c where c.organization_id = org;
$$;

create function public.imprelio_client_write(org uuid, payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso riservato.' using errcode = '42501';
  end if;

  insert into public.clients (id, organization_id, name, contact_name, email, phone, address, notes)
  values (
    (payload->>'id')::uuid,
    org,
    btrim(payload->>'name'),
    btrim(coalesce(payload->>'contact_name', '')),
    lower(btrim(coalesce(payload->>'email', ''))),
    btrim(coalesce(payload->>'phone', '')),
    btrim(coalesce(payload->>'address', '')),
    btrim(coalesce(payload->>'notes', ''))
  )
  on conflict (id) do update set
    name = excluded.name, contact_name = excluded.contact_name, email = excluded.email,
    phone = excluded.phone, address = excluded.address, notes = excluded.notes
  where clients.organization_id = org;

  if not found then
    raise exception 'Cliente non disponibile.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.imprelio_client_directory(uuid), public.imprelio_client_write(uuid, jsonb) from public, anon;
grant execute on function public.imprelio_client_directory(uuid), public.imprelio_client_write(uuid, jsonb) to authenticated;
