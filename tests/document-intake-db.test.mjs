import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

test('L’archivio documenti collega metadati e originali privati senza duplicare i PDF dei computi', async t => {
  const db = new PGlite({ extensions: { btree_gist } });
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
      bucket_id text not null references storage.buckets,
      name text not null, metadata jsonb, primary key (bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
    create policy previously_permissive on storage.objects for all to anon, authenticated using (true) with check (true);
  `);
  const folder = new URL('../supabase/migrations/', import.meta.url);
  const prerequisites = (await readdir(folder)).filter(name => name.endsWith('.sql') && name < '202611180016').sort();
  const archiveMigrations = ['202611180017_archivio_documenti.sql', '202611180018_cestino_rls.sql', '202611180019_cestino_documenti.sql'];
  for (const name of [...prerequisites, ...archiveMigrations]) await db.exec(await readFile(new URL(name, folder), 'utf8'));

  const bucket = 'document-originals';
  const { rows: [bucketInfo] } = await db.query(
    'select public, file_size_limit::integer as size, allowed_mime_types from storage.buckets where id = $1', [bucket],
  );
  assert.deepEqual(bucketInfo, { public: false, size: 26214400, allowed_mime_types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] });

  const [org, otherOrg, owner, colleague, outsider, site, otherSite, id, original, client, otherClient] = Array.from({ length: 11 }, randomUUID);
  await db.query("insert into public.organizations values ($1,'Una'),($2,'Due')", [org, otherOrg]);
  await db.query(`
    insert into auth.users values ($1,'owner@example.test',now()),($2,'collega@example.test',now()),($3,'altra@example.test',now())
  `, [owner, colleague, outsider]);
  await db.query(`
    insert into public.organization_members values
      ($1,$3,'owner@example.test','coordinator',true),
      ($1,$4,'collega@example.test','coordinator',true),
      ($2,$5,'altra@example.test','admin',true)
  `, [org, otherOrg, owner, colleague, outsider]);
  await db.query(`
    insert into public.clients (organization_id,id,name) values ($1,$3,'Cliente'),($2,$4,'Altro cliente')
  `, [org, otherOrg, client, otherClient]);
  await db.query(`
    insert into public.sites (organization_id,id,client_id,name,city,status)
    values ($1,$3,$5,'Cantiere','Roma','active'),($2,$4,$6,'Altro','Roma','active')
  `, [org, otherOrg, site, otherSite, client, otherClient]);

  async function signIn(user) {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  }
  const prepare = (organization = org, target = id, worksite = site, name = 'Fattura originale.jpeg', mime = 'image/jpeg', size = 37) =>
    db.query('select public.imprelio_prepare_document($1,$2,$3,$4,$5,$6,$7) as file', [organization, target, 'invoice', name, mime, size, worksite])
      .then(result => result.rows[0].file);
  const extraction = { kind: 'invoice', status: 'extracted', fields: {
    title: 'Fattura ponteggio', number: '14/2026', date: '2026-11-01', issuer: 'Impresa', recipient: 'Cliente', total: '420.00', currency: 'EUR', text: 'Fattura 14/2026 - Totale 420,00 EUR',
  } };
  const finish = (value = extraction) => db.query('select public.imprelio_finish_document($1,$2,$3) as file', [org, id, JSON.stringify(value)])
    .then(result => result.rows[0].file);
  const attach = value => db.query('select public.imprelio_attach_estimate_document($1,$2,$3) as file', [org, original, JSON.stringify(value)])
    .then(result => result.rows[0].file);
  const trash = (kind, target, action) => db.query('select public.imprelio_trash_write($1,$2,$3,$4) as item', [org, kind, target, action])
    .then(result => result.rows[0].item);
  const originals = () => db.query('select name from storage.objects where bucket_id=$1', [bucket]).then(result => result.rows);
  const published = () => db.query('select extraction from public.document_imports where uploaded_at is not null').then(result => result.rows);
  const put = (key, size, mime, target = bucket) => db.query(
    'insert into storage.objects(bucket_id,name,metadata) values ($1,$2,$3)', [target, key, JSON.stringify({ size, mimetype: mime })],
  );
  const key = org + '/' + id + '.jpg';

  await signIn(owner);
  await assert.rejects(prepare(otherOrg), { code: '42501' });
  await assert.rejects(prepare(org, id, otherSite), { code: 'P0002' });
  await assert.rejects(prepare(org, id, site, '../Fattura.jpeg'), { code: '22023' });
  await assert.rejects(prepare(org, id, site, 'Fattura.jpeg', 'text/html'), { code: '22023' });
  await assert.rejects(prepare(org, id, site, 'Fattura.png'), { code: '22023' });
  await assert.rejects(prepare(org, id, site, 'Fattura.jpeg', 'image/jpeg', 26214401), { code: '22023' });
  await assert.rejects(put(key, 37, 'image/jpeg'), { code: '42501' });
  const pending = await prepare();
  assert.deepEqual(await prepare(), pending);
  assert.equal(pending.uploaded_at, null);
  assert.equal(await finish(), null);
  assert.deepEqual(await published(), []);
  const pendingWithNoSite = await prepare(org, randomUUID(), null, 'Lettera.webp', 'image/webp');
  assert.equal(pendingWithNoSite.site_id, null);
  await assert.rejects(trash('document_import', pendingWithNoSite.id, 'delete'), { code: 'P0002' });
  await assert.rejects(put(key.replace(/jpg$/, 'pdf'), 37, 'image/jpeg'), { code: '42501' });
  await put(key, 99, 'image/jpeg');
  await assert.rejects(finish(), { code: '22023' });
  await assert.rejects(finish({ ...extraction, kind: 'quote' }), { code: '22023' });
  await assert.rejects(finish({ ...extraction, fields: { ...extraction.fields, date: '2026-02-30' } }), { code: '22023' });
  assert.deepEqual(await published(), []);

  await signIn(colleague);
  assert.deepEqual(await originals(), []);
  await assert.rejects(prepare(), { code: '23505' });
  await assert.rejects(finish(), { code: 'P0002' });
  await db.exec('reset role');
  await db.query("update storage.objects set metadata = '{\"size\":37,\"mimetype\":\"image/jpeg\"}' where name=$1", [key]);
  await signIn(owner);
  const saved = await finish();
  assert.ok(saved.uploaded_at);
  assert.deepEqual(saved.extraction, extraction);
  assert.deepEqual(await finish(), saved);
  assert.deepEqual(await prepare(), saved);
  assert.equal((await db.query("delete from storage.objects where bucket_id='document-originals'")).affectedRows, 0);
  await assert.rejects(db.query("update public.document_imports set file_name='manuale.jpeg'"), { code: '42501' });

  await signIn(colleague);
  assert.deepEqual(await published(), [{ extraction }]);
  assert.deepEqual(await originals(), [{ name: key }]);
  assert.deepEqual(await trash('document_import', id, 'delete'), { id });
  assert.deepEqual(await trash('document_import', id, 'delete'), { id });
  assert.deepEqual((await db.query('select id,kind,label from public.imprelio_trash_list($1)', [org])).rows, [
    { id, kind: 'document_import', label: 'Fattura originale.jpeg' },
  ]);
  await signIn(owner);
  assert.deepEqual(await published(), []);
  assert.deepEqual(await originals(), []);
  await assert.rejects(prepare(), { code: 'P0002' });
  await assert.rejects(finish(), { code: 'P0002' });
  await assert.rejects(put(key, 37, 'image/jpeg'), { code: '42501' });
  await db.exec('reset role');
  assert.deepEqual(await originals(), [{ name: key }]);
  await signIn(owner);
  await trash('site', site, 'delete');
  await assert.rejects(trash('document_import', id, 'restore'), { code: '23503' });
  await trash('site', site, 'restore');
  assert.deepEqual(await trash('document_import', id, 'restore'), { id });
  assert.deepEqual(await trash('document_import', id, 'restore'), { id });
  assert.deepEqual(await finish(), saved);
  assert.deepEqual(await published(), [{ extraction }]);
  assert.deepEqual(await originals(), [{ name: key }]);

  await signIn(outsider);
  assert.deepEqual(await originals(), []);
  assert.deepEqual(await published(), []);
  await assert.rejects(finish(), { code: '42501' });
  await assert.rejects(trash('document_import', id, 'delete'), { code: '42501' });
  await db.exec('set role anon');
  assert.deepEqual(await originals(), []);
  await assert.rejects(published(), { code: '42501' });

  await signIn(owner);
  const estimate = { ...extraction, kind: 'estimate' };
  await db.query('select public.imprelio_prepare_estimate_pdf($1,$2,$3,$4,$5)', [org, site, original, 'Computo.pdf', 37]);
  await assert.rejects(attach(estimate), { code: 'P0002' });
  await put(org + '/' + original + '.pdf', 37, 'application/pdf', 'estimate-source-pdfs');
  await db.query('select public.imprelio_finish_estimate_pdf($1,$2)', [org, original]);
  assert.deepEqual((await attach(estimate)).document_extraction, estimate);
  assert.deepEqual((await attach(estimate)).document_extraction, estimate);
  assert.deepEqual(await published(), [{ extraction }]);
  await db.query("select public.imprelio_trash_write($1,'estimate_pdf',$2,'delete')", [org, original]);
  await assert.rejects(attach(estimate), { code: 'P0002' });
  assert.deepEqual((await db.query('select document_extraction from public.estimate_pdf_files')).rows, []);
});
