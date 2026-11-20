import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOperation } from '../lib/operations.ts';
import { overlapsVehicleMaintenance, vehicleMaintenance, vehicleMaintenanceState } from '../lib/vehicle-maintenance.ts';

const vehicle = {
  action: 'save', kind: 'article', id: 'ebcc2d7c-7992-4c97-a421-564113f6becc',
  title: 'Autocarro', status: 'active',
  fields: { category: 'vehicles', unit: 'pz', maintenance_from: '2026-11-23', maintenance_to: '2026-11-25' },
};

test('La manutenzione rende il veicolo fuori uso nel suo intervallo inclusivo e scade il giorno seguente', () => {
  const saved = validateOperation(vehicle);
  const period = vehicleMaintenance(saved);
  assert.deepEqual(period, { start_date: '2026-11-23', end_date: '2026-11-25' });
  assert.equal(saved.status, 'active');
  assert.equal(vehicleMaintenanceState(period, '2026-11-22'), 'scheduled');
  assert.equal(vehicleMaintenanceState(period, '2026-11-23'), 'active');
  assert.equal(vehicleMaintenanceState(period, '2026-11-25'), 'active');
  assert.equal(vehicleMaintenanceState(period, '2026-11-26'), 'past');
  assert.ok(overlapsVehicleMaintenance(saved, [{ start_date: '2026-11-25', end_date: '2026-11-28' }]));
  assert.equal(overlapsVehicleMaintenance(saved, [{ start_date: '2026-11-26', end_date: '2026-11-28' }]), false);
});

test('Salvare una scheda valida le date di manutenzione e rimuove un fermo disattivato', () => {
  const write = fields => validateOperation({ ...vehicle, fields: { ...vehicle.fields, ...fields } });
  assert.throws(() => write({ maintenance_from: '' }), /date di inizio e fine/);
  assert.throws(() => write({ maintenance_from: '2026-11-31' }), /date di inizio e fine/);
  assert.throws(() => write({ maintenance_to: '2026-11-22' }), /fine della manutenzione/);
  assert.equal(vehicleMaintenance(write({ maintenance_from: '', maintenance_to: '' })), null);
  const equipment = write({ category: 'equipment' });
  assert.equal(equipment.fields.maintenance_from, undefined);
  assert.equal(equipment.fields.maintenance_to, undefined);
});
