import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNotifications } from '../lib/notifications.ts';

const today = '2026-11-20';
const sources = { agenda: [], operations: [], quotes: [], pendingPdfs: [], workerDeadlines: [] };

function job(id, due_date, status = 'scheduled') {
  return { id, due_date, status, kind: 'assembly', zone: 'Facciata nord', time: '08:00:00',
    site: { id: 'site', name: 'Via Manzoni', city: 'Milano' } };
}

function record(id, kind, status, fields = {}, overrides = {}) {
  return { id, kind, status, fields, title: id, site_id: 'site', record_date: today,
    archived: false, updated_at: today + 'T08:00:00Z', ...overrides };
}

function workerDeadline(id, category, due_on, archived = false) {
  return { id, worker_id: 'worker', category, title: id, due_on, archived, workerName: 'Luca Ferretti' };
}

test('L’Agenda segnala solo interventi aperti in ritardo, di oggi o entro sette giorni', () => {
  const agenda = [
    job('ottavo-giorno', '2026-11-28'), job('oggi', today, 'progress'), job('finito', today, 'done'),
    job('settimo-giorno', '2026-11-27'), job('ritardo', '2026-10-19'),
  ];
  const entries = buildNotifications({ ...sources, agenda }, today);
  assert.deepEqual(entries.map(entry => [entry.id, entry.priority, entry.status]), [
    ['agenda:ritardo', 'urgent', 'In ritardo'], ['agenda:oggi', 'urgent', 'Oggi'], ['agenda:settimo-giorno', 'soon', 'In programma'],
  ]);
  assert.equal(entries[1].href, '/agenda?data=2026-11-20');
  assert.equal(entries[1].detail, 'Via Manzoni · Ore 08:00');
});

test('Mostra le scadenze effettive di fatture, ordini e operai entro trenta giorni', () => {
  const operations = [
    record('12/2026', 'invoice', 'open', { due_date: '2026-11-19', party: 'Studio Ferri' }),
    record('annullato', 'order', 'cancelled', { expected_date: today }),
    record('da-ordinare', 'order', 'draft', { expected_date: today }),
    record('da-consegnare', 'order', 'confirmed', { expected_date: '2026-12-20' }),
    record('pagata', 'invoice', 'paid', { due_date: today }),
    record('invalid', 'invoice', 'open', { due_date: '2026-11-00' }),
    record('archived', 'order', 'sent', { expected_date: today }, { archived: true }),
  ];
  const workerDeadlines = [
    workerDeadline('Titolo riservato', 'medical', today), workerDeadline('Ponteggi', 'certificate', '2026-11-21'),
    workerDeadline('Futura', 'certificate', '2026-12-21'), workerDeadline('Archiviata', 'other', today, true),
    workerDeadline('Conseguita', 'certificate', null),
  ];
  const entries = buildNotifications({ ...sources, operations, workerDeadlines }, today);
  assert.deepEqual(entries.map(entry => [entry.title, entry.category, entry.priority]), [
    ['Fattura 12/2026', 'deadlines', 'urgent'], ['Visita medica', 'workers', 'urgent'],
    ['Ponteggi', 'workers', 'soon'], ['Ordine da-consegnare', 'deadlines', 'soon'],
  ]);
  assert.equal(entries[0].href, '/gestione/amministrazione?tipo=invoice&scheda=12%2F2026');
  assert.equal(entries[1].detail, 'Luca Ferretti');
  assert.equal(entries[1].href, '/gestione/operai/worker/scadenze');
});

