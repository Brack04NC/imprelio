import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { estimateImportWarnings, readEstimatePages, unitFromSubtotal } from '../lib/estimate-import.ts';
import { duplicateEstimateCodes, itemBilling, matchEstimateRate, quoteLineSchema, quoteLineTextSchema, rateSchema,
  reviseQuoteLineText, sourceAmountDisagrees } from '../lib/estimate-pricing.ts';
import { documentLineTotal } from '../lib/operation-documents.ts';

const item = { title: 'Allestimento di ponteggi', description: 'Montaggio, smontaggio e un mese di noleggio incluso.',
  page: 1, reference: '1', code: 'PON.01', quantity: '1900', unit: 'mq', sourcePrice: '19', sourceTotal: '36100' };
const rate = rateSchema.parse({ id: randomUUID(), label: 'Ponteggio primo mese', code: '', phrase: 'ponteggio',
  unit: 'm²', kind: 'rental', months: 1, price: '12' });

test('Il listino applica 12 €/m² soltanto alle voci compatibili con il noleggio di un mese', () => {
  assert.equal(matchEstimateRate(item, [rate]).rate?.price, '12');
  assert.equal(documentLineTotal('estimate', { quantity: item.quantity, unit_price: rate.price }), 2_280_000n);
  assert.equal(matchEstimateRate({ ...item, description: 'Nolo fino a 6 mesi.' }, [rate]).rate, null);
  assert.equal(matchEstimateRate({ ...item, description: 'Nolo da 1 a 6 mesi.' }, [rate]).rate, null);
  assert.equal(matchEstimateRate({ ...item, description: 'Noleggio per più di un mese.' }, [rate]).rate, null);
  assert.equal(matchEstimateRate({ ...item, description: 'Noleggio escluso. Durata prevista di un mese.' }, [rate]).rate, null);
  assert.equal(matchEstimateRate({ ...item, unit: 'm³' }, [rate]).rate, null);
  assert.equal(matchEstimateRate(item, [rate, { ...rate, id: randomUUID(), price: '14' }]).rate, null);
  assert.deepEqual(itemBilling({ ...item, title: 'Ponteggio per ogni mese successivo' }), { kind: 'extension', months: null });
  const codeOnly = { ...rate, phrase: '', code: item.code };
  assert.equal(matchEstimateRate(item, [codeOnly], duplicateEstimateCodes([item, { ...item, reference: '2' }])).rate, null);
});

test('I testi del preventivo cambiano senza modificare la corrispondenza al listino', () => {
  assert.equal(quoteLineTextSchema.safeParse({ title: '   ', description: '' }).success, false);
  const edited = { ...item, ...reviseQuoteLineText(item, { title: 'Opere provvisionali', description: 'Prima riga\nSeconda riga' }), price: '12' };
  const reopened = quoteLineSchema.parse(JSON.parse(JSON.stringify(edited)));
  assert.equal(reopened.title, 'Opere provvisionali');
  assert.equal(reopened.description, 'Prima riga\nSeconda riga');
  assert.equal(reopened.sourceTitle, item.title);
  assert.equal(reopened.sourceDescription, item.description);
  assert.equal(matchEstimateRate(reopened, [rate]).rate?.price, '12');
  assert.deepEqual(itemBilling(reopened), { kind: 'rental', months: 1 });

  const updated = { ...reopened, ...reviseQuoteLineText(reopened, { title: item.title, description: '' }) };
  assert.equal(quoteLineSchema.parse(updated).description, '');
  assert.equal(updated.sourceTitle, undefined);
  assert.equal(updated.sourceDescription, item.description);
  assert.equal(matchEstimateRate(updated, [rate]).rate?.price, '12');
});

