-- Quote sources can predate the archive filename format. Match the normalization
-- in estimatePdfFileName, including the limit in UTF-16 code units.
create function imprelio_private.normalized_estimate_pdf_name(source_name text)
returns text language sql immutable strict set search_path = '' as $$
  with cleaned as (
    select regexp_replace(regexp_replace(source_name, '[.]pdf$', '', 'i'), E'[\\x01-\\x1f\\x7f/\\\\]', ' ', 'g') as stem,
      coalesce(substring(source_name from '(?i)[.]pdf$'), '.pdf') as extension,
      U&' \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF' as spaces
  ), parts as (
    select btrim(stem, spaces) as stem, extension, spaces
    from cleaned
  )
  select coalesce(nullif(btrim(
    case when octet_length(stem) <= 246 then stem else left(stem, (
      select count(*)::integer from (
        select sum(case when ascii(character.value) > 65535 then 2 else 1 end)
          over (order by character.position) as units
        from string_to_table(parts.stem, null) with ordinality as character(value, position)
      ) as sizes
      where sizes.units <= 246
    )) end, spaces
  ), ''), 'Computo') || extension
  from parts;
$$;

revoke all on function imprelio_private.normalized_estimate_pdf_name(text) from public, anon, authenticated;

create function public.imprelio_pending_estimate_pdfs(org uuid)
returns table (id uuid, site_id uuid, file_name text, uploaded_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not imprelio_private.has_access(org) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;

  return query
    -- A quote and its source PDF have independent IDs. Treat the source as handled
    -- when any active or deleted quote has the same filename in the same site.
    with handled_sources as (
      select quote.site_id::text as site, imprelio_private.normalized_estimate_pdf_name(quote.source_name) as name
      from public.estimate_quotes as quote
      where quote.organization_id = org
      union all
      select archived.snapshot->>'site_id', imprelio_private.normalized_estimate_pdf_name(archived.snapshot->>'source_name')
      from imprelio_private.trashed_records as archived
      where archived.organization_id = org and archived.entity = 'quote'
    )
    select file.id, file.site_id, file.file_name, file.uploaded_at
    from public.estimate_pdf_files as file
    where file.organization_id = org and file.uploaded_at is not null
      and not exists (
        select 1 from handled_sources as handled
        where handled.site = file.site_id::text and handled.name = file.file_name
      )
    order by file.uploaded_at desc, file.id;
end;
$$;

revoke all on function public.imprelio_pending_estimate_pdfs(uuid) from public, anon, authenticated;
grant execute on function public.imprelio_pending_estimate_pdfs(uuid) to authenticated;
