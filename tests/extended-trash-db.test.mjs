import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

test('Il cestino esteso preserva collegamenti, stock, tipi di archivio e isolamento aziendale', async t => {
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
      bucket_id text not null references storage.buckets, name text not null, metadata jsonb, primary key (bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select, insert on storage.objects to authenticated;
  `);
  const migrations = [
    '202611180001_cantieri.sql', '202611180002_operativita.sql', '202611180003_clienti.sql',
    '202611180004_preventivi_da_computo.sql', '202611180005_assegnazioni_veicoli.sql', '202611180006_archivio_computi_pdf.sql',
    '202611180007_contabilita.sql', '202611180008_cestino.sql', '202611180009_manutenzione_veicoli.sql', '202611180010_presenze.sql',
    '202611180011_scadenze_operai.sql', '202611180012_notifiche.sql', '202611180013_cestino_schede.sql',
    '202611180014_cestino_controlli.sql',
  ];
  for (const migration of migrations) {
    await db.exec(await readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
  }

  const [org, otherOrg, user, otherUser, inactive, client, otherClient, site, otherSite, intervention, quote,
    article, stockIn, stockOut, invoice, worker, deadline, attendance, pdf] = Array.from({ length: 19 }, randomUUID);
  await db.query(`insert into public.organizations values ($1,'Prima'), ($2,'Seconda')`, [org, otherOrg]);
  await db.query(`insert into auth.users values
    ($1,'prima@example.test',now()), ($2,'seconda@example.test',now()), ($3,'inattivo@example.test',now())`, [user, otherUser, inactive]);
  await db.query(`insert into public.organization_members values
    ($1,$2,'prima@example.test','coordinator',true),
    ($3,$4,'seconda@example.test','admin',true),
    ($1,$5,'inattivo@example.test','coordinator',false)`, [org, user, otherOrg, otherUser, inactive]);
  await db.query(`insert into public.clients (organization_id,id,name) values
    ($1,$2,'Cliente originale'), ($3,$4,'Cliente riservato')`, [org, client, otherOrg, otherClient]);
  await db.query(`insert into public.sites (organization_id,id,client_id,name,city,status) values
    ($1,$2,$3,'Cantiere originale','Roma','closed'), ($4,$5,$6,'Cantiere riservato','Milano','active')`,
  [org, site, client, otherOrg, otherSite, otherClient]);

  async function signIn(id) {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  }
  const read = async (table, id) => (await db.query(`select to_jsonb(record) as value from public.${table} as record where id=$1`, [id])).rows[0]?.value;
  const trash = (kind, id, action, company = org) => db.query('select public.imprelio_trash_write($1,$2,$3,$4)', [company, kind, id, action]);
  const list = async (company = org) => (await db.query('select * from public.imprelio_trash_list($1)', [company])).rows;
  const sourceNotifications = async () => (await db.query('select id from public.imprelio_pending_estimate_pdfs($1)', [org])).rows;
  const write = (name, payload) => db.query(`select public.${name}($1,$2)`, [org, JSON.stringify(payload)]);
  const saveOperation = (id, kind, fields = {}, options = {}) => write('imprelio_operation_write', {
    action: 'save', id, kind, fields, title: kind, status: 'active', record_date: null, lines: [], ...options,
  });
  const scaffold = [{
    reference: '1', code: '1', title: 'Ponteggio', description: '', page: 1,
    unit: 'm²', quantity: '100', price: '12', sourcePrice: '', sourceTotal: '',
  }];

  await signIn(user);
  await write('imprelio_write', { action: 'job', id: intervention, site_id: site, kind: 'assembly', zone: 'Via Roma',
    due_date: '2026-11-20', time: '08:00', notes: 'Nota privata', status: 'scheduled' });
  await db.query(`insert into public.estimate_quotes (organization_id,id,site_id,title,source_name,lines) values
    ($1,$2,$3,'Preventivo esistente','Altro.pdf',$4)`, [org, quote, site, JSON.stringify(scaffold)]);
  await saveOperation(article, 'article');
  const movement = (id, direction, quantity) => saveOperation(id, 'movement', { article_id: article, direction, quantity }, {
    record_date: '2026-11-20', status: 'recorded',
  });
  await movement(stockIn, 'in', '10');
  await movement(stockOut, 'out', '4');
  await saveOperation(invoice, 'invoice', { direction: 'issued' }, {
    record_date: '2026-11-20', site_id: site, status: 'draft', title: 'Fattura da conservare',
    lines: [{ description: 'Montaggio', quantity: '1', unit_price: '12', vat: '22' }],
  });
  await saveOperation(worker, 'worker');
  await write('imprelio_worker_deadline_write', { action: 'save', worker_id: worker, id: deadline, category: 'certificate',
    title: 'Patentino', due_on: '2026-12-20' });
  await write('imprelio_attendance_write', { action: 'save', person_id: worker, id: attendance, kind: 'work', work_date: '2026-11-20',
    start_time: '08:00', end_time: '12:00', workplace: 'site', site_id: site });
  await db.query(`select public.imprelio_prepare_estimate_pdf($1,$2,$3,'Computo originale.pdf',37)`, [org, site, pdf]);
  const objectKey = org + '/' + pdf + '.pdf';
  await db.query(`insert into storage.objects values ('estimate-source-pdfs',$1,$2)`, [objectKey, JSON.stringify({
    size: 37, mimetype: 'application/pdf',
  })]);
  await db.query('select public.imprelio_finish_estimate_pdf($1,$2)', [org, pdf]);

  await assert.rejects(trash('client', client, 'delete'), { code: 'P0001', message: 'Cliente con cantieri attivi' });
  await assert.rejects(trash('operation', article, 'delete'), { code: 'P0001', message: 'Articolo con movimenti attivi' });
  await assert.rejects(trash('operation', stockIn, 'delete'), { code: 'P0001', message: 'Stock insufficiente' });
  assert.equal((await read('operation_records', stockIn)).archived, false);
  assert.equal((await list()).length, 0);

  await trash('operation', stockOut, 'delete');
  await trash('operation', stockIn, 'delete');
  await trash('operation', article, 'delete');
  assert.equal(await read('operation_records', article), undefined);
  await assert.rejects(trash('operation', stockIn, 'restore'), { code: 'P0002' });
  assert.equal((await list()).length, 3);
  await trash('operation', article, 'restore');
  await trash('operation', stockIn, 'restore');
  await trash('operation', stockOut, 'restore');
  assert.equal((await read('operation_records', stockOut)).archived, false);
  await write('imprelio_operation_write', { action: 'archive', kind: 'movement', id: stockOut });
  await trash('operation', stockOut, 'delete');
  await trash('operation', stockOut, 'restore');
  assert.equal((await read('operation_records', stockOut)).archived, true);

  await trash('worker_deadline', deadline, 'delete');
  await trash('operation', worker, 'delete');
  assert.equal(await read('operation_records', worker), undefined);
  assert.equal((await read('attendance_entries', attendance)).person_id, worker);
  await assert.rejects(trash('worker_deadline', deadline, 'restore'), { code: '23503' });
  await trash('operation', worker, 'restore');
  await trash('worker_deadline', deadline, 'restore');
  assert.equal((await read('worker_deadlines', deadline)).worker_id, worker);
  await write('imprelio_operation_write', { action: 'archive', kind: 'worker', id: worker });
  await trash('worker_deadline', deadline, 'delete');
  await trash('worker_deadline', deadline, 'restore');
  assert.equal((await read('operation_records', worker)).archived, true);

  assert.deepEqual(await sourceNotifications(), [{ id: pdf }]);
  await trash('estimate_pdf', pdf, 'delete');
  assert.deepEqual(await sourceNotifications(), []);
  assert.equal(await read('estimate_pdf_files', pdf), undefined);
  assert.deepEqual((await db.query('select name from storage.objects')).rows, []);
  assert.ok((await list()).some(row => row.kind === 'estimate_pdf' && row.label === 'Computo originale.pdf'));
  await trash('estimate_pdf', pdf, 'restore');
  assert.deepEqual((await db.query('select name from storage.objects')).rows, [{ name: objectKey }]);

  await trash('quote', quote, 'delete');
  assert.equal(await read('estimate_quotes', quote), undefined);
  await trash('quote', quote, 'restore');
  assert.equal((await read('estimate_quotes', quote)).title, 'Preventivo esistente');
  await trash('intervention', intervention, 'delete');
  assert.ok((await list()).some(row => row.kind === 'intervention' && row.label === 'Montaggio · Via Roma'));
  await trash('intervention', intervention, 'restore');

  await trash('site', site, 'delete');
  await trash('site', site, 'delete');
  assert.equal(await read('sites', site), undefined);
  assert.equal(await read('interventions', intervention), undefined);
  assert.equal((await read('operation_records', invoice)).site_id, site);
  assert.equal((await read('estimate_pdf_files', pdf)).site_id, site);
  assert.deepEqual(await sourceNotifications(), []);
  const workspace = (await db.query(`select public.imprelio_workspace($1,'','all',1,$2) as value`, [org, site])).rows[0].value;
  assert.equal(workspace.total, 0);
  assert.equal(workspace.current, null);
  assert.equal(workspace.counts.today, 0);
  await trash('client', client, 'delete');
  assert.equal(await read('clients', client), undefined);
  const entries = await list();
  assert.deepEqual(entries.map(({ id, kind, label }) => ({ id, kind, label })), [
    { id: client, kind: 'client', label: 'Cliente originale' },
    { id: site, kind: 'site', label: 'Cantiere originale' },
  ]);
  assert.ok(entries.every(entry => Object.keys(entry).sort().join(',') === 'deleted_at,id,kind,label'));
  await assert.rejects(trash('site', site, 'restore'), { code: '23503' });

  await assert.rejects(trash('client', otherClient, 'delete'), { code: 'P0002' });
  await assert.rejects(list(otherOrg), { code: '42501' });
  await assert.rejects(db.query('select * from imprelio_private.trashed_records'), { code: '42501' });
  await assert.rejects(db.query('select imprelio_private.imprelio_trash_write($1,$2,$3,$4)', [org, 'quote', quote, 'delete']), { code: '42501' });
  await signIn(otherUser);
  assert.deepEqual(await list(otherOrg), []);
  assert.equal((await db.query("select imprelio_private.is_trashed($1,'client',$2) as result", [org, client])).rows[0].result, false);
  await signIn(inactive);
  await assert.rejects(list(), { code: '42501' });
  await assert.rejects(trash('client', client, 'restore'), { code: '42501' });

  await signIn(user);
  await trash('client', client, 'restore');
  await trash('site', site, 'restore');
  await trash('site', site, 'restore');
  assert.equal((await read('sites', site)).client_id, client);
  assert.equal((await read('interventions', intervention)).notes, 'Nota privata');
  assert.deepEqual(await sourceNotifications(), [{ id: pdf }]);
  assert.deepEqual(await list(), []);
});
