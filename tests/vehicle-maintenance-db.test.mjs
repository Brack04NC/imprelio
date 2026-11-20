import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL preserva le assegnazioni esistenti e impedisce conflitti con la manutenzione', async t => {
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
  const migrate = async name => db.exec(await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
  for (const migration of ['202611180001_cantieri.sql', '202611180002_operativita.sql', '202611180005_assegnazioni_veicoli.sql']) {
    await migrate(migration);
  }

  const [org, otherOrg, member, otherMember, site, otherSite, vehicle, material, worker, legacyId, siteAssignmentId] =
    Array.from({ length: 11 }, randomUUID);
  await db.query("insert into public.organizations values ($1,'Prima'), ($2,'Seconda')", [org, otherOrg]);
  await db.query("insert into auth.users values ($1,'prima@example.test',now()), ($2,'seconda@example.test',now())", [member, otherMember]);
  await db.query(`
    insert into public.organization_members values
      ($1,$2,'prima@example.test','coordinator',true), ($3,$4,'seconda@example.test','admin',true)
  `, [org, member, otherOrg, otherMember]);
  await db.query(`
    insert into public.sites (id, organization_id, name, city, status)
    values ($1,$2,'Cantiere 1','Roma','active'), ($3,$4,'Cantiere 2','Milano','planned')
  `, [site, org, otherSite, otherOrg]);

  const signIn = async user => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  };
  const operation = (id, kind, fields = {}) => db.query('select public.imprelio_operation_write($1,$2)', [
    org, JSON.stringify({ action: 'save', id, kind, status: 'active', title: 'Scheda di prova', fields, lines: [] }),
  ]);
  const maintenance = (maintenance_from, maintenance_to) =>
    operation(vehicle, 'article', { category: 'vehicles', maintenance_from, maintenance_to });
  const vehicleRow = async () => (await db.query('select fields, status from public.operation_records where id = $1', [vehicle])).rows[0];
  const assign = async (input, organization = org) => (await db.query('select public.imprelio_vehicle_assignment_write($1,$2) as row', [
    organization, JSON.stringify({ action: 'save', vehicle_id: vehicle, ...input }),
  ])).rows[0].row;
  const assignmentRow = async id => (await db.query('select to_jsonb(assignment) as row from public.vehicle_assignments as assignment where id = $1', [id])).rows[0]?.row;
  const range = (start_date, end_date = start_date) => ({ start_date, end_date });
  const maintenanceConflict = { code: '23P01', message: /manutenzione/ };

  await signIn(member);
  await operation(vehicle, 'article', { category: 'vehicles' });
  await operation(worker, 'worker');
  const legacy = { id: legacyId, assignee_id: worker, periods: [range('2026-11-23', '2026-11-25')] };
  const previous = await assign(legacy);
  await db.exec('reset role');
  await migrate('202611180009_manutenzione_veicoli.sql');
  await signIn(member);
  assert.deepEqual(await assign(legacy), { ...previous, site_id: null });

  await assert.rejects(maintenance('2026-11-25', ''), { code: '22023' });
  await assert.rejects(maintenance('2026-2-23', '2026-02-28'), { code: '22023' });
  await assert.rejects(maintenance('2026-02-23', '2026-02-30'), { code: '22023' });
  await assert.rejects(maintenance('2026-11-27', '2026-11-26'), { code: '22023' });
  await assert.rejects(operation(material, 'article', {
    category: 'materials', maintenance_from: '2026-11-25', maintenance_to: '2026-11-26',
  }), { code: '22023' });
  await assert.rejects(maintenance('2026-11-25', '2026-11-26'), maintenanceConflict);
  assert.deepEqual(await vehicleRow(), { fields: { category: 'vehicles' }, status: 'active' });
  assert.deepEqual(await assignmentRow(legacyId), { ...previous, site_id: null });

  await maintenance('2026-11-26', '2026-11-27');
  assert.deepEqual(await vehicleRow(), {
    fields: { category: 'vehicles', maintenance_from: '2026-11-26', maintenance_to: '2026-11-27' },
    status: 'active',
  });
  const siteAssignment = { id: siteAssignmentId, assignee_id: null, site_id: site, periods: [range('2026-11-28')] };
  await assert.rejects(assign({ ...siteAssignment, site_id: otherSite }), { code: 'P0002' });
  await assert.rejects(assign({ ...siteAssignment, assignee_id: worker }), { code: '22023' });
  await assert.rejects(assign({ ...siteAssignment, site_id: null }), { code: '22023' });
  await assert.rejects(assign(siteAssignment, otherOrg), { code: '42501' });
  const directAssignment = await assign(siteAssignment);
  assert.deepEqual(directAssignment, await assign(siteAssignment));
  assert.equal(directAssignment.site_id, site);
  assert.equal(directAssignment.assignee_id, null);

  await assert.rejects(assign({
    ...siteAssignment, periods: [range('2026-11-22'), range('2026-11-27', '2026-11-28')],
  }), maintenanceConflict);
  assert.deepEqual(await assignmentRow(siteAssignmentId), directAssignment);
  await assert.rejects(assign({ ...legacy, periods: [range('2026-11-25', '2026-11-26')] }), maintenanceConflict);
  await assert.rejects(maintenance('2026-11-27', '2026-11-28'), maintenanceConflict);
  assert.equal((await vehicleRow()).fields.maintenance_from, '2026-11-26');

  await signIn(otherMember);
  assert.equal(await assignmentRow(siteAssignmentId), undefined);
  await signIn(member);
  await maintenance('', '');
  const moved = await assign({ ...siteAssignment, site_id: null, assignee_id: worker, periods: [range('2026-11-26')] });
  assert.equal(moved.site_id, null);
  assert.equal(moved.assignee_id, worker);
  assert.equal((await vehicleRow()).status, 'active');
});
