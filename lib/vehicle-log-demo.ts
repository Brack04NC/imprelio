import { z } from 'zod';
import { plusDays } from './domain.ts';
import { demoSiteOptions, localOperations, operationSamples } from './operations-demo.ts';
import { isSelectableAssignee, localVehicleSubjects } from './vehicle-assignments.ts';
import { compareVehicleLogs, validateVehicleLog, vehicleLogEntrySchema, type VehicleLogEntry, type VehicleLogInput } from './vehicle-log.ts';

export const vehicleLogStorageKey = 'imprelio-registro-veicoli-v1';
const stored = z.array(vehicleLogEntrySchema);

function samples(today: string): VehicleLogEntry[] {
  const records = operationSamples(today);
  const vehicle = records.find(record => record.kind === 'article' && record.fields.category === 'vehicles');
  const worker = records.find(record => record.kind === 'worker');
  const [site] = demoSiteOptions(today);
  if (!vehicle || !worker || !site) return [];
  const when = plusDays(today, -3);
  return [{
    id: '3aefee15-8438-4355-9a74-000000000001', vehicle_id: vehicle.id, kind: 'usage',
    title: 'Trasporto telai e pedane', state: 'done', start_date: when, end_date: when,
    operator_id: worker.id, operator_name: worker.title, site_id: site.id, site_name: site.name,
    location: 'Area di scarico', notes: '', updated_at: when + 'T15:00:00Z',
  }, {
    id: '3aefee15-8438-4355-9a74-000000000002', vehicle_id: vehicle.id, kind: 'extraordinary',
    title: 'Sostituzione tubo idraulico della gru', state: 'done',
    start_date: plusDays(today, -20), end_date: plusDays(today, -20),
    operator_id: null, operator_name: '', site_id: null, site_name: '', location: 'Officina', notes: 'Prova funzionale eseguita.',
    updated_at: plusDays(today, -20) + 'T15:00:00Z',
  }];
}

function readStore(today: string) {
  const raw = localStorage.getItem(vehicleLogStorageKey);
  if (raw === null) return samples(today);
  return stored.parse(JSON.parse(raw));
}

export function localVehicleLogs(today: string, id: string) {
  return readStore(today).filter(entry => entry.vehicle_id === id).sort(compareVehicleLogs);
}

export function saveLocalVehicleLog(today: string, raw: VehicleLogInput): VehicleLogEntry {
  const input = validateVehicleLog(raw, today);
  const records = readStore(today);
  const previous = records.find(entry => entry.id === input.id);
  const vehicle = localOperations(today, 'magazzino').find(record => record.id === input.vehicle_id);
  if (!vehicle || vehicle.kind !== 'article' || vehicle.fields.category !== 'vehicles' || vehicle.archived) {
    throw new Error('La scheda del veicolo non è disponibile per le modifiche.');
  }
  if (previous && (previous.vehicle_id !== input.vehicle_id || previous.kind !== input.kind)) {
    throw new Error('La registrazione non è disponibile per le modifiche.');
  }
  const operator = localVehicleSubjects(today).find(record => record.id === input.operator_id && isSelectableAssignee(record));
  const site = demoSiteOptions(today, true).find(record => record.id === input.site_id);
  if ((input.operator_id && !operator && previous?.operator_id !== input.operator_id)
    || (input.site_id && !site && previous?.site_id !== input.site_id)) {
    throw new Error('Il personale, la squadra o il cantiere selezionato non è più disponibile.');
  }
  const saved = {
    ...input,
    operator_name: input.operator_id ? (previous?.operator_id === input.operator_id ? previous.operator_name : operator?.title ?? '') : '',
    site_name: input.site_id ? (previous?.site_id === input.site_id ? previous.site_name : site?.name ?? '') : '',
    updated_at: new Date().toISOString(),
  };
  localStorage.setItem(vehicleLogStorageKey, JSON.stringify([saved, ...records.filter(row => row.id !== saved.id)]));
  return saved;
}
