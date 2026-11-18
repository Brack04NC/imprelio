import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { demoSeed, demoWorkspace, updateDemo } from '../lib/demo.ts';
import { parseWorkspaceParams, plusDays, romeDate } from '../lib/domain.ts';

const initialFilter = { q: '', status: 'all', page: 1, siteId: null };
const sampleDay = '2026-11-18';

test('Le scadenze cambiano giorno all’orario di Roma', () => {
  assert.equal(romeDate(new Date('2026-07-20T22:15:00Z')), '2026-07-21');
  assert.equal(romeDate(new Date('2026-11-18T22:15:00Z')), '2026-11-18');
});

test('Ricerca per cliente, paginazione e filtri di stato', () => {
  const store = demoSeed(sampleDay);
  assert.equal(demoWorkspace(store, { ...initialFilter, q: 'armonIA' }, sampleDay).rows[0].name, 'Corte San Marco');
  assert.equal(demoWorkspace(store, { ...initialFilter, status: 'active' }, sampleDay).total, 4);
  assert.equal(demoWorkspace(store, { ...initialFilter, page: 2 }, sampleDay).rows.length, 2);
  assert.deepEqual(parseWorkspaceParams(new URLSearchParams('stato=unknown&pagina=-1&cantiere=no')), initialFilter);
});

test('Completamento e riprogrammazione agiscono sulle singole zone', () => {
  let store = demoSeed(sampleDay);
  const overview = demoWorkspace(store, initialFilter, sampleDay);
  const north = store.jobs.find(job => job.zone === 'Facciata nord' && job.due_date === sampleDay);
  const south = store.jobs.find(job => job.site_id === north.site_id && job.zone === 'Facciata sud');
  store = updateDemo(store, { action: 'jobStatus', id: north.id, site_id: north.site_id, status: 'done' });
  store = updateDemo(store, { ...south, action: 'job', due_date: plusDays(sampleDay, 3) });
  const result = demoWorkspace(store, { ...initialFilter, siteId: north.site_id }, sampleDay);
  assert.equal(result.counts.today, overview.counts.today - 1);
  assert.equal(result.current.jobs.find(job => job.id === north.id).status, 'done');
  assert.equal(result.current.jobs.find(job => job.id === south.id).due_date, '2026-11-21');
  assert.equal(result.current.site.nextJob.id, south.id);
});

test('PostgreSQL isola aziende e permessi e rende ripetibili gli invii', async t => {
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
  await db.exec(await readFile(new URL('../supabase/migrations/202611180001_cantieri.sql', import.meta.url), 'utf8'));
  const [admin, stranger, coordinator, siteA, siteB, jobA, jobB] = Array.from({ length: 7 }, randomUUID);
  await db.query(`insert into auth.users values ($1, 'admin@example.test', now()), ($2, 'stranger@example.test', now()), ($3, 'new@example.test', null)`, [admin, stranger, coordinator]);
  const bootstrap = await readFile(new URL('../supabase/bootstrap-admin.sql', import.meta.url), 'utf8');
  const initialize = (email, company) => db.exec(bootstrap
    .replace("'amministratore@example.com'", `'${email}'`).replace("'Imprelio'", `'${company}'`));
  await assert.rejects(initialize('new@example.test', 'Alpha'), { code: 'P0002' });
  await initialize('admin@example.test', 'Alpha');
  await initialize('admin@example.test', 'Alpha');
  await assert.rejects(initialize('stranger@example.test', 'Alpha'), { code: 'P0001' });
  await initialize('stranger@example.test', 'Beta');
  const companies = (await db.query('select id, name from organizations order by name')).rows;
  assert.deepEqual(companies.map(company => company.name), ['Alpha', 'Beta']);
  const [{ id: orgA }, { id: orgB }] = companies;
  const login = async user => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  };
  const write = (org, action) => db.query('select imprelio_write($1, $2)', [org, JSON.stringify(action)]);
  const snapshot = async (org, selected = null, query = '') => (await db.query(
    'select imprelio_workspace($1, $2, $3, $4, $5) as result', [org, query, 'all', 1, selected],
  )).rows[0].result;
  const newSite = (id, name) => ({ id, action: 'site', name, city: 'Milano', address: '', manager: '', status: 'active', new_client: 'Edilizia Test', client_id: null });
  const newJob = (id, site_id, due_date) => ({ id, site_id, action: 'job', kind: 'assembly', zone: 'Nord', due_date, time: '08:00', notes: '', status: 'scheduled' });

  await login(admin);
  await write(orgA, newSite(siteA, 'Cantiere Alpha'));
  await write(orgA, newSite(siteA, 'Cantiere Alpha'));
  await write(orgA, newJob(jobA, siteA, plusDays(romeDate(), -1)));
  const alpha = await snapshot(orgA, siteA, 'edilizia');
  assert.equal(alpha.total, 1);
  assert.equal(alpha.clients.length, 1);
  assert.equal(alpha.current.site.code, 'CAN-001');
  assert.equal(alpha.current.jobs.length, 1);
  assert.equal(alpha.counts.overdue, 1);
  await write(orgA, { action: 'invite', email: 'new@example.test' });

  await login(stranger);
  await write(orgB, newSite(siteB, 'Cantiere Beta'));
  await write(orgB, newJob(jobB, siteB, romeDate()));
  assert.equal((await snapshot(orgA, siteA)).current, null);
  assert.equal((await snapshot(orgA)).clients.length, 0);
  assert.equal((await db.query('select id from sites')).rows.length, 1);
  await assert.rejects(write(orgA, newSite(siteA, 'Incrocio')), { code: '42501' });
  await assert.rejects(write(orgB, newJob(randomUUID(), siteA, romeDate())), { code: '23503' });
  await assert.rejects(write(orgB, newJob(jobA, siteB, romeDate())), { code: 'P0002' });
  await assert.rejects(write(orgB, { ...newSite(siteB, 'Incrocio'), new_client: '', client_id: alpha.clients[0].id }), { code: '23503' });

  await login(coordinator);
  await db.exec('select public.claim_imprelio_invitations()');
  assert.equal((await snapshot(orgA)).total, 0);
  await db.exec('reset role');
  await db.query('update auth.users set email_confirmed_at = now() where id = $1', [coordinator]);
  await login(coordinator);
  await db.exec('select public.claim_imprelio_invitations()');
  await assert.rejects(write(orgA, { action: 'invite', email: 'other@example.test' }), { code: '42501' });
  await write(orgA, { ...newJob(jobA, siteA, plusDays(romeDate(), -1)), status: 'done' });
  assert.equal((await snapshot(orgA, siteA)).counts.overdue, 0);
  assert.equal((await snapshot(orgA, siteA)).current.jobs[0].status, 'done');
  assert.equal((await snapshot(orgB)).rows.length, 0);

  await login(admin);
  assert.equal((await snapshot(orgA, siteA)).current.jobs[0].status, 'done');
  await write(orgA, { action: 'member', id: coordinator, active: false });
  await login(coordinator);
  assert.equal((await snapshot(orgA)).total, 0);
  await assert.rejects(write(orgA, newSite(siteA, 'Disattivato')), { code: '42501' });

  await db.exec('set role anon');
  await assert.rejects(snapshot(orgA), { code: '42501' });
});
