import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBusinessReport, parseReportFilters } from '../lib/business-reports.ts';

const today = '2026-03-15';
const siteA = '74b7f7a0-27a7-4cad-a670-000000000040';
const siteB = '74b7f7a0-27a7-4cad-a670-000000000041';
const client = '74b7f7a0-27a7-4cad-a670-000000000020';
const sites = [
  { id: siteA, name: 'Cantiere A', city: 'Milano', client: 'Cliente Alfa', client_id: client, status: 'active' },
  { id: siteB, name: 'Cantiere B', city: 'Como', client: 'Cliente Alfa', client_id: client, status: 'closed' },
];
const period = { from: '2026-01-01', to: today, site: '' };
const record = (id, kind, rest = {}) => ({
  id, kind, site_id: siteA, title: id, status: 'active', record_date: '2026-01-03',
  fields: {}, lines: [], archived: false, updated_at: '2026-03-15T08:00:00Z', ...rest,
});
const line = (price, quantity = '1') => ({ description: 'Montaggio', unit: 'm²', quantity, unit_price: price });
const invoice = (id, price, rest = {}) => record(id, 'invoice', {
  status: 'open', lines: [line(price)], ...rest,
  fields: { party: 'Controparte', direction: 'outgoing', vat: '22', ...rest.fields },
});

test('Normalizza gli estremi, respinge date impossibili e mantiene un filtro cantiere valido', () => {
  assert.deepEqual(parseReportFilters({}, today), { from: '2026-03-01', to: today, site: '' });
  assert.deepEqual(parseReportFilters({ dal: '2026-02-28', al: '2026-02-01', cantiere: siteA }, today),
    { from: '2026-02-01', to: '2026-02-28', site: siteA });
  assert.deepEqual(parseReportFilters({ dal: ['2026-01-01'], al: '2026-02-29', cantiere: 'non-valido' }, today),
    { from: '2026-03-01', to: today, site: '' });
});

test('Distingue fatturato, saldi aperti e pagamenti usando le date e i centesimi esatti', () => {
  const open = invoice('Emessa aperta', '100', { fields: { due_date: '2026-02-02' } });
  const report = buildBusinessReport({ sites, jobs: [], quotes: [], assignments: null, records: [
    open, open,
    invoice('Ricevuta aperta', '30', { fields: { direction: 'incoming', vat: '0', due_date: '2026-03-18' } }),
    invoice('Emessa l’anno prima', '400', { status: 'paid', record_date: '2025-12-29', fields: { paid_date: '2026-02-10' } }),
    invoice('Emessa saldata senza data', '20', { status: 'paid' }),
    invoice('Saldata prima senza data', '40', { status: 'paid', record_date: '2025-12-22' }),
    invoice('Ricevuta saldata nel periodo', '200', { status: 'paid', record_date: '2026-03-05',
      fields: { direction: 'incoming', paid_date: today, vat: '10' }, site_id: siteB }),
    invoice('Emessa senza cantiere', '10', { record_date: today, site_id: null, fields: { due_date: today } }),
    invoice('Arrotondamento', '0', { lines: [line('1,10', '1,005')], record_date: today, fields: { vat: '5,50' } }),
    invoice('Bozza', '1000', { status: 'draft' }),
    invoice('Senza righe', '0', { lines: [] }),
    invoice('Senza direzione', '900', { fields: { direction: '' } }),
    invoice('Senza data', '700', { record_date: null }),
    invoice('Archiviata', '400', { archived: true }),
    record('Ordine', 'order', { fields: { direction: 'outgoing', vat: '22' }, lines: [line('500')] }),
  ] }, period, today);

  assert.deepEqual(report.summary, {
    revenue: 13111n, cost: 23000n, balance: -9889n,
    revenueGross: 15977n, costGross: 25000n, revenueVat: 2866n, costVat: 2000n,
    receivables: 13537n, payables: 3000n, overdueReceivables: 12200n, overduePayables: 0n,
    collected: 48800n, paid: 22000n, drafts: 1, incomplete: 3, missingPaidDate: 2,
  });
  assert.deepEqual(report.monthly, [
    { month: '2026-01', revenue: 12000n, cost: 3000n, balance: 9000n },
    { month: '2026-02', revenue: 0n, cost: 0n, balance: 0n },
    { month: '2026-03', revenue: 1111n, cost: 20000n, balance: -18889n },
  ]);
  assert.equal(report.monthlyOmittedEmpty, false);
  assert.deepEqual(report.sites.map(({ id, revenue, cost }) => ({ id, revenue, cost })), [
    { id: siteA, revenue: 12111n, cost: 3000n }, { id: siteB, revenue: 0n, cost: 20000n },
    { id: '', revenue: 1000n, cost: 0n },
  ]);
  assert.equal(report.invoices.find(row => row.id === 'Senza data').net, null);
  assert.equal(report.invoices.find(row => row.id === 'Bozza').gross, null);
  assert.equal(report.invoices.find(row => row.id === 'Emessa senza cantiere').overdue, false);
  assert.equal(report.invoices.find(row => row.id === 'Emessa l’anno prima'), undefined);
  assert.deepEqual(report.settledInvoices.map(row => row.id), ['Ricevuta saldata nel periodo', 'Emessa l’anno prima']);
});

