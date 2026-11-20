import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('Eliminazione e ripristino mantengono schede, azienda e PDF coerenti', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    create schema storage;
    create table storage.buckets (
      id text primary key, name text not null, public boolean, file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      bucket_id text not null references storage.buckets, name text not null, metadata jsonb, primary key (bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select, insert on storage.objects to authenticated;
  `);
  for (const migration of [
    '202611180001_cantieri.sql',
    '202611180004_preventivi_da_computo.sql',
    '202611180006_archivio_computi_pdf.sql',
    '202611180008_cestino.sql',
  ]) {
    await db.exec(await readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
  }

  const [org, otherOrg, user, otherUser, inactiveUser, site, otherSite, job, quote, file] = Array.from({ length: 10 }, randomUUID);
  await db.query("insert into public.organizations values ($1,'Prima'), ($2,'Seconda')", [org, otherOrg]);
  await db.query("insert into auth.users values ($1,'coordinatore@example.test',now()), ($2,'altra@example.test',now()), ($3,'inattivo@example.test',now())", [user, otherUser, inactiveUser]);
  await db.query(`
    insert into public.organization_members values
      ($1,$2,'coordinatore@example.test','coordinator',true),
      ($3,$4,'altra@example.test','admin',true),
      ($1,$5,'inattivo@example.test','coordinator',false)
  `, [org, user, otherOrg, otherUser, inactiveUser]);
  await db.query(`
    insert into public.sites (organization_id, id, name, city, status) values
      ($1,$2,'Prima commessa','Roma','active'), ($3,$4,'Riservata','Milano','active')
  `, [org, site, otherOrg, otherSite]);

  const signIn = async id => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  };
  const trash = async (company, kind, id, operation) => (
    await db.query('select public.imprelio_trash_write($1,$2,$3,$4) as record', [company, kind, id, operation])
  ).rows[0].record;
  const writeJob = (company, worksite) => db.query('select public.imprelio_write($1,$2)', [company, JSON.stringify({
    action: 'job', id: job, site_id: worksite, kind: 'assembly', zone: 'Facciata',
    due_date: '2026-11-21', time: '08:30', notes: 'Nota originale', status: 'progress',
  })]);
  const lines = [{
    reference: '01', code: 'P.01', title: 'Montaggio ponteggio', description: 'Descrizione originale',
    page: 1, unit: 'm²', quantity: '45.25', price: '10.08', sourcePrice: '10', sourceTotal: '452.5',
  }];
  const writeQuote = (company, worksite) => db.query(`
    insert into public.estimate_quotes (organization_id,id,site_id,title,source_name,lines)
    values ($1,$2,$3,'Preventivo originale','Computo originale.pdf',$4)
    on conflict (organization_id,id) do update set title = excluded.title, lines = excluded.lines
  `, [company, quote, worksite, JSON.stringify(lines)]);
  const read = async (table, id) => (await db.query('select to_jsonb(t) as record from public.' + table + ' t where id=$1', [id])).rows.map(row => row.record);

  await signIn(user);
  await writeJob(org, site);
  await writeQuote(org, site);
  const savedJob = await read('interventions', job);
  const savedQuote = await read('estimate_quotes', quote);
  const key = org + '/' + file + '.pdf';
  await db.query("select public.imprelio_prepare_estimate_pdf($1,$2,$3,'Computo originale.pdf', 37)", [org, site, file]);
  await db.query("insert into storage.objects values ('estimate-source-pdfs',$1,$2)", [key, JSON.stringify({
    size: 37, mimetype: 'application/pdf',
  })]);
  await db.query('select public.imprelio_finish_estimate_pdf($1,$2)', [org, file]);

  await assert.rejects(db.query('delete from public.interventions where id = $1', [job]), { code: '42501' });
  await assert.rejects(db.query('delete from public.estimate_quotes where id = $1', [quote]), { code: '42501' });
  await assert.rejects(trash(org, 'site', site, 'delete'), { code: '22023' });
  await assert.rejects(trash(org, 'quote', quote, 'erase'), { code: '22023' });
  await assert.rejects(trash(org, 'quote', null, 'delete'), { code: '22023' });
  await assert.rejects(trash(org, 'quote', randomUUID(), 'restore'), { code: 'P0002' });

  await signIn(otherUser);
  await writeQuote(otherOrg, otherSite);
  await assert.rejects(trash(org, 'quote', quote, 'delete'), { code: '42501' });
  await assert.rejects(trash(otherOrg, 'intervention', job, 'delete'), { code: 'P0002' });
  await signIn(inactiveUser);
  await assert.rejects(trash(org, 'intervention', job, 'delete'), { code: '42501' });
  await signIn(user);

  assert.deepEqual(await trash(org, 'intervention', job, 'delete'), { id: job });
  assert.deepEqual(await trash(org, 'quote', quote, 'delete'), { id: quote });
  assert.deepEqual(await read('interventions', job), []);
  assert.deepEqual(await read('estimate_quotes', quote), []);
  assert.deepEqual((await db.query('select name from storage.objects')).rows, [{ name: key }]);
  assert.equal((await read('estimate_pdf_files', file)).length, 1);
  await assert.rejects(db.query('select * from imprelio_private.trashed_records'), { code: '42501' });
  await assert.rejects(writeJob(org, site), { code: 'P0002' });
  await assert.rejects(writeQuote(org, site), { code: 'P0002' });
  assert.deepEqual(await trash(org, 'intervention', job, 'delete'), { id: job });

  await signIn(otherUser);
  assert.equal((await read('estimate_quotes', quote)).length, 1);
  await assert.rejects(trash(otherOrg, 'intervention', job, 'restore'), { code: 'P0002' });
  await writeJob(otherOrg, otherSite);
  await signIn(user);
  await assert.rejects(trash(org, 'intervention', job, 'restore'), { code: '23505' });
  await assert.rejects(writeJob(org, site), { code: 'P0002' });
  await signIn(otherUser);
  await trash(otherOrg, 'intervention', job, 'delete');

  await signIn(user);
  assert.deepEqual(await trash(org, 'intervention', job, 'restore'), { id: job });
  assert.deepEqual(await trash(org, 'quote', quote, 'restore'), { id: quote });
  assert.deepEqual(await trash(org, 'quote', quote, 'restore'), { id: quote });
  assert.deepEqual(await read('interventions', job), savedJob);
  assert.deepEqual(await read('estimate_quotes', quote), savedQuote);
  await writeJob(org, site);
  await writeQuote(org, site);
  await db.exec('set role anon');
  await assert.rejects(trash(org, 'intervention', job, 'delete'), { code: '42501' });
});
