import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardStorageKey, defaultDashboardWidgets, maxDashboardWidgets, parseDashboardWidgets } from '../lib/home-dashboard.ts';

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
