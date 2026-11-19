import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL salva periodi disgiunti, protegge le assegnazioni tra aziende e impedisce sovrapposizioni', async t => {
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
  for (const migration of ['202611180001_cantieri.sql', '202611180002_operativita.sql', '202611180005_assegnazioni_veicoli.sql']) {
    await db.exec(await readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
  }

  const [firstOrg, otherOrg, firstMember, otherMember, inactiveMember, vehicle, otherVehicle,
    material, inactiveVehicle, employee, externalCrew, otherWorker, firstBooking, anotherBooking, otherBooking] =
    Array.from({ length: 15 }, randomUUID);
  await db.query("insert into public.organizations values ($1,'Prima'), ($2,'Seconda')", [firstOrg, otherOrg]);
  await db.query("insert into auth.users values ($1,'coordinatore@example.test',now()), ($2,'altra@example.test',now()), ($3,'inattivo@example.test',now())", [firstMember, otherMember, inactiveMember]);
  await db.query(`
    insert into public.organization_members values
      ($1,$2,'coordinatore@example.test','coordinator',true),
      ($3,$4,'altra@example.test','admin',true),
      ($1,$5,'inattivo@example.test','coordinator',false)
  `, [firstOrg, firstMember, otherOrg, otherMember, inactiveMember]);

  const signIn = async user => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  };
  const associatedRecord = (org, id, kind, status, fields = {}) => db.query('select public.imprelio_operation_write($1,$2)', [
    org, JSON.stringify({ action: 'save', id, kind, status, title: 'Record di prova', fields, lines: [] }),
  ]);
  const assignment = async (org, input) => (await db.query('select public.imprelio_vehicle_assignment_write($1,$2) as record', [
    org, JSON.stringify(input),
  ])).rows[0].record;
  const saved = async () => (await db.query('select id, periods from public.vehicle_assignments order by id')).rows;
  const day = (start_date, end_date = start_date) => ({ start_date, end_date });
  const save = (id, periods, assigned = employee, selected = vehicle) =>
    ({ action: 'save', id, vehicle_id: selected, assignee_id: assigned, periods });

  await signIn(otherMember);
  await associatedRecord(otherOrg, otherVehicle, 'article', 'active', { category: 'vehicles' });
  await associatedRecord(otherOrg, otherWorker, 'worker', 'active');
  await assignment(otherOrg, save(otherBooking, [day('2026-11-21')], otherWorker, otherVehicle));

  await signIn(firstMember);
  assert.deepEqual(await saved(), []);
  await associatedRecord(firstOrg, vehicle, 'article', 'active', { category: 'vehicles' });
  await associatedRecord(firstOrg, material, 'article', 'active', { category: 'materials' });
  await associatedRecord(firstOrg, inactiveVehicle, 'article', 'inactive', { category: 'vehicles' });
  await associatedRecord(firstOrg, employee, 'employee', 'active');
  await associatedRecord(firstOrg, externalCrew, 'crew', 'available', { team_type: 'external' });

  await assert.rejects(assignment(otherOrg, save(firstBooking, [day('2026-11-23')])), { code: '42501' });
  await assert.rejects(assignment(firstOrg, save(firstBooking, [day('2026-11-23')], employee, otherVehicle)), { code: 'P0002' });
  await assert.rejects(assignment(firstOrg, save(firstBooking, [day('2026-11-23')], otherWorker)), { code: 'P0002' });
  await assert.rejects(assignment(firstOrg, save(firstBooking, [day('2026-11-23')], employee, material)), { code: 'P0002' });
  await assert.rejects(assignment(firstOrg, save(firstBooking, [day('2026-11-23')], employee, inactiveVehicle)), { code: 'P0002' });
  await assert.rejects(assignment(firstOrg, save(firstBooking, [day('2026-11-23')], material)), { code: 'P0002' });
  await assert.rejects(assignment(firstOrg, save(firstBooking, [])), { code: '22023' });
  await assert.rejects(assignment(firstOrg, save(firstBooking, [day('2026-02-30')])), { code: '22023' });
  await assert.rejects(assignment(firstOrg, save(firstBooking, [day('2026-11-26', '2026-11-25')])), { code: '22023' });
  await assert.rejects(assignment(firstOrg, save(firstBooking, [day('2026-11-21', '2026-11-22'), day('2026-11-22', '2026-11-23')])), { code: '23P01' });

  const firstPeriod = day('2026-11-21', '2026-11-22');
  const secondPeriod = day('2026-11-25');
  const created = await assignment(firstOrg, save(firstBooking, [secondPeriod, firstPeriod]));
  assert.equal(created.organization_id, firstOrg);
  assert.equal(created.vehicle_id, vehicle);
  assert.deepEqual(await assignment(firstOrg, save(firstBooking, [firstPeriod, secondPeriod])), created);
  assert.deepEqual(await saved(), [{ id: firstBooking, periods: [firstPeriod, secondPeriod] }]);
  await assert.rejects(assignment(firstOrg, save(anotherBooking, [day('2026-11-22')], externalCrew)), { code: '23P01' });
  await assignment(firstOrg, save(anotherBooking, [day('2026-11-23', '2026-11-24')], externalCrew));
  await assert.rejects(assignment(firstOrg, save(firstBooking, [day('2026-11-22', '2026-11-24')])), { code: '23P01' });
  assert.deepEqual((await saved()).find(row => row.id === firstBooking).periods, [firstPeriod, secondPeriod]);
  await assert.rejects(db.query('delete from public.vehicle_assignments'), { code: '42501' });

  await assignment(firstOrg, { action: 'remove', id: otherBooking });
  await signIn(otherMember);
  assert.deepEqual((await saved()).map(row => row.id), [otherBooking]);
  await signIn(inactiveMember);
  assert.deepEqual(await saved(), []);
  await assert.rejects(assignment(firstOrg, { action: 'remove', id: firstBooking }), { code: '42501' });
  await db.exec('set role anon');
  await assert.rejects(saved(), { code: '42501' });
  await assert.rejects(assignment(firstOrg, save(firstBooking, [firstPeriod])), { code: '42501' });

  await signIn(firstMember);
  await db.query('select public.imprelio_operation_write($1,$2)', [
    firstOrg, JSON.stringify({ action: 'archive', kind: 'crew', id: externalCrew }),
  ]);
  assert.equal((await saved()).length, 2);
  await assert.rejects(assignment(firstOrg, save(anotherBooking, [day('2026-11-23')], externalCrew)), { code: 'P0002' });
  assert.equal(await assignment(firstOrg, { action: 'remove', id: anotherBooking }), null);
  await assignment(firstOrg, { action: 'remove', id: anotherBooking });
  await assignment(firstOrg, save(firstBooking, [day('2026-11-22', '2026-11-24')]));
  assert.deepEqual(await saved(), [{ id: firstBooking, periods: [day('2026-11-22', '2026-11-24')] }]);
});
