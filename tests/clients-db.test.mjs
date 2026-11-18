import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Un cliente può avere più cantieri e ciascun collegamento resta nella propria azienda', async t => {
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
  const migrate = async path => db.exec(await readFile(new URL(`../supabase/migrations/${path}`, import.meta.url), 'utf8'));
  await migrate('202611180001_cantieri.sql');
  const [org, otherOrg, user, otherUser, legacy, client, firstSite, secondSite] = Array.from({ length: 8 }, randomUUID);
  await db.query("insert into auth.users values ($1, 'owner@example.test', now()), ($2, 'other@example.test', now())", [user, otherUser]);
  await db.query("insert into public.organizations values ($1, 'Impresa'), ($2, 'Altra impresa')", [org, otherOrg]);
  await db.query("insert into public.organization_members values ($1, $2, 'owner@example.test', 'coordinator', true), ($3, $4, 'other@example.test', 'admin', true)", [org, user, otherOrg, otherUser]);
  await db.query("insert into public.sites (id, organization_id, name, city, status) values ($1, $2, 'Già esistente', 'Milano', 'active')", [legacy, org]);
  await migrate('202611180003_clienti.sql');
  await db.exec('set role authenticated');
  const login = userId => db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  const directory = async tenant => (await db.query('select public.imprelio_client_directory($1) as value', [tenant])).rows[0].value;
  const writeClient = (tenant, profile) => db.query('select public.imprelio_client_write($1, $2)', [tenant, JSON.stringify(profile)]);
  const writeSite = (tenant, id, clientId) => db.query('select public.imprelio_write($1, $2)', [tenant, JSON.stringify({
    id, action: 'site', name: `Cantiere ${id}`, city: 'Milano', address: '', manager: '', status: 'active', client_id: clientId,
  })]);

  await login(user);
  await writeClient(org, { id: client, name: 'Edilizia Test', email: 'CANTIERI@example.test' });
  await assert.rejects(writeClient(org, { id: randomUUID(), name: 'edilizia test' }), { code: '23505' });
  await assert.rejects(writeSite(org, firstSite, null), { code: '23514' });
  await writeSite(org, firstSite, client);
  await writeSite(org, secondSite, client);
  await assert.rejects(writeSite(org, firstSite, null), { code: '23514' });
  const [profile] = await directory(org);
  assert.equal(profile.email, 'cantieri@example.test');
  assert.deepEqual(profile.sites.map(site => site.id), [secondSite, firstSite]);
  assert.equal((await db.query('select client_id from public.sites where id = $1', [legacy])).rows[0].client_id, null);

  await login(otherUser);
  assert.deepEqual(await directory(org), []);
  await assert.rejects(writeClient(org, { id: client, name: 'Intruso' }), { code: '42501' });
  await assert.rejects(writeSite(otherOrg, randomUUID(), client), { code: '23503' });
});