test('Il lettore distingue quantità, prezzo unitario e importo e gestisce le unità unite al testo', () => {
  const i = (text, x, y, width = 30) => ({ text, x, y, width });
  const pages = [
    { number: 1, items: [
      i("d'ordine", 38, 768), i('Quantità', 412, 774), i('Unitario', 461, 763), i('Totale', 519, 763),
      i('Nr. 1', 47, 660), i('PON.01', 79, 660), i('Allestimento ponteggi', 79, 640),
      i('Nolo per il primo mese', 79, 630), i('Sommano mq', 170, 602),
      i('1.900,000', 415, 602), i('19,00', 469, 602), i('36.100,00', 501, 605),
    ] },
    { number: 2, items: [
      i('Nome', 42, 700), i('Quantità', 313, 700), i('unitario', 373, 700), i('Totale', 543, 713),
      i('2 Allestimento di ponteggi', 42, 660), i('Nolo fino a 6 mesi.', 42, 648), i('1008.00', 315, 645),
      i('11,20*2,00SOMMANO...MQ', 42, 622), i('2', 578, 51),
    ] },
  ];
  const rows = readEstimatePages(pages);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.quantity, row.unit, row.sourcePrice, row.sourceTotal]), [
    ['1900', 'm²', '19', '36100'], ['1008', 'm²', '', ''],
  ]);
  assert.equal(itemBilling(rows[1]).months, 6);
  assert.equal(unitFromSubtotal('Sommano m² / mese'), 'm²/mese');
  assert.equal(unitFromSubtotal('Sommano metri quadrati'), 'm²');
  assert.equal(unitFromSubtotal('Sommano m 2'), 'm²');
  assert.equal(sourceAmountDisagrees(item), false);
  assert.equal(sourceAmountDisagrees({ ...item, quantity: '1.9' }), true);
  assert.deepEqual(estimateImportWarnings(pages, rows), []);
  assert.deepEqual(estimateImportWarnings([...pages, { number: 3, items: [] }], rows), ['Pagine senza tabella riconosciuta: 3.']);
});

test('Listini e preventivi sono isolati per azienda, anche nei collegamenti al cantiere', async t => {
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
  for (const migration of ['202611180001_cantieri.sql', '202611180004_preventivi_da_computo.sql']) {
    await db.exec(await readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
  }
  const [first, second, admin, outsiders, firstSite, secondSite, quote] = Array.from({ length: 7 }, randomUUID);
  await db.query("insert into public.organizations values ($1, 'Prima'), ($2, 'Seconda')", [first, second]);
  await db.query("insert into auth.users values ($1, 'prima@example.test', now()), ($2, 'seconda@example.test', now())", [admin, outsiders]);
  await db.query("insert into public.organization_members values ($1, $2, 'prima@example.test', 'admin', true), ($3, $4, 'seconda@example.test', 'admin', true)", [first, admin, second, outsiders]);
  await db.query("insert into public.sites (id, organization_id, name, city, status) values ($1, $2, 'A', 'Roma', 'active'), ($3, $4, 'B', 'Roma', 'active')", [firstSite, first, secondSite, second]);
  async function signIn(user) {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  }
  await signIn(admin);
  await db.query("insert into public.estimate_rates values ($1, $2, 'Ponteggio', '', 'ponteggio', 'm²', 'rental', 1, '12')", [first, rate.id]);
  const saveQuote = (site, lines) => db.query(
    "insert into public.estimate_quotes (organization_id,id,site_id,title,source_name,lines) values ($1,$2,$3,'Preventivo','Computo.pdf',$4)",
    [first, quote, site, JSON.stringify(lines)]);
  const line = { ...item, unit: 'm²', price: '12' };
  await assert.rejects(saveQuote(secondSite, [line]), { code: '23503' });
  await assert.rejects(saveQuote(firstSite, [{ ...line, price: 'x' }]), { code: '23514' });
  const edited = quoteLineSchema.parse({
    ...line, ...reviseQuoteLineText(line, { title: 'Voce personalizzata', description: 'Prima riga\nSeconda riga' }),
  });
  await saveQuote(firstSite, [edited, ...Array.from({ length: 111 }, () => line)]);
  const saved = (await db.query('select lines from public.estimate_quotes where id = $1', [quote])).rows[0].lines[0];
  assert.deepEqual(saved, edited);
  assert.equal(matchEstimateRate(saved, [rate]).rate?.price, '12');
  await db.query('update public.estimate_quotes set title = $1 where id = $2', ['Preventivo aggiornato', quote]);
  await assert.rejects(db.query('update public.estimate_quotes set id = $1 where id = $2', [randomUUID(), quote]), { code: '23514' });
  await assert.rejects(db.query('update public.estimate_rates set id = $1 where id = $2', [randomUUID(), rate.id]), { code: '23514' });
  await signIn(outsiders);
  assert.equal((await db.query('select id from public.estimate_rates')).rows.length, 0);
  assert.equal((await db.query('select id from public.estimate_quotes')).rows.length, 0);
  await assert.rejects(saveQuote(firstSite, [line]), { code: '42501' });
});
