import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { openReferenceSchema } from '../scripts/schema-di-riferimento.mjs';

test('I veicoli sono singoli mezzi e i vecchi movimenti restano consultabili nello storico', async t => {
  const db = await openReferenceSchema('202611180019');
  t.after(() => db.close());
  const [org, actor, vehicle, archivedVehicle, trashedVehicle, material, worker, activeLegacy, deletedLegacy, load, newVehicle, assignment] =
    Array.from({ length: 12 }, randomUUID);
  await db.query("insert into public.organizations values ($1, 'Impresa test')", [org]);
  await db.query("insert into auth.users values ($1, 'coordinatore@example.test', now())", [actor]);
  await db.query("insert into public.organization_members values ($1,$2,'coordinatore@example.test','coordinator',true)", [org, actor]);

  async function signIn() {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
  }
  const write = payload => db.query('select public.imprelio_operation_write($1,$2)', [org, JSON.stringify(payload)]);
  const article = (id, fields) => write({ action: 'save', id, kind: 'article', title: 'Scheda mezzo o articolo',
    status: 'active', lines: [], fields });
  const movement = (id, article_id, quantity = '10') => write({ action: 'save', id, kind: 'movement', title: 'Carico tracciato',
    status: 'recorded', record_date: '2026-10-31', lines: [], fields: { article_id, direction: 'in', quantity } });
  const action = (id, kind, status) => write({ action: status, kind, id });
  const trash = (target, operation) => db.query("select public.imprelio_trash_write($1,'operation',$2,$3)", [org, target, operation]);
  const row = id => db.query('select archived, fields, updated_at, record_date from public.operation_records where id=$1', [id])
    .then(result => result.rows[0]);

  await signIn();
  const oldFields = { category: 'vehicles', unit: 'pz', stock_min: '2', plate: 'AA123BC', location: 'Deposito', notes: 'Mezzo con gru' };
  const { unit: _, stock_min: __, ...vehicleFields } = oldFields;
  await article(vehicle, oldFields);
  await article(archivedVehicle, oldFields);
  await action(archivedVehicle, 'article', 'archive');
  await article(trashedVehicle, oldFields);
  await trash(trashedVehicle, 'delete');
  await article(material, { category: 'materials', unit: 'pz', stock_min: '1' });
  await write({ action: 'save', id: worker, kind: 'worker', title: 'Operatore prova', status: 'active', lines: [], fields: {} });
  await db.query('select public.imprelio_vehicle_assignment_write($1,$2)', [org, JSON.stringify({
    action: 'save', id: assignment, vehicle_id: vehicle, assignee_id: worker, site_id: null,
    periods: [{ start_date: '2026-11-21', end_date: '2026-11-22' }],
  })]);
  await movement(activeLegacy, vehicle, '3');
  await movement(deletedLegacy, vehicle, '1');
  await trash(deletedLegacy, 'delete');
  await movement(load, material, '7');
  const beforeVehicle = await row(vehicle);
  const beforeArchive = await row(archivedVehicle);
  const beforeMovement = await row(activeLegacy);
  const beforeMaterial = await row(material);

  await db.exec('reset role');
  const migration = new URL('../supabase/migrations/202611180020_veicoli_senza_giacenza.sql', import.meta.url);
  await db.exec(await readFile(migration, 'utf8'));

  await signIn();
  assert.deepEqual(await row(vehicle), { ...beforeVehicle, fields: vehicleFields });
  assert.deepEqual(await row(archivedVehicle), { ...beforeArchive, fields: vehicleFields });
  assert.equal(await row(trashedVehicle), undefined);
  await trash(trashedVehicle, 'restore');
  assert.deepEqual((await row(trashedVehicle)).fields, vehicleFields);
  assert.deepEqual(await row(activeLegacy), { ...beforeMovement, archived: true });
  assert.deepEqual(await row(material), beforeMaterial);
  assert.equal((await row(load)).archived, false);
  assert.equal((await db.query('select id from public.vehicle_assignments where vehicle_id=$1', [vehicle])).rows[0].id, assignment);

  const forbiddenMovement = { code: 'P0001', message: 'I veicoli non hanno movimenti di magazzino' };
  await assert.rejects(movement(randomUUID(), vehicle), forbiddenMovement);
  await assert.rejects(action(activeLegacy, 'movement', 'restore'), forbiddenMovement);
  await trash(deletedLegacy, 'restore');
  assert.equal((await row(deletedLegacy)).archived, true);

  await action(vehicle, 'article', 'archive');
  await action(vehicle, 'article', 'restore');
  await trash(vehicle, 'delete');
  await trash(vehicle, 'restore');
  assert.equal((await row(vehicle)).archived, false);
  await article(newVehicle, oldFields);
  assert.deepEqual((await row(newVehicle)).fields, vehicleFields);
  await assert.rejects(movement(load, newVehicle), forbiddenMovement);
  assert.equal((await row(load)).fields.article_id, material);

  await assert.rejects(article(material, oldFields), { code: 'P0001', message: 'Conversione in veicolo con movimenti attivi' });
  await action(load, 'movement', 'archive');
  await action(load, 'movement', 'restore');
  assert.equal((await row(load)).archived, false);
  await trash(load, 'delete');
  await article(material, oldFields);
  await trash(load, 'restore');
  assert.equal((await row(load)).archived, true);
  assert.deepEqual((await row(material)).fields, vehicleFields);
});
