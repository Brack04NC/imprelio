import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

test('Il registro veicoli conserva lo storico e protegge i collegamenti aziendali', async t => {
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
  `);
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  const latest = '202611180016_registro_veicoli.sql';
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql') && name <= latest).sort()) {
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  }

  const [org, otherOrg, actor, member, inactive, vehicle, alternative, worker, material, foreignVehicle, foreignWorker, client, site, log] =
    Array.from({ length: 14 }, randomUUID);
  await db.query("insert into public.organizations values ($1,'Imprelio prova'),($2,'Impresa distinta')", [org, otherOrg]);
  await db.query("insert into auth.users values ($1,'staff@example.test',now()),($2,'altra@example.test',now()),($3,'inattivo@example.test',now())", [actor, member, inactive]);
  await db.query(`insert into public.organization_members values
    ($1,$3,'staff@example.test','coordinator',true),
    ($2,$4,'altra@example.test','admin',true),
    ($1,$5,'inattivo@example.test','coordinator',false)`, [org, otherOrg, actor, member, inactive]);
  await db.query("insert into public.clients (id,organization_id,name) values ($1,$2,'Cliente prova')", [client, org]);
  await db.query("insert into public.sites (id,organization_id,client_id,name,city,status) values ($1,$2,$3,'Progetto Roma','Roma','active')", [site, org, client]);
  await db.query(`insert into public.operation_records (id,organization_id,kind,title,status,fields,lines) values
    ($1,$8,'article','Camion','active','{"category":"vehicles"}','[]'),
    ($2,$8,'article','Secondo camion','active','{"category":"vehicles"}','[]'),
    ($3,$8,'worker','Mario Rossi','active','{}','[]'),
    ($4,$8,'article','Ponteggio','active','{"category":"materials"}','[]'),
    ($5,$9,'article','Mezzo altra impresa','active','{"category":"vehicles"}','[]'),
    ($6,$9,'employee','Operatore altra impresa','active','{}','[]'),
    ($7,$8,'crew','Squadra','active','{}','[]')`, [vehicle, alternative, worker, material, foreignVehicle, foreignWorker, randomUUID(), org, otherOrg]);
  await db.exec('set role authenticated');
  async function signIn(user) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  }
  await signIn(actor);
  const entry = {
    id: log, vehicle_id: vehicle, kind: 'usage', state: 'done', title: ' Consegna ponteggi ',
    start_date: '2026-04-09', end_date: '2026-04-11', operator_id: worker, site_id: site,
    location: 'Accesso nord', notes: 'Uso registrato dal caposquadra',
  };
  const save = (payload = entry, owner = org) => db.query('select public.imprelio_vehicle_log_save($1, $2) as entry', [owner, JSON.stringify(payload)])
    .then(result => result.rows[0].entry);
  const trash = (kind, id, operation) => db.query('select public.imprelio_trash_write($1,$2,$3,$4)', [org, kind, id, operation]);
  await assert.rejects(save(entry, otherOrg), { code: '42501' });
  await assert.rejects(save({ ...entry, vehicle_id: foreignVehicle }), { code: 'P0002' });
  await assert.rejects(save({ ...entry, vehicle_id: material }), { code: 'P0002' });
  await assert.rejects(save({ ...entry, operator_id: foreignWorker }), { code: '23503' });
  await assert.rejects(save({ ...entry, operator_id: material }), { code: '23503' });
  await assert.rejects(save({ ...entry, state: 'planned' }), { code: '22023' });
  await assert.rejects(save({ ...entry, end_date: '2095-01-01' }), { code: '22023' });
  await assert.rejects(save({ ...entry, start_date: '2026-13-01' }), { code: '22023' });
  await assert.rejects(save({ ...entry, start_date: '2026-04-12' }), { code: '22023' });
  await assert.rejects(save({ ...entry, operator_id: null }), { code: '22023' });
  await assert.rejects(save({ ...entry, site_id: null, location: '  ' }), { code: '22023' });
  await assert.rejects(save({ ...entry, title: 'a'.repeat(161) }), { code: '22023' });
  await assert.rejects(save({ ...entry, notes: 'a'.repeat(2001) }), { code: '22023' });

  const saved = await save({ ...entry, operator_name: 'Nome contraffatto', site_name: 'Sito contraffatto' });
  assert.equal(saved.title, 'Consegna ponteggi');
  assert.equal(saved.operator_name, 'Mario Rossi');
  assert.equal(saved.site_name, 'Progetto Roma');
  assert.deepEqual(await save(), saved);
  await assert.rejects(save({ ...entry, vehicle_id: alternative }), { code: 'P0002' });
  await assert.rejects(save({ ...entry, kind: 'extraordinary' }), { code: 'P0002' });
  await assert.rejects(db.query("update public.vehicle_log_entries set title = 'Modifica diretta' where id = $1", [log]), { code: '42501' });
  const future = await save({
    ...entry, id: randomUUID(), kind: 'extraordinary', state: 'planned', title: 'Intervento cambio',
    start_date: '2095-02-01', end_date: '2095-02-01', operator_id: null, site_id: null,
  });
  assert.equal(future.state, 'planned');
  assert.equal(future.operator_name, '');
  await assert.rejects(save({ ...future, state: 'done' }), { code: '22023' });

  await db.query('select public.imprelio_operation_write($1,$2)', [org, JSON.stringify({
    action: 'save', id: worker, kind: 'worker', title: 'Nome aggiornato', status: 'active', fields: {}, lines: [],
  })]);
  await db.query('select public.imprelio_write($1,$2)', [org, JSON.stringify({
    action: 'site', id: site, client_id: client, name: 'Progetto rinominato', city: 'Roma', address: '', manager: '', status: 'active',
  })]);
  await trash('operation', worker, 'delete');
  await trash('site', site, 'delete');
  const corrected = await save({ ...entry, notes: 'Correzione senza cambiare i riferimenti' });
  assert.equal(corrected.operator_name, 'Mario Rossi');
  assert.equal(corrected.site_name, 'Progetto Roma');
  await assert.rejects(save({ ...entry, id: randomUUID() }), { code: '23503' });
  await assert.rejects(save({ ...entry, id: randomUUID(), kind: 'maintenance', operator_id: null }), { code: '23503' });
  await db.query('select public.imprelio_operation_write($1,$2)', [org, JSON.stringify({
    action: 'archive', id: vehicle, kind: 'article',
  })]);
  assert.equal((await db.query('select id from public.vehicle_log_entries where id = $1', [log])).rows.length, 1);
  await assert.rejects(save(), { code: 'P0002' });
  await trash('operation', vehicle, 'delete');
  assert.deepEqual((await db.query('select id from public.vehicle_log_entries')).rows, []);
  await trash('operation', vehicle, 'restore');
  assert.equal((await db.query('select id from public.vehicle_log_entries where id = $1', [log])).rows.length, 1);

  await signIn(member);
  assert.deepEqual((await db.query('select id from public.vehicle_log_entries')).rows, []);
  await assert.rejects(save(), { code: '42501' });
  await signIn(inactive);
  assert.deepEqual((await db.query('select id from public.vehicle_log_entries')).rows, []);
  await assert.rejects(save(), { code: '42501' });
  await db.exec('set role anon');
  await assert.rejects(db.query('select id from public.vehicle_log_entries'), { code: '42501' });
  await assert.rejects(save(), { code: '42501' });
});
