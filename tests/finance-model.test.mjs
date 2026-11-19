import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatement, centsToEuroInput, euroToCents } from '../lib/finance.ts';
import { csvDocument } from '../lib/csv-download.ts';

test('Gli importi dei conti mantengono i centesimi, anche per saldi negativi', () => {
  assert.equal(euroToCents(' -12,05 ', true), '-1205');
  assert.equal(centsToEuroInput(-1205n), '-12,05');
  assert.equal(euroToCents('0', true), '0');
  assert.equal(euroToCents('9999999999,99'), '999999999999');
  for (const value of ['0,00', '-2,45', '10,005', '1.234,56', '1e3', '10000000000']) {
    assert.equal(euroToCents(value), null);
  }
});

test('L’estratto conto riporta il saldo precedente, salta gli annullamenti e ordina i movimenti', () => {
  const account = { id: 'a', opening_date: '2026-11-01', opening_cents: '1000' };
  const entries = [
    { id: 'c', account_id: 'a', record_date: '2026-11-19', direction: 'out', amount_cents: '125' },
    { id: 'a', account_id: 'a', record_date: '2026-11-17', direction: 'out', amount_cents: '250' },
    { id: 'b', account_id: 'a', record_date: '2026-11-19', direction: 'in', amount_cents: '575' },
    { id: 'd', account_id: 'a', record_date: '2026-11-19', direction: 'in', amount_cents: '500', voided: true },
    { id: 'e', account_id: 'b', record_date: '2026-11-19', direction: 'in', amount_cents: '500' },
  ];
  const result = buildStatement(account, entries, '2026-11-18', '2026-11-19');
  assert.deepEqual([result.opening, result.income, result.expenses, result.closing], [750n, 575n, 125n, 1200n]);
  assert.deepEqual(result.rows.map(row => [row.entry.id, row.balance]), [['b', 1325n], ['c', 1200n]]);
  assert.equal(buildStatement(account, entries, '2026-10-01', '2026-10-31').closing, 0n);
});

test('Il CSV conserva i decimali e protegge i campi di testo interpretati come formule', () => {
  const data = csvDocument([['\t=2+2', '+SUM(A1)', 'Prova; "due"', '-12,05', 100]]);
  assert.equal(data, '\uFEFF"\'\t=2+2";"\'+SUM(A1)";"Prova; ""due""";"-12,05";"100"');
});
