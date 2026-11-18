create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 140)
);

create table public.organization_members (
  organization_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'coordinator')),
  active boolean not null default true,
  primary key (organization_id, user_id)
);

create table public.invitations (
  organization_id uuid not null references public.organizations on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  created_at timestamptz not null default now(),
  primary key (organization_id, email)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 140),
  unique (organization_id, id)
);
create unique index clients_org_name on public.clients (organization_id, lower(name));

create table public.sites (
  id uuid primary key,
  organization_id uuid not null references public.organizations on delete cascade,
  number bigint generated always as identity unique,
  name text not null check (length(btrim(name)) between 1 and 120),
  city text not null check (length(btrim(city)) between 1 and 100),
  address text not null default '' check (length(address) <= 200),
  manager text not null default '' check (length(manager) <= 100),
  status text not null check (status in ('active', 'planned', 'paused', 'closed')),
  client_id uuid,
  unique (organization_id, id),
  foreign key (organization_id, client_id) references public.clients (organization_id, id)
);
create index sites_org_number on public.sites (organization_id, number desc);

create table public.interventions (
  id uuid primary key,
  organization_id uuid not null,
  site_id uuid not null,
  kind text not null check (kind in ('survey', 'assembly', 'adjustment', 'dismantling', 'other')),
  zone text not null default '' check (length(zone) <= 120),
  due_date date not null,
  time time check (time < time '24:00'),
  notes text not null default '' check (length(notes) <= 2000),
  status text not null check (status in ('scheduled', 'progress', 'done')),
  foreign key (organization_id, site_id) references public.sites (organization_id, id) on delete cascade
);
create index interventions_agenda on public.interventions (organization_id, due_date, time);
create index interventions_site on public.interventions (organization_id, site_id, due_date, time);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.invitations enable row level security;
alter table public.clients enable row level security;
alter table public.sites enable row level security;
alter table public.interventions enable row level security;

create schema if not exists imprelio_private;
revoke all on schema imprelio_private from public;
grant usage on schema imprelio_private to authenticated;

create function imprelio_private.has_access(org uuid, admin_only boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = org and user_id = (select auth.uid()) and active
      and (not admin_only or role = 'admin')
  );
$$;
revoke all on function imprelio_private.has_access(uuid, boolean) from public;
grant execute on function imprelio_private.has_access(uuid, boolean) to authenticated;

create policy organizations_read on public.organizations for select to authenticated using (imprelio_private.has_access(id));
create policy members_read on public.organization_members for select to authenticated
  using ((active and user_id = (select auth.uid())) or imprelio_private.has_access(organization_id, true));
create policy invitations_read on public.invitations for select to authenticated using (imprelio_private.has_access(organization_id, true));
create policy clients_read on public.clients for select to authenticated using (imprelio_private.has_access(organization_id));
create policy sites_read on public.sites for select to authenticated using (imprelio_private.has_access(organization_id));
create policy interventions_read on public.interventions for select to authenticated using (imprelio_private.has_access(organization_id));

revoke all on public.organizations, public.organization_members, public.invitations, public.clients, public.sites, public.interventions from anon, authenticated;
grant select on public.organizations, public.organization_members, public.invitations, public.clients, public.sites, public.interventions to authenticated;

create function public.claim_imprelio_invitations()
returns void language plpgsql security definer set search_path = '' as $$
declare verified_email text;
begin
  select lower(u.email) into verified_email from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null;
  if verified_email is null then return; end if;
  with accepted as (
    delete from public.invitations where email = verified_email returning organization_id, email
  )
  insert into public.organization_members (organization_id, user_id, email, role)
    select organization_id, auth.uid(), email, 'coordinator' from accepted
    on conflict (organization_id, user_id) do nothing;
end;
$$;

