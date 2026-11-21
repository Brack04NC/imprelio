import 'server-only';

import type { database } from './backend';
import type { OperationRecord } from './operation-types';
import type { VehicleLogEntry, VehicleLogInput } from './vehicle-log';

type Database = Awaited<ReturnType<typeof database>>;
const size = 500;

export function isVehicleLogMigrationMissing(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || code === '42883';
}

export async function readFleetVehicle(db: Database, org: string, id: string) {
  const { data, error } = await db.from('operation_records')
    .select('id,kind,site_id,title,status,record_date,fields,lines,archived,updated_at')
    .eq('organization_id', org).eq('id', id).eq('kind', 'article').eq('fields->>category', 'vehicles').maybeSingle();
  if (error) throw error;
  return data as OperationRecord | null;
}

export async function readVehicleLog(db: Database, org: string, id: string) {
  const entries: VehicleLogEntry[] = [];
  for (let offset = 0; ; offset += size) {
    const { data, error } = await db.from('vehicle_log_entries')
      .select('id,vehicle_id,kind,state,title,start_date,end_date,operator_id,operator_name,site_id,site_name,location,notes,updated_at')
      .eq('organization_id', org).eq('vehicle_id', id).order('start_date', { ascending: false }).order('id').range(offset, offset + size - 1);
    if (error) throw error;
    entries.push(...data as VehicleLogEntry[]);
    if (data.length < size) return entries;
  }
}

export async function writeVehicleLog(db: Database, org: string, input: VehicleLogInput) {
  const { data, error } = await db.rpc('imprelio_vehicle_log_save', { org, payload: input });
  if (error) throw error;
  return data as VehicleLogEntry;
}
