import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWorkerDeadlineAction, workerDeadlineState } from '../lib/worker-deadlines.ts';

const item = {
  action: 'save', id: '48487484-7a13-4afe-8c00-8834b404f9ed', worker_id: 'c69e5393-80f8-4315-a4ee-5f4ff4e3bc75',
  category: 'certificate', title: ' Formazione ponteggi ', completed_on: '2026-11-20', due_on: '2026-12-20',
};

test('Le scadenze ammettono una sola data e convalidano l’ordine delle date', () => {
  assert.equal(validateWorkerDeadlineAction(item).title, 'Formazione ponteggi');
  assert.equal(validateWorkerDeadlineAction({ ...item, completed_on: null }).due_on, item.due_on);
  assert.throws(() => validateWorkerDeadlineAction({ ...item, completed_on: null, due_on: null }), /almeno una data/);
  assert.throws(() => validateWorkerDeadlineAction({ ...item, due_on: '2026-11-19' }), /scadenza deve/);
  assert.throws(() => validateWorkerDeadlineAction({ ...item, category: 'other', title: ' ' }), /titolo/);
});

test('Per la visita medica il titolo è fisso e i campi aggiuntivi sono rifiutati', () => {
  const visit = { ...item, category: 'medical', title: '' };
  assert.equal(validateWorkerDeadlineAction(visit).title, 'Visita medica');
  assert.throws(() => validateWorkerDeadlineAction({ ...visit, notes: 'Dati estranei alla scadenza' }));
});

test('Il giorno della scadenza e i trenta giorni successivi sono segnalati', () => {
  const states = [null, '2026-11-19', '2026-11-20', '2026-12-20', '2026-12-21']
    .map(due_on => workerDeadlineState({ due_on }, '2026-11-20'));
  assert.deepEqual(states, ['undated', 'expired', 'due', 'due', 'future']);
});