test('I periodi molto ampi mantengono i totali senza allocare i mesi vuoti', () => {
  const wide = buildBusinessReport({ sites, jobs: [], quotes: [], assignments: null, records: [
    invoice('Fattura recente', '25'),
    invoice('Fattura iniziale', '50', { record_date: '2001-02-01' }),
  ] }, { from: '2001-01-01', to: today, site: '' }, today);
  assert.equal(wide.summary.revenue, 7500n);
  assert.equal(wide.monthlyOmittedEmpty, true);
  assert.deepEqual(wide.monthly.map(row => row.month), ['2001-02', '2026-01']);
});

test('Filtra attività e fatture per cantiere mantenendo le scorte aziendali', () => {
  const assigned = (id, vehicle_id, assignee_id, start_date, end_date) => ({
    id, vehicle_id, assignee_id, periods: [{ start_date, end_date }], updated_at: '2026-03-15T08:00:00Z',
  });
  const data = { sites, records: [
    record('Dipendente', 'employee', { record_date: '2025-12-01' }),
    record('Operaio', 'worker', { site_id: siteB }),
    record('Squadra', 'crew'),
    record('Impianto', 'article', { site_id: null, fields: { stock_min: '4' } }),
    record('Carico', 'movement', { site_id: siteB, record_date: '2025-06-01',
      fields: { article_id: 'Impianto', direction: 'in', quantity: '3,5' } }),
    record('Mezzo A', 'article', { site_id: null, fields: { category: 'vehicles' } }),
    record('Mezzo B', 'article', { site_id: null, fields: { category: 'vehicles' } }),
    record('Ordine', 'order', { record_date: period.from }),
    record('DDT 1', 'ddt', { record_date: period.from }),
    record('DDT 2', 'ddt', { record_date: period.to, archived: true }),
    record('Computo', 'estimate'),
    invoice('Emessa A', '10'), invoice('Emessa B', '20', { site_id: siteB }),
  ], jobs: [
    { id: '1', site_id: siteA, kind: 'survey', due_date: period.from, status: 'done' },
    { id: '2', site_id: siteA, kind: 'assembly', due_date: '2026-02-01', status: 'progress' },
    { id: '3', site_id: siteA, kind: 'assembly', due_date: today, status: 'scheduled' },
    { id: '4', site_id: siteB, kind: 'adjustment', due_date: today, status: 'scheduled' },
  ], quotes: [
    { id: 'PDF1', site_id: siteA, title: 'A', source_name: 'A.pdf', created_at: '2025-12-31T23:45:00Z' },
    { id: 'PDF2', site_id: siteB, title: 'B', source_name: 'B.pdf', created_at: '2026-01-01T00:00:00Z' },
    { id: 'PDF3', site_id: siteA, title: 'C', source_name: 'C.pdf', created_at: '2026-03-15T23:45:00Z' },
  ], assignments: [
    assigned('A1', 'Mezzo A', 'Squadra', '2026-03-10', today),
    assigned('A2', 'Mezzo A', 'Squadra', today, '2026-03-17'),
    assigned('B1', 'Mezzo B', 'Operaio', today, '2026-03-17'),
  ] };
  const report = buildBusinessReport(data, { ...period, site: siteA }, today);

  assert.deepEqual(report.activity, {
    activeSites: 1, sites: 1, sitesByStatus: { active: 1, planned: 0, paused: 0, closed: 0 }, clients: 1,
    jobs: 3, jobsCompleted: 1, jobsOverdue: 1, jobsByKind: { survey: 1, assembly: 2, adjustment: 0, dismantling: 0, other: 0 },
    orders: 1, ddt: 1, estimates: 1, quotes: 1, employees: 1, workers: 0, crews: 1,
    stockArticles: 3, lowStock: 1, vehiclesAssigned: 1,
  });
  assert.equal(report.sites[0].jobCount, 3);
  assert.equal(report.summary.revenue, 1000n);
  const company = buildBusinessReport(data, period, today);
  assert.equal(company.activity.clients, 1);
  assert.equal(company.activity.vehiclesAssigned, 2);
  assert.equal(buildBusinessReport({ ...data, assignments: null }, period, today).activity.vehiclesAssigned, null);
});

