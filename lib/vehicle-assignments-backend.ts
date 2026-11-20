import 'server-only';
import type { database } from './backend';
import type { VehicleAssignment, VehicleAssignmentAction, VehicleSubject } from './vehicle-assignments';
import { maintenanceBookingError } from './vehicle-maintenance';

type Database = Awaited<ReturnType<typeof database>>;
type AssignmentRow = Omit<VehicleAssignment, 'site_id'> & { site_id?: string | null };
const pageSize = 500;
const assignmentColumns = 'id,vehicle_id,assignee_id,periods,updated_at';
const subjectColumns = 'id,title,kind,status,fields,archived';

export function isVehicleAssignmentsMigrationMissing(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202';
}

function isSiteColumnMissing(error: { code: string } | null) {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

function normalizeAssignment(assignment: AssignmentRow): VehicleAssignment {
  const { id, vehicle_id, assignee_id, site_id = null, periods, updated_at } = assignment;
  return { id, vehicle_id, assignee_id, site_id, periods, updated_at };
}

export async function readVehicleAssignmentList(db: Database, organization: string) {
  const assignments: VehicleAssignment[] = [];
  let supportsSiteAssignment = true;
  const readPage = (columns: string, offset: number) => db.from('vehicle_assignments').select(columns)
    .eq('organization_id', organization).order('id').range(offset, offset + pageSize - 1);
  for (let offset = 0; ; offset += pageSize) {
    let page = await readPage(supportsSiteAssignment ? assignmentColumns + ',site_id' : assignmentColumns, offset);
    if (offset === 0 && isSiteColumnMissing(page.error)) {
      supportsSiteAssignment = false;
      page = await readPage(assignmentColumns, offset);
    }
    if (page.error) throw page.error;
    assignments.push(...(page.data as unknown as AssignmentRow[]).map(normalizeAssignment));
    if (page.data.length < pageSize) return { assignments, supportsSiteAssignment };
  }
}

export async function readVehicleAssignments(db: Database, organization: string) {
  return (await readVehicleAssignmentList(db, organization)).assignments;
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
  if (!error) return data ? normalizeAssignment(data as AssignmentRow) : null;
  if (isVehicleAssignmentsMigrationMissing(error)) throw new Error('Aggiorna il database con la migrazione Assegnazioni veicoli.');
  if (error.code === '23P01') throw new Error(/manutenzione/i.test(error.message)
    ? maintenanceBookingError
    : 'Il veicolo è già assegnato per almeno una delle date selezionate.');
  if (error.code === 'P0002' || error.code === '23503') throw new Error('Il veicolo o il destinatario selezionato non è più disponibile.');
  if (error.code === '42501') throw new Error('L’azienda non è accessibile con questo profilo.');
  if (error.code === '22023') {
    if (action.action === 'save' && action.site_id) {
      const { error: siteError } = await db.from('vehicle_assignments').select('site_id').eq('organization_id', organization).limit(1);
      if (isSiteColumnMissing(siteError)) throw new Error('Aggiorna il database per assegnare un veicolo direttamente a un cantiere.');
    }
    throw new Error('Controlla le date e i periodi inseriti.');
  }
  throw new Error('Salvataggio non riuscito. Riprova.');
}
