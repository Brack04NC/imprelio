import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

test('Il cestino blocca modifiche da schede obsolete e nuovi collegamenti a schede eliminate', async t => {
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
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  const latest = '202611180014_cestino_controlli.sql';
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql') && name <= latest).sort()) {
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  }

  const [org, user, client, site, job, quote, file, invoice, worker, deadline, vehicle, account] =
    Array.from({ length: 12 }, randomUUID);
  await db.query("insert into public.organizations values ($1,'Impresa')", [org]);
  await db.query("insert into auth.users values ($1,'coordinatore@example.test',now())", [user]);
  await db.query("insert into public.organization_members values ($1,$2,'coordinatore@example.test','coordinator',true)", [org, user]);
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);

  const write = (writer, payload) => db.query(`select public.${writer}($1, $2)`, [org, JSON.stringify(payload)]);
  const trash = (kind, id, action) => db.query('select public.imprelio_trash_write($1, $2, $3, $4)', [org, kind, id, action]);
  const preparePdf = (id = file) => db.query("select public.imprelio_prepare_estimate_pdf($1,$2,$3,'Computo.pdf',37)", [org, site, id]);
  const finishPdf = () => db.query('select public.imprelio_finish_estimate_pdf($1,$2) as file', [org, file]);
  const clientPayload = { id: client, name: 'Cliente di prova' };
  const sitePayload = { action: 'site', id: site, client_id: client, name: 'Via Roma', city: 'Roma', address: '', manager: '', status: 'active' };
  const jobPayload = {
    action: 'job', id: job, site_id: site, kind: 'assembly', zone: 'Facciata', due_date: '2026-11-20', time: '08:30', notes: '', status: 'scheduled',
  };
  const invoicePayload = {
    action: 'save', kind: 'invoice', id: invoice, title: 'Fattura', status: 'open',
    site_id: site, record_date: '2026-11-20', fields: {}, lines: [{ description: 'Prova' }],
  };
  const deadlinePayload = {
    action: 'save', id: deadline, worker_id: worker, category: 'certificate', title: 'Attestato', due_on: '2026-12-01',
  };
  const quoteLines = JSON.stringify([{
    reference: '1', code: '1', title: 'Montaggio', description: '', page: 1,
    unit: 'm²', quantity: '10', price: '5', sourcePrice: '', sourceTotal: '',
  }]);

  await write('imprelio_client_write', clientPayload);
  await write('imprelio_write', sitePayload);
  await write('imprelio_write', jobPayload);
  await write('imprelio_operation_write', invoicePayload);
  await write('imprelio_operation_write', {
    action: 'save', kind: 'worker', id: worker, status: 'active', title: 'Operaio', fields: {}, lines: [],
  });
  await write('imprelio_operation_write', {
    action: 'save', kind: 'article', id: vehicle, status: 'active', title: 'Autocarro', fields: { category: 'vehicles' }, lines: [],
  });
  await write('imprelio_worker_deadline_write', deadlinePayload);
  await write('imprelio_finance_write', { action: 'save_account', id: account, name: 'Cassa', opening_date: '2026-11-20', opening_cents: '0' });
  await db.query(`insert into public.estimate_quotes (organization_id,id,site_id,title,source_name,lines)
    values ($1,$2,$3,'Preventivo','Computo.pdf',$4)`, [org, quote, site, quoteLines]);
  await preparePdf();
  await db.query("insert into storage.objects values ('estimate-source-pdfs',$1,$2)", [
    `${org}/${file}.pdf`, JSON.stringify({ size: 37, mimetype: 'application/pdf' }),
  ]);
  const originalPdf = (await finishPdf()).rows[0].file;

  // No-op finalization and archival writes must observe a committed deletion too.
  await trash('estimate_pdf', file, 'delete');
  await assert.rejects(finishPdf(), { code: 'P0002' });
  await assert.rejects(preparePdf(), { code: 'P0002' });
  await trash('estimate_pdf', file, 'restore');
  assert.deepEqual((await finishPdf()).rows[0].file, originalPdf);
  const archiveDeadline = { ...deadlinePayload, action: 'archive' };
  await write('imprelio_worker_deadline_write', archiveDeadline);
  await trash('worker_deadline', deadline, 'delete');
  await assert.rejects(write('imprelio_worker_deadline_write', archiveDeadline), { code: 'P0002' });
  await trash('worker_deadline', deadline, 'restore');
  await write('imprelio_worker_deadline_write', archiveDeadline);
  await trash('operation', invoice, 'delete');
  for (const action of ['save', 'archive', 'restore']) {
    await assert.rejects(write('imprelio_operation_write', { ...invoicePayload, action }), { code: 'P0002' });
  }
  await trash('operation', invoice, 'restore');

  // Linked documents can still go through the archive lifecycle for a historical site.
  await trash('intervention', job, 'delete');
  await trash('site', site, 'delete');
  await assert.rejects(trash('intervention', job, 'restore'), { code: '23503' });
  await assert.rejects(write('imprelio_write', sitePayload), { code: 'P0002' });
  await assert.rejects(write('imprelio_write', { ...jobPayload, id: randomUUID() }), { code: '23503' });
  await assert.rejects(write('imprelio_operation_write', invoicePayload), { code: '23503' });
  await write('imprelio_operation_write', { ...invoicePayload, action: 'archive' });
  await write('imprelio_operation_write', { ...invoicePayload, action: 'restore' });
  await assert.rejects(db.query("update public.estimate_quotes set title = 'Modifica' where id = $1", [quote]), { code: '23503' });
  await assert.rejects(preparePdf(randomUUID()), { code: '23503' });
  await assert.rejects(finishPdf(), { code: '23503' });
  await assert.rejects(write('imprelio_vehicle_assignment_write', {
    action: 'save', id: randomUUID(), vehicle_id: vehicle, site_id: site,
    periods: [{ start_date: '2026-11-20', end_date: '2026-11-20' }],
  }), { code: '23503' });
  await assert.rejects(write('imprelio_attendance_write', {
    action: 'save', id: randomUUID(), person_id: worker, kind: 'work', work_date: '2026-11-20', start_time: '08:00',
    end_time: '09:00', workplace: 'site', site_id: site,
  }), { code: '23503' });
  await assert.rejects(write('imprelio_finance_write', {
    action: 'save_entry', id: randomUUID(), account_id: account, site_id: site, record_date: '2026-11-20',
    description: 'Movimento', direction: 'in', amount_cents: '2000',
  }), { code: '23503' });

  await trash('client', client, 'delete');
  await assert.rejects(write('imprelio_client_write', clientPayload), { code: 'P0002' });
  await assert.rejects(write('imprelio_write', { ...sitePayload, id: randomUUID() }), { code: '23503' });
  await assert.rejects(trash('site', site, 'restore'), { code: '23503' });
  await trash('client', client, 'restore');
  await trash('site', site, 'restore');
  await trash('intervention', job, 'restore');
  await write('imprelio_client_write', clientPayload);
  await write('imprelio_write', sitePayload);
  await write('imprelio_write', jobPayload);
  await write('imprelio_operation_write', invoicePayload);
  assert.deepEqual((await finishPdf()).rows[0].file, originalPdf);
  await assert.rejects(db.query('select imprelio_private.imprelio_operation_write($1, $2)', [org, JSON.stringify(invoicePayload)]), { code: '42501' });
});
