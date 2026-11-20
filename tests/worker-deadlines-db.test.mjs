import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL isola le scadenze per azienda, valida le date e tutela lo storico degli operai', async t => {
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
    grant usage on schema auth to authenticated, anon;
  `);
  const migrations = [
    '202611180001_cantieri.sql',
    '202611180002_operativita.sql',
    '202611180005_assegnazioni_veicoli.sql',
    '202611180011_scadenze_operai.sql',
  ];
  for (const migration of migrations) {
    await db.exec(await readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
  }

  const [org, otherOrg, coordinator, otherAdmin, formerMember, worker, colleague, employee, otherWorker] =
    Array.from({ length: 9 }, randomUUID);
  await db.query("insert into public.organizations values ($1,'Prima'), ($2,'Seconda')", [org, otherOrg]);
  await db.query("insert into auth.users values ($1,'prima@example.test',now()), ($2,'seconda@example.test',now()), ($3,'uscito@example.test',now())", [
    coordinator, otherAdmin, formerMember,
  ]);
  await db.query(`
    insert into public.organization_members values
      ($1,$2,'prima@example.test','coordinator',true),
      ($3,$4,'seconda@example.test','admin',true),
      ($1,$5,'uscito@example.test','coordinator',false)
  `, [org, coordinator, otherOrg, otherAdmin, formerMember]);

  const signIn = async user => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  };
  const operation = (organization, id, kind, overrides = {}) => db.query('select public.imprelio_operation_write($1,$2)', [
    organization, JSON.stringify({ action: 'save', id, kind, title: 'Scheda personale', status: 'active', fields: {}, lines: [], ...overrides }),
  ]);
  const write = async (payload, organization = org) => (await db.query('select public.imprelio_worker_deadline_write($1,$2) as row', [
    organization, JSON.stringify(payload),
  ])).rows[0].row;
  const read = async id => (await db.query('select to_jsonb(deadline) as row from public.worker_deadlines as deadline where id = $1', [id])).rows[0]?.row;
  const save = (overrides = {}) => ({
    action: 'save', id: randomUUID(), worker_id: worker, category: 'certificate',
    title: 'Formazione ponteggi', completed_on: '2026-11-20', due_on: '2027-11-20', ...overrides,
  });
  const lifecycle = (action, id, selectedWorker = worker) => ({ action, id, worker_id: selectedWorker });

  await signIn(otherAdmin);
  await operation(otherOrg, otherWorker, 'worker');
  const otherEntry = await write(save({ worker_id: otherWorker }), otherOrg);

  await signIn(coordinator);
  await operation(org, worker, 'worker');
  await operation(org, colleague, 'worker', { status: 'on_leave' });
  await operation(org, employee, 'employee');
  assert.equal(await read(otherEntry.id), undefined);
  await assert.rejects(write(save({ worker_id: otherWorker })), { code: 'P0002' });
  await assert.rejects(write(save({ worker_id: employee })), { code: 'P0002' });
  await assert.rejects(write(save(), otherOrg), { code: '42501' });
  await assert.rejects(write(lifecycle('archive', otherEntry.id)), { code: 'P0002' });
  await assert.rejects(write(lifecycle('restore', randomUUID())), { code: 'P0002' });
  await assert.rejects(write(lifecycle('delete', randomUUID())), { code: '22023' });

  for (const invalid of [
    save({ completed_on: null, due_on: null }),
    save({ completed_on: '2026-02-30' }),
    save({ due_on: '0000-01-01' }),
    save({ due_on: '2027-1-1' }),
    save({ due_on: '2026-11-19' }),
    save({ completed_on: 2026 }),
    save({ due_on: [] }),
    save({ category: 'unknown' }),
    save({ title: ' \t\n ' }),
    save({ title: 'a'.repeat(161) }),
    save({ title: { text: 'Formazione' } }),
  ]) {
    await assert.rejects(write(invalid), { code: '22023' });
  }

  const medical = save({ category: 'medical', title: 'Titolo fornito dal client', due_on: null });
  const savedMedical = await write(medical);
  assert.equal(savedMedical.title, 'Visita medica');
  assert.equal(savedMedical.due_on, null);
  assert.equal(savedMedical.completed_on, medical.completed_on);
  assert.equal(savedMedical.organization_id, org);
  assert.equal(savedMedical.worker_id, worker);
  assert.equal(savedMedical.archived, false);
  assert.deepEqual(await write({ ...medical, title: undefined }), savedMedical);
  const certificate = save({ title: ' \tFormazione ponteggi\n ', completed_on: null });
  const savedCertificate = await write(certificate);
  assert.equal(savedCertificate.title, 'Formazione ponteggi');
  assert.equal(savedCertificate.completed_on, null);
  assert.equal(savedCertificate.due_on, certificate.due_on);
  const other = await write(save({ worker_id: colleague, category: 'other', due_on: '2026-11-20' }));
  assert.equal(other.worker_id, colleague);
  assert.equal(other.completed_on, other.due_on);
  await assert.rejects(write({ ...medical, worker_id: colleague }), { code: 'P0002' });
  await assert.rejects(write(lifecycle('archive', medical.id, colleague)), { code: 'P0002' });
  assert.deepEqual(await read(medical.id), savedMedical);
  await assert.rejects(db.query('delete from public.worker_deadlines where id = $1', [medical.id]), { code: '42501' });

  const archived = await write(lifecycle('archive', medical.id));
  assert.equal(archived.archived, true);
  assert.deepEqual(await write(lifecycle('archive', medical.id)), archived);
  assert.deepEqual(await read(medical.id), archived);
  await assert.rejects(write(medical), { code: 'P0002' });
  await operation(org, worker, 'worker', { action: 'archive' });
  assert.deepEqual(await read(medical.id), archived);
  assert.deepEqual(await read(certificate.id), savedCertificate);
  await assert.rejects(write(lifecycle('restore', medical.id)), { code: 'P0002' });
  await assert.rejects(write(lifecycle('archive', certificate.id)), { code: 'P0002' });
  await assert.rejects(write(certificate), { code: 'P0002' });
  await assert.rejects(write(save()), { code: 'P0002' });
  await operation(org, worker, 'worker', { action: 'restore' });
  const restored = await write(lifecycle('restore', medical.id));
  assert.equal(restored.archived, false);
  assert.deepEqual(await write(lifecycle('restore', medical.id)), restored);
  assert.equal((await write({ ...medical, due_on: '2027-11-20' })).due_on, '2027-11-20');

  await signIn(formerMember);
  assert.equal(await read(medical.id), undefined);
  await assert.rejects(write(medical), { code: '42501' });
  await signIn(otherAdmin);
  assert.deepEqual(await read(otherEntry.id), otherEntry);
  assert.equal(await read(medical.id), undefined);
  await db.exec('set role anon');
  await assert.rejects(read(medical.id), { code: '42501' });
  await assert.rejects(write(medical), { code: '42501' });
});
