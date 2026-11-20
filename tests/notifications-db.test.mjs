import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { estimatePdfFileName } from '../lib/estimate-pdf-archive.ts';

test('I PDF da preventivare rispettano lo stato del caricamento, il cestino e l’azienda', async t => {
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
    grant usage on schema auth to authenticated;

    create schema storage;
    create table storage.buckets (
      id text primary key, name text not null, public boolean, file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (bucket_id text, name text, metadata jsonb);
    alter table storage.objects enable row level security;
  `);
  for (const migration of [
    '202611180001_cantieri.sql',
    '202611180004_preventivi_da_computo.sql',
    '202611180006_archivio_computi_pdf.sql',
    '202611180008_cestino.sql',
    '202611180012_notifiche.sql',
  ]) {
    await db.exec(await readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
  }

  const [org, otherOrg, user, otherUser, inactiveUser, site, secondSite, otherSite, pending, uploaded, uploading, secondPending] =
    Array.from({ length: 12 }, randomUUID);
  await db.query("insert into public.organizations values ($1,'Prima'), ($2,'Seconda')", [org, otherOrg]);
  await db.query(`
    insert into auth.users values
      ($1,'prima@example.test',now()), ($2,'seconda@example.test',now()), ($3,'inattivo@example.test',now())
  `, [user, otherUser, inactiveUser]);
  await db.query(`
    insert into public.organization_members values
      ($1,$2,'prima@example.test','coordinator',true),
      ($3,$4,'seconda@example.test','admin',true),
      ($1,$5,'inattivo@example.test','coordinator',false)
  `, [org, user, otherOrg, otherUser, inactiveUser]);
  await db.query(`
    insert into public.sites (organization_id,id,name,city,status) values
      ($1,$2,'Primo cantiere','Roma','active'), ($1,$3,'Secondo cantiere','Roma','active'),
      ($4,$5,'Altro cantiere','Milano','active')
  `, [org, site, secondSite, otherOrg, otherSite]);
  const uploadDate = '2026-11-19T12:30:00Z';
  const earlierDate = '2026-11-19T11:30:00Z';
  const sourceName = '\u00a0Computo/scala.PDF';
  const archiveName = estimatePdfFileName(sourceName);
  await db.query(`
    insert into public.estimate_pdf_files (organization_id,id,site_id,file_name,size_bytes,uploaded_at) values
      ($1,$3,$2,'Da prezzare.pdf',1024,$8),
      ($1,$4,$2,$9,1024,$8),
      ($1,$5,$2,'Caricamento.pdf',1024,null),
      ($6,$3,$7,'Riservato.pdf',1024,$8),
      ($1,$10,$11,$9,1024,$12)
  `, [org, site, pending, uploaded, uploading, otherOrg, otherSite, uploadDate, archiveName, secondPending, secondSite, earlierDate]);

  const longName = '😀'.repeat(10) + 'A'.repeat(240) + '.pdf';
  for (const name of [sourceName, 'Progetto\\nuovo.pdf', '\u007f.pdf', 'Computo', longName]) {
    const { rows: [{ normalized }] } = await db.query(
      'select imprelio_private.normalized_estimate_pdf_name($1) as normalized', [name.slice(0, 250)],
    );
    assert.equal(normalized, estimatePdfFileName(name));
  }

  const signIn = async id => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  };
  const read = async company => (await db.query('select * from public.imprelio_pending_estimate_pdfs($1)', [company])).rows;
  const lines = [{
    reference: '1', code: '1', title: 'Ponteggio', description: '', page: 1,
    unit: 'm²', quantity: '100', price: '12', sourcePrice: '', sourceTotal: '',
  }];
  function saveQuote(company, worksite, id, source) {
    return db.query(`
      insert into public.estimate_quotes (organization_id,id,site_id,title,source_name,lines)
      values ($1,$2,$3,'Preventivo',$4,$5)
    `, [company, id, worksite, source, JSON.stringify(lines)]);
  }
  const trash = (company, id, action) => db.query('select public.imprelio_trash_write($1,$2,$3,$4)', [company, 'quote', id, action]);

  await signIn(user);
  assert.deepEqual((await read(org)).map(file => file.id), [...[pending, uploaded].sort(), secondPending]);
  await assert.rejects(read(otherOrg), { code: '42501' });
  await assert.rejects(read(null), { code: '42501' });
  await saveQuote(org, site, pending, sourceName);
  const expected = [
    { id: pending, site_id: site, file_name: 'Da prezzare.pdf', uploaded_at: new Date(uploadDate) },
    { id: secondPending, site_id: secondSite, file_name: archiveName, uploaded_at: new Date(earlierDate) },
  ];
  assert.deepEqual(await read(org), expected);
  await trash(org, pending, 'delete');
  assert.deepEqual(await read(org), expected);
  await trash(org, pending, 'restore');
  assert.deepEqual(await read(org), expected);

  await signIn(otherUser);
  assert.equal((await read(otherOrg))[0].file_name, 'Riservato.pdf');
  await saveQuote(otherOrg, otherSite, pending, 'Riservato.pdf');
  assert.deepEqual(await read(otherOrg), []);
  await trash(otherOrg, pending, 'delete');
  assert.deepEqual(await read(otherOrg), []);
  await signIn(user);
  assert.deepEqual(await read(org), expected);
  await signIn(inactiveUser);
  await assert.rejects(read(org), { code: '42501' });
  await db.exec('set role anon');
  await assert.rejects(read(org), { code: '42501' });
});
