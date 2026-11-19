import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL protegge conti e movimenti, verifica date e importi in centesimi e conserva gli annullamenti', async t => {
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
    grant usage on schema auth to anon, authenticated;
  `);
  for (const migration of ['202611180001_cantieri.sql', '202611180007_contabilita.sql']) {
    await db.exec(await readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
  }
  const [org, otherOrg, coordinator, otherUser, inactiveUser, site, otherSite, account, otherAccount, entry, outgoing] =
    Array.from({ length: 11 }, randomUUID);
  await db.query("insert into public.organizations values ($1,'Prima'), ($2,'Seconda')", [org, otherOrg]);
  await db.query("insert into auth.users values ($1,'coordinatore@example.test',now()), ($2,'altra@example.test',now()), ($3,'inattivo@example.test',now())", [coordinator, otherUser, inactiveUser]);
  await db.query(`
    insert into public.organization_members values
      ($1,$2,'coordinatore@example.test','coordinator',true),
      ($3,$4,'altra@example.test','admin',true),
      ($1,$5,'inattivo@example.test','coordinator',false)
  `, [org, coordinator, otherOrg, otherUser, inactiveUser]);
  await db.query(`
    insert into public.sites (organization_id, id, name, city, status) values
      ($1,$2,'Prima commessa','Roma','active'), ($3,$4,'Riservata','Milano','active')
  `, [org, site, otherOrg, otherSite]);

  const signIn = async user => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  };
  const write = async (company, action) => (
    await db.query('select public.imprelio_finance_write($1,$2) as saved', [company, JSON.stringify(action)])
  ).rows[0].saved;
  const accountInput = (id, changes = {}) => ({
    action: 'save_account', id, name: 'Conto corrente', opening_date: '2026-11-01', opening_cents: '-10025', ...changes,
  });
  const entryInput = (id, changes = {}) => ({
    action: 'save_entry', id, account_id: account, site_id: site, record_date: '2026-11-01',
    description: 'Acconto', direction: 'in', amount_cents: '14235', reference: 'F-12', ...changes,
  });
  const rows = async table => (await db.query('select id from public.' + table + ' order by id')).rows;
  const balance = async () => (
    await db.query(`
      select (a.opening_cents + coalesce(sum(case e.direction when 'in' then e.amount_cents else -e.amount_cents end),0))::text as cents
      from public.financial_accounts as a left join public.financial_entries as e
        on a.organization_id = e.organization_id and a.id = e.account_id and not e.voided
      where a.organization_id = $1 and a.id = $2 group by a.opening_cents
    `, [org, account])
  ).rows[0].cents;

  await signIn(otherUser);
  await write(otherOrg, accountInput(otherAccount));
  await signIn(coordinator);
  assert.deepEqual(await rows('financial_accounts'), []);
  await assert.rejects(write(otherOrg, accountInput(account)), { code: '42501' });
  await assert.rejects(write(org, accountInput(account, { opening_cents: '-1000000000000' })), { code: '22023' });
  await assert.rejects(write(org, accountInput(account, { opening_date: '2026-02-29' })), { code: '22023' });
  await assert.rejects(write(org, accountInput(account, { name: '\t\n' })), { code: '22023' });
  const createdAccount = await write(org, accountInput(account));
  assert.equal(createdAccount.opening_cents, '-10025');
  await assert.rejects(write(org, accountInput(randomUUID(), { name: 'CONTO CORRENTE' })), { code: '23505' });
  assert.equal(typeof createdAccount.updated_at, 'string');
  assert.deepEqual(await write(org, accountInput(account, { opening_cents: -10025 })), createdAccount);
  assert.deepEqual(await rows('financial_accounts'), [{ id: account }]);
  assert.equal(await balance(), '-10025');

  await assert.rejects(write(org, entryInput(entry, { account_id: otherAccount })), { code: 'P0002' });
  await assert.rejects(write(org, entryInput(entry, { site_id: otherSite })), { code: '23503' });
  await assert.rejects(write(org, entryInput(entry, { record_date: '2026-10-31' })), { code: '22023' });
  for (const amount_cents of ['1.2', '1000000000000', '0', '-5']) {
    await assert.rejects(write(org, entryInput(entry, { amount_cents })), { code: '22023' });
  }
  await assert.rejects(write(org, entryInput(entry, { description: 'x'.repeat(251) })), { code: '22023' });
  await assert.rejects(write(org, entryInput(entry, { reference: 'x'.repeat(101) })), { code: '22023' });
  const createdEntry = await write(org, entryInput(entry));
  assert.equal(createdEntry.amount_cents, '14235');
  assert.equal(createdEntry.site_id, site);
  assert.equal(createdEntry.voided, false);
  assert.deepEqual(await write(org, entryInput(entry)), createdEntry);
  assert.equal(await balance(), '4210');
  await assert.rejects(write(org, accountInput(account, { opening_date: '2026-11-02' })), { code: '22023' });

  const payment = entryInput(outgoing, {
    site_id: null, record_date: '2026-11-03', amount_cents: 15, description: 'Spesa', direction: 'out', reference: '',
  });
  await write(org, payment);
  assert.equal(await balance(), '4195');
  await write(org, { ...payment, amount_cents: '25' });
  assert.equal(await balance(), '4185');
  await assert.rejects(db.query('delete from public.financial_entries'), { code: '42501' });
  await assert.rejects(db.query('update public.financial_accounts set opening_cents = 0'), { code: '42501' });

  const voidAction = { action: 'void_entry', id: entry };
  const voided = await write(org, voidAction);
  assert.equal(voided.voided, true);
  assert.equal(voided.amount_cents, '14235');
  assert.deepEqual(await write(org, voidAction), voided);
  await assert.rejects(write(org, entryInput(entry)), { code: 'P0002' });
  assert.equal(await balance(), '-10050');
  await write(org, accountInput(account, { opening_date: '2026-11-02' }));
  await assert.rejects(write(org, entryInput(entry)), { code: 'P0002' });
  await assert.rejects(write(org, accountInput(account, { opening_date: '2026-11-04' })), { code: '22023' });
  assert.equal((await rows('financial_entries')).length, 2);

  await signIn(otherUser);
  assert.deepEqual(await rows('financial_entries'), []);
  await assert.rejects(write(otherOrg, voidAction), { code: 'P0002' });
  await signIn(inactiveUser);
  assert.deepEqual(await rows('financial_accounts'), []);
  await assert.rejects(write(org, voidAction), { code: '42501' });
  await db.exec('set role anon');
  await assert.rejects(rows('financial_entries'), { code: '42501' });
  await assert.rejects(write(org, voidAction), { code: '42501' });
});
