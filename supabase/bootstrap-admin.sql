-- Eseguire dal SQL Editor del progetto dopo aver creato l'utente in Supabase Auth.
do $$
declare
  admin_email constant text := 'amministratore@example.com';
  company_name constant text := 'Imprelio';
  admin_user auth.users%rowtype;
  company_id uuid;
begin
  if split_part(admin_email, '@', 2) = 'example.com' then
    raise exception 'Imposta l’email del primo amministratore.';
  end if;

  if to_regclass('public.organizations') is null
    or to_regclass('public.organization_members') is null then
    raise exception 'Migrazione Imprelio mancante. Esegui prima supabase/migrations/202611180001_cantieri.sql.';
  end if;

  select * into strict admin_user
  from auth.users
  where lower(email) = lower(btrim(admin_email))
    and email_confirmed_at is not null;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('imprelio:bootstrap-admin', 0));

  select id into company_id from public.organizations where name = company_name;
  if found then
    if (select count(*) from public.organizations where name = company_name) = 1
      and exists (
        select 1 from public.organization_members
        where organization_id = company_id and user_id = admin_user.id and role = 'admin' and active
      ) then
      return;
    end if;
    raise exception 'Esiste già un’azienda con questo nome. Verifica gli accessi esistenti.';
  end if;

  insert into public.organizations (name) values (company_name) returning id into company_id;
  insert into public.organization_members (organization_id, user_id, email, role)
    values (company_id, admin_user.id, lower(admin_user.email), 'admin');
end $$;
