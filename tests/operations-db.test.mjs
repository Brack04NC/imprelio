import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL protegge le schede operative e mantiene coerenti i movimenti di magazzino', async t => {
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
  for (const migration of ['202611180001_cantieri.sql', '202611180002_operativita.sql']) {
    await db.exec(await readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
  }
  const [orgA, orgB, admin, coordinator, stranger, siteA, siteB, articleA, articleB, otherArticle, inbound, outbound] =
    Array.from({ length: 12 }, randomUUID);
  await db.query("insert into public.organizations values ($1, 'Alpha'), ($2, 'Beta')", [orgA, orgB]);
  await db.query("insert into auth.users values ($1, 'admin@example.test', now()), ($2, 'coordinator@example.test', now()), ($3, 'stranger@example.test', now())", [admin, coordinator, stranger]);
  await db.query(`
    insert into public.organization_members values
      ($1, $2, 'admin@example.test', 'admin', true),
      ($1, $3, 'coordinator@example.test', 'coordinator', true),
      ($4, $5, 'stranger@example.test', 'admin', true)
  `, [orgA, admin, coordinator, orgB, stranger]);
  await db.query(`
    insert into public.sites (id, organization_id, name, city, status) values
      ($1, $2, 'Cantiere Alpha', 'Milano', 'active'), ($3, $4, 'Cantiere Beta', 'Roma', 'active')
  `, [siteA, orgA, siteB, orgB]);

  const signIn = async user => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  };
  const write = (org, payload) => db.query('select public.imprelio_operation_write($1, $2)', [org, JSON.stringify(payload)]);
  const record = (id, kind, fields = {}) => ({
    id, kind, action: 'save', title: 'Scheda di prova', status: 'active', site_id: null,
    record_date: '2026-11-18', fields, lines: [],
  });
  const movement = (id, article_id, direction, quantity) => ({
    ...record(id, 'movement', { article_id, direction, quantity }), status: 'recorded', site_id: siteA,
  });
  const archive = (id, kind) => write(orgA, { action: 'archive', id, kind });
  const restore = (id, kind) => write(orgA, { action: 'restore', id, kind });
  const balance = async article => (await db.query(`
    select coalesce(sum((case when fields->>'direction' = 'in' then 1 else -1 end) * (fields->>'quantity')::numeric), 0) as quantity
    from public.operation_records
    where kind = 'movement' and not archived and fields->>'article_id' = $1
  `, [article])).rows[0].quantity;
  const shortage = { code: 'P0001', message: 'Stock insufficiente' };

  await signIn(stranger);
  await write(orgB, record(otherArticle, 'article'));
  await signIn(coordinator);
  await assert.rejects(write(orgB, record(randomUUID(), 'article')), { code: '42501' });
  await assert.rejects(write(orgA, record(otherArticle, 'article')), { code: 'P0002' });
  await assert.rejects(db.query('delete from public.operation_records'), { code: '42501' });

  await write(orgA, record(articleA, 'article'));
  await write(orgA, record(articleB, 'article'));
  await assert.rejects(write(orgA, movement(inbound, otherArticle, 'in', '12.345')), { code: 'P0002' });
  await assert.rejects(write(orgA, movement(inbound, articleA, 'in', '12.3456')), { code: '22023' });
  await assert.rejects(write(orgA, movement(inbound, articleA, 'in', '0')), { code: '22023' });
  await assert.rejects(write(orgA, { ...record(randomUUID(), 'invoice'), status: 'draft', lines: [{ description: 'Voce' }], site_id: siteB }), { code: '23503' });
  await assert.rejects(write(orgA, { ...record(randomUUID(), 'employee'), record_date: '2026-02-30' }), { code: '22023' });
  await assert.rejects(write(orgA, { ...record(randomUUID(), 'estimate'), lines: [null] }), { code: '22023' });
  await assert.rejects(write(orgA, record(randomUUID(), 'invoice', { invalid: 123 })), { code: '22023' });

  await write(orgA, movement(inbound, articleA.toUpperCase(), 'in', '12.345'));
  await write(orgA, movement(inbound, articleA, 'in', '12.345'));
  await write(orgA, movement(outbound, articleA, 'out', '2.345'));
  assert.equal(await balance(articleA), '10.000');
  await assert.rejects(write(orgA, movement(outbound, articleA, 'out', '12.346')), shortage);
  await assert.rejects(write(orgA, movement(inbound, articleB, 'in', '12.345')), shortage);
  await assert.rejects(archive(inbound, 'movement'), shortage);
  await assert.rejects(archive(articleA, 'article'), { code: 'P0001', message: 'Articolo con movimenti attivi' });
  assert.equal(await balance(articleA), '10.000');

  await archive(outbound, 'movement');
  await archive(outbound, 'movement');
  await archive(inbound, 'movement');
  await archive(articleA, 'article');
  await assert.rejects(restore(outbound, 'movement'), { code: 'P0002' });
  await restore(articleA, 'article');
  await assert.rejects(restore(outbound, 'movement'), shortage);
  await restore(inbound, 'movement');
  await restore(outbound, 'movement');
  assert.equal(await balance(articleA), '10.000');

  const estimate = {
    ...record(randomUUID(), 'estimate', { currency: 'EUR' }),
    status: 'draft', site_id: siteA,
    lines: [{ description: 'Montaggio ponteggio', quantity: '10', unit_price: '18.50' }],
  };
  await assert.rejects(write(orgA, { ...estimate, site_id: null }), { code: '22023' });
  await write(orgA, estimate);
  const read = id => db.query('select id, lines from public.operation_records where id = $1', [id]);
  assert.deepEqual((await read(estimate.id)).rows[0].lines, estimate.lines);

  await signIn(stranger);
  assert.deepEqual((await read(estimate.id)).rows, []);
  await assert.rejects(write(orgB, { action: 'archive', id: estimate.id, kind: 'estimate' }), { code: 'P0002' });
  await signIn(admin);
  await db.query('select public.imprelio_write($1, $2)', [orgA, JSON.stringify({ action: 'member', id: coordinator, active: false })]);
  await signIn(coordinator);
  assert.deepEqual((await read(estimate.id)).rows, []);
  await assert.rejects(write(orgA, estimate), { code: '42501' });
  await db.exec('set role anon');
  await assert.rejects(read(estimate.id), { code: '42501' });
  await assert.rejects(write(orgA, estimate), { code: '42501' });
});
