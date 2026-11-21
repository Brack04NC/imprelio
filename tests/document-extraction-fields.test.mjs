import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDocumentText } from '../lib/document-extraction-fields.ts';
import { documentExtractionSchema, documentFieldLimits } from '../lib/document-intake.ts';

test('La lettura di una fattura distingue totale, imponibile e scadenza', () => {
  const text = [
    'FATTURA ELETTRONICA N. 42/2026 del 20/11/2026',
    'Fornitore: Edil Srl',
    'Spett.le Impresa Rossi',
    'Data di scadenza: 31/12/2026',
    'Totale imponibile: € 2.100,00',
    'Totale documento: EUR 2.562,00',
  ].join('\n');
  const result = documentExtractionSchema.parse(parseDocumentText(text, 'file.pdf'));
  assert.equal(result.kind, 'invoice');
  assert.equal(result.status, 'extracted');
  assert.deepEqual(result.fields, {
    title: 'FATTURA ELETTRONICA N. 42/2026 del 20/11/2026', number: '42/2026', date: '2026-11-20',
    issuer: 'Edil Srl', recipient: 'Impresa Rossi', total: '2562.00', currency: 'EUR', text,
  });
});

test('I campi incerti restano vuoti e il testo rimane consultabile', () => {
  const text = ['Preventivo', 'Titolo: Rifacimento facciata', 'Scadenza: 30/10/2026',
    'Data documento: 31/02/2026', 'Totale preventivo: € 5.432,10', 'Totale preventivo: € 7.000,00'].join('\n');
  const { fields, status, kind } = parseDocumentText(text, 'foto.png');
  assert.equal(kind, 'quote');
  assert.equal(status, 'review');
  assert.equal(fields.title, 'Rifacimento facciata');
  assert.equal(fields.date, '');
  assert.equal(fields.total, '');
  assert.equal(fields.text, text);
  assert.equal(parseDocumentText('\u0000 \f', 'computo metrico.pdf').status, 'unreadable');
});

test('Conserva intestazione e importo finale del computo anche quando omette parte del testo', () => {
  const text = 'Computo metrico estimativo\nOggetto: Ponteggio\n' + 'A'.repeat(24_000) + '\nImporto totale: € -1.250,00';
  const result = documentExtractionSchema.parse(parseDocumentText(text, 'computo.pdf'));
  assert.equal(result.kind, 'estimate');
  assert.equal(result.fields.title, 'Ponteggio');
  assert.equal(result.fields.total, '-1250.00');
  assert.equal(result.fields.text.length, documentFieldLimits.text);
  assert.equal(result.status, 'review');
  assert.match(result.fields.text, /testo intermedio omesso/);
});

test('Riconosce il numero nella testata con dicitura Preventivi', () => {
  const text = 'Dettagli preventivo\nPreventivi #: IT-242092\nData del preventivo: 10/05/2024\nTotale generale € 0,00';
  const { fields } = parseDocumentText(text, 'estratto.pdf');
  assert.equal(fields.number, 'IT-242092');
  assert.equal(fields.date, '2024-05-10');
  assert.equal(fields.total, '0.00');
});