create function public.imprelio_write(org uuid, payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare operation text := payload->>'action';
declare client uuid := nullif(payload->>'client_id', '')::uuid;
declare new_client text := nullif(btrim(payload->>'new_client'), '');
declare target uuid := nullif(payload->>'id', '')::uuid;
declare invited_email text := lower(btrim(payload->>'email'));
begin
  if not imprelio_private.has_access(org, operation in ('invite', 'member')) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  case operation
    when 'site' then
      if new_client is not null then
        insert into public.clients (organization_id, name) values (org, new_client)
          on conflict (organization_id, lower(name)) do update set name = clients.name
          returning id into client;
      end if;
      -- Serialize creation of a given ID so a retry updates the original row without consuming a code.
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target::text, 0));
      update public.sites set name = payload->>'name', city = payload->>'city', address = payload->>'address',
        manager = payload->>'manager', status = payload->>'status', client_id = client
        where id = target and organization_id = org;
      if not found then
        insert into public.sites (id, organization_id, name, city, address, manager, status, client_id)
          values (target, org, payload->>'name', payload->>'city', payload->>'address',
            payload->>'manager', payload->>'status', client);
      end if;
    when 'job' then
      insert into public.interventions (id, organization_id, site_id, kind, zone, due_date, time, notes, status)
        values (target, org, (payload->>'site_id')::uuid, payload->>'kind', payload->>'zone',
          (payload->>'due_date')::date, (payload->>'time')::time, payload->>'notes', payload->>'status')
        on conflict (id) do update set kind = excluded.kind, zone = excluded.zone, due_date = excluded.due_date,
          time = excluded.time, notes = excluded.notes, status = excluded.status
        where interventions.organization_id = org and interventions.site_id = excluded.site_id;
      if not found then raise exception 'Intervention unavailable' using errcode = 'P0002'; end if;
    when 'jobStatus' then
      update public.interventions set status = payload->>'status'
        where id = target and organization_id = org and site_id = (payload->>'site_id')::uuid;
      if not found then raise exception 'Intervention unavailable' using errcode = 'P0002'; end if;
    when 'invite' then
      if exists (select 1 from public.organization_members where organization_id = org and lower(email) = invited_email) then
        raise exception 'Already a member' using errcode = '23505';
      end if;
      insert into public.invitations (organization_id, email) values (org, invited_email) on conflict do nothing;
    when 'member' then
      update public.organization_members set active = (payload->>'active')::boolean
        where organization_id = org and user_id = target and role = 'coordinator';
      if not found then raise exception 'Member unavailable' using errcode = 'P0002'; end if;
    else
      raise exception 'Invalid operation' using errcode = '22023';
  end case;
end;
$$;

create function public.imprelio_workspace(org uuid, needle text, state text, requested_page integer, selected uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with dates as (
    select (current_timestamp at time zone 'Europe/Rome')::date as today
  ), sites_with_client as not materialized (
    select s.*, coalesce(c.name, '') as client, 'CAN-' || lpad(s.number::text, greatest(3, length(s.number::text)), '0') as code
    from public.sites s left join public.clients c on c.organization_id = s.organization_id and c.id = s.client_id
    where s.organization_id = org
  ), filtered as (
    select s.* from sites_with_client s
    where (state = 'all' or s.status = state)
      and (needle = '' or position(lower(needle) in lower(s.name)) > 0 or position(lower(needle) in lower(s.city)) > 0
        or position(lower(needle) in lower(s.client)) > 0 or position(lower(needle) in lower(s.code)) > 0)
  ), paging as (
    select count(*) as total, least(greatest(1, requested_page), greatest(1, ceil(count(*) / 6.0)::int)) as page from filtered
  ), page_rows as (
    select * from filtered order by number desc
    limit 6 offset ((select page from paging) - 1) * 6
  ), display_sites as (
    select * from page_rows union select * from sites_with_client where id = selected
  ), rows as (
    select s.id, s.number,
      to_jsonb(s) - 'number' - 'organization_id' || jsonb_build_object('nextJob', to_jsonb(j) - 'organization_id') as data
    from display_sites s left join lateral (
      select * from public.interventions
      where organization_id = org and site_id = s.id and status <> 'done'
      order by due_date, time nulls last, id limit 1
    ) j on true
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(r.data order by r.number desc) from rows r join page_rows p on p.id = r.id), '[]'),
    'clients', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
      from public.clients where organization_id = org), '[]'),
    'current', (select jsonb_build_object('site', data, 'jobs', coalesce((
      select jsonb_agg(to_jsonb(j) - 'organization_id' order by j.due_date, j.time nulls last, j.id)
      from public.interventions j where j.organization_id = org and j.site_id = selected), '[]'))
      from rows where id = selected),
    'agenda', coalesce((
      select jsonb_agg(to_jsonb(j) - 'organization_id' || jsonb_build_object('site', jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city))
        order by j.due_date, j.time nulls last, j.id)
      from public.interventions j join public.sites s on s.organization_id = j.organization_id and s.id = j.site_id
      where j.organization_id = org and j.due_date <= today + 7 and (j.due_date >= today or j.status <> 'done')
    ), '[]'),
    'counts', (
      select jsonb_build_object(
        'active', (select count(*) from public.sites where organization_id = org and status = 'active'),
        'today', count(*) filter (where due_date = today),
        'week', count(*) filter (where due_date > today and due_date <= today + 7),
        'overdue', count(*) filter (where due_date < today)
      ) from public.interventions where organization_id = org and status <> 'done' and due_date <= today + 7
    ),
    'total', total, 'page', page
  ) from dates cross join paging;
$$;

revoke all on function public.claim_imprelio_invitations(), public.imprelio_write(uuid, jsonb), public.imprelio_workspace(uuid, text, text, integer, uuid) from public, anon;
grant execute on function public.claim_imprelio_invitations(), public.imprelio_write(uuid, jsonb), public.imprelio_workspace(uuid, text, text, integer, uuid) to authenticated;
