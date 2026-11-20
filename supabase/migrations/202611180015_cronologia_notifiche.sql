create table public.notification_history (
  organization_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  key text not null check (length(key) between 1 and 240),
  item jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (organization_id, user_id, key),
  check (
    jsonb_typeof(item) = 'object'
    and item ?& array['id','category','priority','title','detail','status','date','href','actionLabel']
    and item - array['id','category','priority','title','detail','status','date','href','actionLabel'] = '{}'::jsonb
    and jsonb_typeof(item->'id') = 'string' and length(item->>'id') between 1 and 180
    and jsonb_typeof(item->'category') = 'string' and item->>'category' in ('agenda','deadlines','estimates','workers','vehicles')
    and jsonb_typeof(item->'priority') = 'string' and item->>'priority' in ('urgent','soon','info')
    and jsonb_typeof(item->'title') = 'string' and length(item->>'title') between 1 and 300
    and jsonb_typeof(item->'detail') = 'string' and length(item->>'detail') <= 350
    and jsonb_typeof(item->'status') = 'string' and length(item->>'status') between 1 and 80
    and jsonb_typeof(item->'actionLabel') = 'string' and length(item->>'actionLabel') between 1 and 100
    and (item->'date' = 'null'::jsonb or (
      jsonb_typeof(item->'date') = 'string'
      and item->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and (item->>'date')::date >= '0001-01-01'::date
    ))
    and jsonb_typeof(item->'href') = 'string' and length(item->>'href') <= 300
    and item->>'href' ~ '^/(agenda|gestione/(amministrazione|computi-metrici|preventivi-computo|magazzino|operai/[0-9a-f-]{36}/scadenze))([?][a-zA-Z0-9_=&%-]+)?(#archivio-pdf)?$'
  )
);

create index notification_history_timeline on public.notification_history (organization_id, user_id, recorded_at desc, key);
alter table public.notification_history enable row level security;
create policy notification_history_read on public.notification_history for select to authenticated
  using (user_id = (select auth.uid()) and imprelio_private.has_access(organization_id));
revoke all on public.notification_history from public, anon, authenticated;
grant select on public.notification_history to authenticated;

create function public.imprelio_record_notifications(org uuid, reminders jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;
  if jsonb_typeof(reminders) is distinct from 'array' or octet_length(reminders::text) > 300000 then
    raise exception 'Avvisi non validi' using errcode = '22023';
  end if;
  if jsonb_array_length(reminders) > 200 then
    raise exception 'Troppi avvisi' using errcode = '22023';
  end if;
  insert into public.notification_history as saved (organization_id, user_id, key, item)
    select org, actor, row.key, row.item
    from jsonb_to_recordset(reminders) as row(key text, item jsonb)
    order by row.key
    on conflict (organization_id, user_id, key) do update set item = excluded.item
    where saved.item is distinct from excluded.item;
end;
$$;
revoke all on function public.imprelio_record_notifications(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.imprelio_record_notifications(uuid, jsonb) to authenticated;