test('L’andamento raggruppa gli interventi filtrati nelle settimane incluse nel periodo', () => {
  const job = (id, due_date, status, site_id = siteA) => ({ id, due_date, status, site_id, kind: 'assembly' });
  const completed = job('Montaggio', '2026-02-27', 'done');
  const data = { sites, records: [], quotes: [], assignments: null, jobs: [
    completed, completed, job('In ritardo', '2026-03-05', 'progress'), job('Oggi', today, 'scheduled'),
    job('Altro cantiere', '2026-03-14', 'scheduled', siteB), job('Fuori periodo', '2026-02-26', 'done'),
    job('Data impossibile', '2026-02-29', 'scheduled'),
  ] };
  const report = buildBusinessReport(data, { site: siteA, from: '2026-02-27', to: '2026-03-17' }, today);
  assert.deepEqual(report.activityTrend, {
    granularity: 'week', omittedEmpty: false, points: [
      { key: '2026-02-23', from: '2026-02-27', to: '2026-03-01', total: 1, completed: 1, overdue: 0 },
      { key: '2026-03-02', from: '2026-03-02', to: '2026-03-08', total: 1, completed: 0, overdue: 1 },
      { key: '2026-03-09', from: '2026-03-09', to: '2026-03-15', total: 1, completed: 0, overdue: 0 },
      { key: '2026-03-16', from: '2026-03-16', to: '2026-03-17', total: 0, completed: 0, overdue: 0 },
    ],
  });
  assert.equal(report.activity.jobs, 3);
  const daily = buildBusinessReport(data, { site: siteA, from: '2026-03-14', to: today }, today);
  assert.equal(daily.activityTrend.granularity, 'day');
  assert.deepEqual(daily.activityTrend.points.map(point => point.total), [0, 1]);
});

test('L’andamento include il mese bisestile e tratta gli estremi dei periodi molto ampi', () => {
  const job = (due_date, status) => ({ id: due_date, due_date, status, site_id: siteA, kind: 'assembly' });
  const data = { sites, records: [], quotes: [], assignments: null, jobs: [
    job('0001-01-01', 'done'), job('2024-02-29', 'done'), job('9999-12-31', 'scheduled'),
  ] };
  const monthly = buildBusinessReport(data, { site: '', from: '2024-01-18', to: '2024-04-02' }, today);
  assert.equal(monthly.activityTrend.granularity, 'month');
  assert.deepEqual(monthly.activityTrend.points.map(({ from, to, total }) => [from, to, total]), [
    ['2024-01-18', '2024-01-31', 0], ['2024-02-01', '2024-02-29', 1],
    ['2024-03-01', '2024-03-31', 0], ['2024-04-01', '2024-04-02', 0],
  ]);
  const wide = buildBusinessReport(data, { site: '', from: '0001-01-01', to: '9999-12-31' }, today);
  assert.equal(wide.activityTrend.granularity, 'year');
  assert.equal(wide.activityTrend.omittedEmpty, true);
  assert.deepEqual(wide.activityTrend.points.map(({ key, total, overdue }) => [key, total, overdue]),
    [['0001', 1, 0], ['2024', 1, 0], ['9999', 1, 0]]);
  const finalWeeks = buildBusinessReport(data, { site: '', from: '9999-12-12', to: '9999-12-31' }, today);
  assert.equal(finalWeeks.activityTrend.points.at(-1).to, '9999-12-31');
  assert.equal(finalWeeks.activityTrend.points.at(-1).total, 1);
});
