import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardStorageKey, defaultDashboardWidgets, maxDashboardWidgets, parseDashboardWidgets } from '../lib/home-dashboard.ts';
import { dashboardRecords } from '../lib/home-dashboard-data.ts';

test('La dashboard parte da quattro widget e conserva ordine, dimensioni e scheda selezionata', () => {
  assert.deepEqual(defaultDashboardWidgets.map(widget => widget.kind), ['calendar', 'warehouse', 'estimates', 'site-interventions']);
  const site = '51ee78b3-709b-4e39-b987-6556bda4d28f';
  const layout = [
    { ...defaultDashboardWidgets[3], target: site, width: 2, height: 2 },
    defaultDashboardWidgets[0],
  ];
  assert.deepEqual(parseDashboardWidgets(JSON.parse(JSON.stringify(layout))), layout);
  assert.deepEqual(parseDashboardWidgets([]), []);
});

test('La dashboard scarta layout danneggiati o oltre il limite', () => {
  const widget = defaultDashboardWidgets[0];
  for (const change of [{ id: '' }, { kind: 'sconosciuto' }, { target: 'cantiere' }, { width: 4 }, { height: 0 }]) {
    assert.equal(parseDashboardWidgets([{ ...widget, ...change }]), null);
  }
  assert.equal(parseDashboardWidgets([widget, widget]), null);
  assert.equal(parseDashboardWidgets(Array.from({ length: maxDashboardWidgets + 1 }, (_, i) => ({ ...widget, id: `widget-${i}` }))), null);
});

test('La configurazione usa una chiave distinta per azienda e profilo', () => {
  const identity = { email: 'Mario@Esempio.it', demo: false, org: { id: 'azienda-a' } };
  assert.equal(dashboardStorageKey(identity), dashboardStorageKey({ ...identity, email: 'mario@esempio.it' }));
  assert.notEqual(dashboardStorageKey(identity), dashboardStorageKey({ ...identity, email: 'altro@esempio.it' }));
  assert.notEqual(dashboardStorageKey(identity), dashboardStorageKey({ ...identity, org: { id: 'azienda-b' } }));
  assert.notEqual(dashboardStorageKey(identity), dashboardStorageKey({ ...identity, demo: true }));
});

test('La dashboard mostra lo stato dei singoli veicoli e le scorte dei soli articoli', () => {
  const today = '2026-11-21';
  const record = (id, kind, fields) => ({ id, kind, title: id, status: 'active', fields,
    site_id: null, record_date: null, lines: [], archived: false, updated_at: `${today}T09:00:00Z` });
  const items = dashboardRecords([
    record('Autocarro', 'article', { category: 'vehicles', plate: 'AB123CD', unit: 'pz', stock_min: '7',
      maintenance_from: today, maintenance_to: today }),
    record('Carico storico mezzo', 'movement', { article_id: 'Autocarro', direction: 'in', quantity: '1' }),
    record('Giunti', 'article', { category: 'materials', unit: 'pz', stock_min: '4' }),
    record('Carico giunti', 'movement', { article_id: 'Giunti', direction: 'in', quantity: '3,5' }),
  ], today);
  const vehicle = items.find(item => item.id === 'Autocarro');
  assert.equal(vehicle.vehicle, true);
  assert.equal(vehicle.status, 'inactive');
  assert.equal(vehicle.detail, 'AB123CD');
  assert.equal('availability' in vehicle, false);
  assert.deepEqual(items.find(item => item.id === 'Giunti').availability, { quantity: '3,5', minimum: '4', unit: 'pz', low: true });
});
