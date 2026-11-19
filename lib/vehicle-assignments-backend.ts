import 'server-only';
import type { database } from './backend';
import type { VehicleAssignment, VehicleAssignmentAction, VehicleSubject } from './vehicle-assignments';

type Database = Awaited<ReturnType<typeof database>>;
const pageSize = 500;
const assignmentColumns = 'id,vehicle_id,assignee_id,periods,updated_at';
const subjectColumns = 'id,title,kind,status,fields,archived';

export function isVehicleAssignmentsMigrationMissing(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202';
}

export async function readVehicleAssignments(db: Database, organization: string) {
  const records: VehicleAssignment[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('vehicle_assignments')
      .select(assignmentColumns).eq('organization_id', organization)
      .order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    records.push(...data as VehicleAssignment[]);
    if (data.length < pageSize) return records;
  }
}

async function readSubjects(db: Database, organization: string, kind: 'vehicle' | 'assignee') {
  const records: VehicleSubject[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const base = db.from('operation_records').select(subjectColumns).eq('organization_id', organization);
    const query = kind === 'vehicle' ? base.eq('kind', 'article').eq('fields->>category', 'vehicles')
      : base.in('kind', ['employee', 'worker', 'crew']);
    const { data, error } = await query.order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    records.push(...data as VehicleSubject[]);
    if (data.length < pageSize) return records;
  }
}

export async function readVehicleSubjects(db: Database, organization: string) {
  const [vehicles, assignees] = await Promise.all([readSubjects(db, organization, 'vehicle'), readSubjects(db, organization, 'assignee')]);
  return [...vehicles, ...assignees];
}

export async function writeVehicleAssignment(db: Database, organization: string, action: VehicleAssignmentAction) {
  const { data, error } = await db.rpc('imprelio_vehicle_assignment_write', { org: organization, payload: action });
  if (!error) return data as VehicleAssignment | null;
  if (isVehicleAssignmentsMigrationMissing(error)) throw new Error('Aggiorna il database con la migrazione Assegnazioni veicoli.');
  if (error.code === '23P01') throw new Error('Il veicolo è già assegnato per almeno una delle date selezionate.');
  if (error.code === 'P0002' || error.code === '23503') throw new Error('Il veicolo o la persona selezionata non è più disponibile.');
  if (error.code === '42501') throw new Error('L’azienda non è accessibile con questo profilo.');
  if (error.code === '22023') throw new Error('Controlla le date e i periodi inseriti.');
  throw new Error('Salvataggio non riuscito. Riprova.');
}