test('I computi in lavorazione restano visibili e i pronti usano le date di Roma', () => {
  const operations = [
    record('Z - Bozza', 'estimate', 'draft', {}, { updated_at: '2025-01-01T00:00:00Z' }),
    record('Riesame', 'estimate', 'review'), record('Approvazione', 'estimate', 'approved'),
    record('Vecchia', 'estimate', 'approved', {}, { updated_at: '2026-10-20T21:30:00Z' }),
  ];
  const quotes = [
    { id: 'ready-pdf', site_id: 'site', title: 'Rifacimento intonaco', created_at: '2026-10-20T22:30:00Z' },
    { id: 'old-pdf', site_id: 'site', title: 'Vecchio preventivo', created_at: '2026-10-20T21:30:00Z' },
  ];
  const pendingPdfs = [
    { id: 'pending-pdf', site_id: 'site', file_name: 'A - Computo.pdf', uploaded_at: '2026-10-20T22:30:00Z' },
  ];
  const entries = buildNotifications({ ...sources, operations, quotes, pendingPdfs }, today);
  assert.deepEqual(entries.map(entry => [entry.id, entry.priority, entry.status]), [
    ['pdf:pending-pdf', 'soon', 'Preventivo in attesa'], ['estimate:Riesame', 'soon', 'In revisione'],
    ['estimate:Z - Bozza', 'soon', 'Bozza'], ['estimate:Approvazione', 'info', 'Approvato'],
    ['quote:ready-pdf', 'info', 'Pronto'],
  ]);
  assert.equal(entries[0].href, '/gestione/preventivi-computo?cantiere=site&pdf=pending-pdf#archivio-pdf');
  assert.equal(entries[4].date, '2026-10-21');
  assert.equal(entries[4].href, '/gestione/preventivi-computo?cantiere=site&preventivo=ready-pdf');
});

test('La revisione apre il veicolo e la cronologia conserva la scadenza precedente', async () => {
  const { mergeNotificationHistory, notificationOccurrenceKey } = await import('../lib/notifications.ts');
  const vehicle = record('truck', 'article', 'active', { category: 'vehicles', revision_due_on: '2026-11-19' });
  const [reminder] = buildNotifications({ ...sources, operations: [vehicle] }, today);
  assert.deepEqual([reminder.category, reminder.priority, reminder.href], ['vehicles', 'urgent', '/gestione/magazzino?veicolo=truck']);
  const renewed = { ...vehicle, fields: { ...vehicle.fields, revision_due_on: '2027-11-19' } };
  const active = buildNotifications({ ...sources, operations: [renewed] }, today);
  const history = mergeNotificationHistory(active, [], [{ key: notificationOccurrenceKey(reminder), item: reminder, recorded_at: today + 'T09:00:00Z' }]);
  assert.equal(active.length, 0);
  assert.equal(history[0].past, true);
  assert.equal(history[0].date, '2026-11-19');
});

test('Assicurazione, bollo, revisione e tagliando hanno promemoria distinti per lo stesso veicolo', () => {
  const vehicle = record('truck', 'article', 'active', {
    category: 'vehicles', code: 'TRK-001', insurance_due_on: today, road_tax_due_on: '2026-12-20',
    revision_due_on: '2026-11-19', service_due_on: '2026-11-21',
  });
  const operations = [vehicle,
    record('future', 'article', 'active', { category: 'vehicles', insurance_due_on: '2026-12-21', service_due_on: '' }),
    record('invalid-date', 'article', 'active', { category: 'vehicles', road_tax_due_on: '2026-11-31' }),
    record('materials', 'article', 'active', { category: 'materials', insurance_due_on: today }),
    record('archived', 'article', 'active', { category: 'vehicles', service_due_on: today }, { archived: true }),
  ];
  const entries = buildNotifications({ ...sources, operations }, today);
  assert.deepEqual(entries.map(({ id, priority, status }) => [id, priority, status]), [
    ['vehicle-review:truck', 'urgent', 'Scaduta'], ['vehicle-insurance:truck', 'urgent', 'Scade oggi'],
    ['vehicle-service:truck', 'soon', 'In scadenza'], ['vehicle-road-tax:truck', 'soon', 'In scadenza'],
  ]);
  assert.ok(entries.every(({ category, href, detail }) => category === 'vehicles' && href === '/gestione/magazzino?veicolo=truck' && detail === 'TRK-001'));
  const history = buildNotifications({ ...sources, operations }, today, true);
  assert.deepEqual(history.map(({ id, status, priority }) => [id, status, priority]), [
    ['vehicle-service:archived', 'Veicolo archiviato', 'info'],
  ]);
});

test('La cronologia usa gli interventi conclusi e aggiorna un avviso già rilevato senza duplicarlo', async () => {
  const { mergeNotificationHistory, notificationOccurrenceKey } = await import('../lib/notifications.ts');
  const currentJob = job('work', '2026-11-19');
  const [before] = buildNotifications({ ...sources, agenda: [currentJob] }, today);
  const past = buildNotifications({ ...sources, agenda: [{ ...currentJob, status: 'done' }] }, today, true);
  const result = mergeNotificationHistory([], past, [{ key: notificationOccurrenceKey(before), item: before, recorded_at: today + 'T09:00:00Z' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'Completato');
  assert.equal(result[0].past, true);
});
