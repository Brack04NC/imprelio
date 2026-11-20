import { z } from 'zod';
import type { OperationRecord, Values } from './operation-types.ts';

type DatePeriod = { start_date: string; end_date: string };
type Subject = Pick<OperationRecord, 'kind' | 'fields'>;
const isoDate = z.iso.date();

function validDate(date: string | undefined): date is string {
  return Boolean(date && date >= '0001-01-01' && isoDate.safeParse(date).success);
}

export const maintenanceBookingError = 'Il veicolo è in manutenzione in almeno uno dei periodi selezionati.';
export const maintenanceScheduleError = 'Il veicolo è già assegnato in questo periodo. Riprogramma l’assegnazione prima di salvare la manutenzione.';

export function vehicleMaintenance(subject: Subject): DatePeriod | null {
  const { category, maintenance_from: start_date, maintenance_to: end_date } = subject.fields;
  if (subject.kind !== 'article' || category !== 'vehicles'
    || !validDate(start_date) || !validDate(end_date) || start_date > end_date) return null;
  return { start_date, end_date };
}

export function validateVehicleMaintenance(fields: Values) {
  if (fields.category !== 'vehicles' || (!fields.maintenance_from && !fields.maintenance_to)) return {};
  if (!validDate(fields.maintenance_from) || !validDate(fields.maintenance_to)) {
    throw new Error('Inserisci le date di inizio e fine della manutenzione.');
  }
  if (fields.maintenance_from > fields.maintenance_to) {
    throw new Error('La fine della manutenzione deve coincidere con l’inizio o essere successiva.');
  }
  return { maintenance_from: fields.maintenance_from, maintenance_to: fields.maintenance_to };
}

export function vehicleMaintenanceState(period: DatePeriod, today: string): 'scheduled' | 'active' | 'past' {
  if (today < period.start_date) return 'scheduled';
  return today <= period.end_date ? 'active' : 'past';
}

export function periodsOverlap(first: DatePeriod, second: DatePeriod) {
  return first.start_date <= second.end_date && second.start_date <= first.end_date;
}

export function overlapsVehicleMaintenance(subject: Subject, periods: readonly DatePeriod[]) {
  const maintenance = vehicleMaintenance(subject);
  return maintenance !== null && periods.some(period => periodsOverlap(maintenance, period));
}
