import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

test('PostgreSQL verifica le presenze per azienda, gli orari e lo storico del personale archiviato', async t => {
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
    grant usage on schema auth to authenticated, anon;
  `);
  const migrations = [
    '202611180001_cantieri.sql',
    '202611180002_operativita.sql',
    '202611180005_assegnazioni_veicoli.sql',
    '202611180010_presenze.sql',
  ];
  for (const migration of migrations) {
    await db.exec(await readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
  }

  const [org, otherOrg, coordinator, otherAdmin, formerMember, employee, worker, crew, otherWorker, site, otherSite] =
    Array.from({ length: 11 }, randomUUID);
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
  await db.query(`
    insert into public.sites (id, organization_id, name, city, status)
    values ($1,$2,'Cantiere Roma','Roma','active'), ($3,$4,'Cantiere Milano','Milano','active')
  `, [site, org, otherSite, otherOrg]);

  const signIn = async user => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  };
  const operation = (organization, id, kind, overrides = {}) => db.query('select public.imprelio_operation_write($1,$2)', [
    organization, JSON.stringify({ action: 'save', id, kind, title: 'Scheda di prova', status: 'active', fields: {}, lines: [], ...overrides }),
  ]);
  const write = async (payload, organization = org) => (await db.query('select public.imprelio_attendance_write($1,$2) as row', [
    organization, JSON.stringify(payload),
  ])).rows[0].row;
  const read = async id => (await db.query('select to_jsonb(entry) as row from public.attendance_entries as entry where id = $1', [id])).rows[0]?.row;
  const work = (overrides = {}) => ({
    action: 'save', id: randomUUID(), person_id: employee, kind: 'work', work_date: '2026-11-20',
    start_time: '08:00', end_time: '12:00', workplace: 'site', site_id: site, ...overrides,
  });
  const absence = (overrides = {}) => work({
    kind: 'vacation', start_time: null, end_time: null, workplace: null, site_id: null, ...overrides,
  });

  await signIn(otherAdmin);
  await operation(otherOrg, otherWorker, 'worker');
  const otherEntry = await write(work({ person_id: otherWorker, site_id: otherSite }), otherOrg);

  await signIn(coordinator);
  await operation(org, employee, 'employee');
  await operation(org, worker, 'worker', { status: 'on_leave' });
  await operation(org, crew, 'crew', { status: 'available' });
  assert.equal(await read(otherEntry.id), undefined);
  await assert.rejects(write(work({ person_id: otherWorker })), { code: 'P0002' });
  await assert.rejects(write(work({ person_id: crew })), { code: 'P0002' });
  await assert.rejects(write(work({ site_id: otherSite })), { code: 'P0002' });
  await assert.rejects(write(work(), otherOrg), { code: '42501' });
  assert.equal(await write({ action: 'remove', id: otherEntry.id }), null);

  for (const invalid of [
    work({ work_date: '2026-02-30' }),
    work({ work_date: '0000-01-01' }),
    work({ kind: 'invalido' }),
    work({ end_time: '24:00' }),
    work({ start_time: '08:00:00' }),
    work({ end_time: '08:00' }),
    work({ end_time: '07:00' }),
    work({ end_time: 12 }),
    work({ workplace: 'site', site_id: null }),
    work({ workplace: 'office' }),
    work({ workplace: null, site_id: null }),
    work({ start_time: null, end_time: null }),
    absence({ start_time: '08:00' }),
    absence({ workplace: 'warehouse' }),
    absence({ site_id: site }),
  ]) {
    await assert.rejects(write(invalid), { code: '22023' });
  }

  const morning = work();
  const savedMorning = await write(morning);
  assert.deepEqual(savedMorning, await write(morning));
  assert.equal(savedMorning.organization_id, org);
  assert.equal(savedMorning.site_id, site);
  assert.equal(savedMorning.start_time, '08:00:00');
  assert.equal(savedMorning.end_time, '12:00:00');
  const afternoon = work({ start_time: '12:00', end_time: '17:00', workplace: 'warehouse', site_id: null });
  const savedAfternoon = await write(afternoon);
  await write(absence({ kind: 'leave', start_time: '17:00', end_time: '18:00' }));
  await write(work({ person_id: worker }));
  await assert.rejects(write(work({ start_time: '11:59', end_time: '12:00' })), { code: '23P01' });
  await assert.rejects(write(absence()), { code: '23P01' });
  await assert.rejects(write({ ...afternoon, start_time: '11:59' }), { code: '23P01' });
  assert.deepEqual(await read(afternoon.id), savedAfternoon);

  const date = '2026-11-21';
  const fullDay = absence({ kind: 'sick', work_date: date });
  const savedFullDay = await write(fullDay);
  assert.equal(savedFullDay.workplace, null);
  assert.equal(savedFullDay.site_id, null);
  assert.equal(savedFullDay.start_time, null);
  assert.equal(savedFullDay.end_time, null);
  await assert.rejects(write(work({ work_date: date, start_time: '00:00', end_time: '00:01' })), { code: '23P01' });
  await assert.rejects(write(work({ work_date: date, start_time: '23:58', end_time: '23:59' })), { code: '23P01' });
  await write(absence({ work_date: '2026-11-22', kind: 'rest' }));
  const corrected = await write({ ...afternoon, person_id: worker, work_date: '2026-11-22' });
  assert.equal(corrected.person_id, worker);
  assert.equal(corrected.work_date, '2026-11-22');

  await assert.rejects(db.query('delete from public.attendance_entries where id = $1', [savedMorning.id]), { code: '42501' });
  await db.exec('reset role');
  await assert.rejects(db.query(`
    insert into public.attendance_entries (id, organization_id, person_id, work_date, kind)
    values ($1,$2,$3,'2026-11-21','other')
  `, [randomUUID(), org, employee]), { code: '23P01' });
  await signIn(coordinator);

  await operation(org, employee, 'employee', { action: 'archive' });
  assert.deepEqual(await read(savedMorning.id), savedMorning);
  await assert.rejects(write(work()), { code: 'P0002' });
  await assert.rejects(write({ ...morning, person_id: worker }), { code: 'P0002' });
  await assert.rejects(write({ action: 'remove', id: savedMorning.id }), { code: 'P0002' });
  await operation(org, employee, 'employee', { action: 'restore' });
  assert.equal(await write({ action: 'remove', id: savedMorning.id }), null);
  assert.equal(await write({ action: 'remove', id: savedMorning.id }), null);
  assert.equal(await read(savedMorning.id), undefined);

  await signIn(formerMember);
  assert.equal(await read(corrected.id), undefined);
  await assert.rejects(write(work()), { code: '42501' });
  await signIn(otherAdmin);
  assert.deepEqual(await read(otherEntry.id), otherEntry);
  assert.equal(await read(corrected.id), undefined);
  await db.exec('set role anon');
  await assert.rejects(read(otherEntry.id), { code: '42501' });
  await assert.rejects(write({ action: 'remove', id: otherEntry.id }, otherOrg), { code: '42501' });
});
