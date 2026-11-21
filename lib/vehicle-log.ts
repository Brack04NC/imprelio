import { z } from 'zod';

export const vehicleLogKinds = ['usage', 'maintenance', 'extraordinary'] as const;
export type VehicleLogKind = typeof vehicleLogKinds[number];

const date = z.iso.date().refine(value => value >= '0001-01-01');
const text = (max: number) => z.string().trim().max(max);
const input = z.strictObject({
  id: z.uuid(), vehicle_id: z.uuid(), kind: z.enum(vehicleLogKinds), state: z.enum(['planned', 'done']),
  title: text(160).min(1), start_date: date, end_date: date, operator_id: z.uuid().nullable(),
  site_id: z.uuid().nullable(), location: text(200), notes: text(2000),
});
export const vehicleLogEntrySchema = input.extend({
  operator_name: z.string(), site_name: z.string(), updated_at: z.iso.datetime({ offset: true }),
});
export type VehicleLogInput = z.infer<typeof input>;
export type VehicleLogEntry = z.infer<typeof vehicleLogEntrySchema>;

export function validateVehicleLog(raw: unknown, today: string): VehicleLogInput {
  const result = input.safeParse(raw);
  if (!result.success) throw new Error('Controlla descrizione, date e collegamenti prima di salvare.');
  const entry = result.data;
  if (entry.end_date < entry.start_date) throw new Error('La data di fine deve coincidere con l’inizio o essere successiva.');
  if (entry.kind === 'usage' && (!entry.operator_id || !(entry.site_id || entry.location) || entry.state !== 'done')) {
    throw new Error('Per registrare l’utilizzo indica chi ha usato il mezzo e il cantiere o il luogo.');
  }
  if (entry.state === 'done' && entry.end_date > today) throw new Error('La data di fine di una registrazione conclusa non può essere futura.');
  return entry;
}

export function compareVehicleLogs(a: VehicleLogEntry, b: VehicleLogEntry) {
  return b.start_date.localeCompare(a.start_date) || b.end_date.localeCompare(a.end_date)
    || b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id);
}

export function lastVehicleLocation(entries: VehicleLogEntry[]) {
  const entry = entries.filter(row => row.kind === 'usage' && row.state === 'done' && (row.location || row.site_name))
    .sort((a, b) => b.end_date.localeCompare(a.end_date) || compareVehicleLogs(a, b))[0];
  return entry ? { label: [entry.location, entry.site_name].filter(Boolean).join(' · '), date: entry.end_date } : null;
}
