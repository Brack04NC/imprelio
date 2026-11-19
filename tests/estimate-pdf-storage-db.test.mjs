import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('L’archivio PDF tutela i file tra aziende e li rende leggibili dopo la verifica del caricamento', async t => {
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
      id text primary key, name text not null, public boolean,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      bucket_id text not null references storage.buckets,
      name text not null, metadata jsonb,
      primary key (bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;
    create policy previously_permissive on storage.objects for all to anon, authenticated using (true) with check (true);
    insert into storage.buckets (id, name) values ('unrelated', 'unrelated');
  `);
  for (const migration of ['202611180001_cantieri.sql', '202611180006_archivio_computi_pdf.sql']) {
    await db.exec(await readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
  }

  const bucket = 'estimate-source-pdfs';
  const limit = 26214400;
  const { rows: [bucketInfo] } = await db.query(
    'select public, file_size_limit::integer as file_size_limit, allowed_mime_types from storage.buckets where id = $1', [bucket],
  );
  assert.deepEqual(bucketInfo, { public: false, file_size_limit: limit, allowed_mime_types: ['application/pdf'] });

  const [org, otherOrg, user, otherUser, site, anotherSite, otherSite, file, unknown] = Array.from({ length: 9 }, randomUUID);
  await db.query("insert into public.organizations values ($1,'Prima'), ($2,'Seconda')", [org, otherOrg]);
  await db.query("insert into auth.users values ($1,'coordinatore@example.test',now()), ($2,'altra@example.test',now())", [user, otherUser]);
  await db.query(`
    insert into public.organization_members values
      ($1,$2,'coordinatore@example.test','coordinator',true),
      ($3,$4,'altra@example.test','admin',true)
  `, [org, user, otherOrg, otherUser]);
  await db.query(`
    insert into public.sites (organization_id, id, name, city, status) values
      ($1,$2,'Prima commessa','Roma','active'), ($1,$3,'Seconda commessa','Roma','active'),
      ($4,$5,'Riservata','Milano','active')
  `, [org, site, anotherSite, otherOrg, otherSite]);

  const signIn = async id => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  };
  const prepare = async (company, worksite, id, name = 'Computo originale.pdf', size = 37) => (
    await db.query('select public.imprelio_prepare_estimate_pdf($1,$2,$3,$4,$5) as file', [company, worksite, id, name, size])
  ).rows[0].file;
  const finish = async (company, id) => (
    await db.query('select public.imprelio_finish_estimate_pdf($1,$2) as file', [company, id])
  ).rows[0].file;
  const key = org + '/' + file + '.pdf';
  const objects = async () => (await db.query('select name from storage.objects where bucket_id = $1 order by name', [bucket])).rows;
  const files = async () => (await db.query('select id from public.estimate_pdf_files order by id')).rows;
  const insert = (name, size = 37, mimetype = 'application/pdf') => db.query(
    'insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)',
    [bucket, name, JSON.stringify({ size, mimetype })],
  );
  const storageMetadata = object => db.query('update storage.objects set metadata = $1 where name = $2', [JSON.stringify(object), key]);

  await signIn(user);
  await assert.rejects(prepare(otherOrg, otherSite, file), { code: '42501' });
  await assert.rejects(prepare(org, otherSite, file), { code: 'P0002' });
  await assert.rejects(prepare(org, site, file, '../riservato.pdf'), { code: '22023' });
  await assert.rejects(prepare(org, site, file, 'Computo.exe'), { code: '22023' });
  await assert.rejects(prepare(org, site, file, 'Vuoto.pdf', 0), { code: '22023' });
  await assert.rejects(prepare(org, site, file, 'Troppo grande.pdf', limit + 1), { code: '22023' });
  await assert.rejects(db.query('delete from public.estimate_pdf_files'), { code: '42501' });
  await assert.rejects(finish(org, unknown), { code: 'P0002' });
  await assert.rejects(insert(key), { code: '42501' });

  const pending = await prepare(org, site, file);
  assert.equal(pending.site_id, site);
  assert.equal(pending.uploaded_at, null);
  assert.deepEqual(await prepare(org, site, file), pending);
  await assert.rejects(prepare(org, anotherSite, file), { code: '23505' });
  await assert.rejects(prepare(org, site, file, 'Altro.pdf'), { code: '23505' });
  await assert.rejects(prepare(org, site, file, 'Computo originale.pdf', 38), { code: '23505' });
  assert.equal(await finish(org, file), null);
  await assert.rejects(insert(org + '/extra/' + file + '.pdf'), { code: '42501' });
  await assert.rejects(insert(org + '/' + unknown + '.pdf'), { code: '42501' });
  assert.equal((await prepare(org, site, randomUUID(), 'Grande.PDF', limit)).size_bytes, limit);

  await signIn(otherUser);
  assert.deepEqual(await files(), []);
  await assert.rejects(finish(org, file), { code: '42501' });
  await assert.rejects(insert(key), { code: '42501' });
  await signIn(user);

  // A mock direct insert stands in for Storage, which owns the verified object metadata.
  await insert(key, 38);
  assert.deepEqual(await objects(), []);
  await assert.rejects(finish(org, file), { code: '22023' });
  await db.exec('reset role');
  await storageMetadata({ size: 37, mimetype: 'image/png' });
  await signIn(user);
  await assert.rejects(finish(org, file), { code: '22023' });
  assert.deepEqual(await objects(), []);
  await db.exec('reset role');
  await storageMetadata({ size: 37, mimetype: 'application/pdf' });
  await signIn(user);

  const uploaded = await finish(org, file);
  assert.ok(uploaded.uploaded_at);
  assert.deepEqual(await finish(org, file), uploaded);
  assert.deepEqual(await prepare(org, site, file), uploaded);
  assert.deepEqual(await objects(), [{ name: key }]);
  await assert.rejects(insert(key), { code: '42501' });
  assert.equal((await db.query("update storage.objects set metadata = '{}'::jsonb")).affectedRows, 0);
  assert.equal((await db.query('delete from storage.objects')).affectedRows, 0);
  assert.deepEqual(await objects(), [{ name: key }]);

  await signIn(otherUser);
  assert.deepEqual(await objects(), []);
  await db.exec('set role anon');
  assert.deepEqual(await objects(), []);
  await assert.rejects(files(), { code: '42501' });
  await assert.rejects(prepare(org, site, file), { code: '42501' });
  await db.exec("insert into storage.objects (bucket_id, name) values ('unrelated', 'visible.txt')");
  assert.deepEqual((await db.query("select name from storage.objects where bucket_id = 'unrelated'")).rows, [{ name: 'visible.txt' }]);
});
