import { z } from 'zod';
import { plusDays } from './domain.ts';
import { localOperations, operationSamples } from './operations-demo.ts';
import type { OperationRecord } from './operation-types.ts';

export const maxVehiclePeriods = 50;
export const vehicleAssignmentsKey = 'imprelio-vehicle-assignments-v1';

const periodSchema = z.object({ start_date: z.iso.date(), end_date: z.iso.date() }).strict();
const assignmentSchema = z.object({
  id: z.uuid(), vehicle_id: z.uuid(), assignee_id: z.uuid(), periods: z.array(periodSchema).min(1).max(maxVehiclePeriods),
});
const assignmentActionSchema = z.discriminatedUnion('action', [
  assignmentSchema.extend({ action: z.literal('save') }).strict(),
  z.object({ action: z.literal('remove'), id: z.uuid() }).strict(),
]);
const storedAssignmentsSchema = z.array(assignmentSchema.extend({ updated_at: z.iso.datetime({ offset: true }) }));

export type VehiclePeriod = z.infer<typeof periodSchema>;
export type VehicleAssignment = z.infer<typeof storedAssignmentsSchema>[number];
export type VehicleAssignmentAction = z.infer<typeof assignmentActionSchema>;
export type VehicleSubject = Pick<OperationRecord, 'id' | 'title' | 'kind' | 'status' | 'fields' | 'archived'>;

export const assigneeGroups = [
  { value: 'internal', label: 'Squadre interne', singular: 'Squadra interna' },
  { value: 'external', label: 'Squadre esterne', singular: 'Squadra esterna' },
  { value: 'worker', label: 'Operai', singular: 'Operaio' },
  { value: 'employee', label: 'Dipendenti', singular: 'Dipendente' },
] as const;

export function vehicleAssigneeGroup(subject: VehicleSubject) {
  if (subject.kind === 'worker' || subject.kind === 'employee') return subject.kind;
  if (subject.kind === 'crew') return subject.fields.team_type === 'internal' ? 'internal' : 'external';
  return null;
}

export function isSelectableVehicle(subject: VehicleSubject) {
  return subject.kind === 'article' && subject.fields.category === 'vehicles' && subject.status === 'active' && !subject.archived;
}

export function isSelectableAssignee(subject: VehicleSubject) {
  return !subject.archived && vehicleAssigneeGroup(subject) !== null;
}

export function validateVehicleAssignment(raw: unknown): VehicleAssignmentAction {
  const result = assignmentActionSchema.safeParse(raw);
  if (!result.success) {
    const field = result.error.issues[0]?.path[0];
    if (field === 'periods') throw new Error('Inserisci date valide e da 1 a 50 periodi.');
    if (field === 'vehicle_id') throw new Error('Seleziona un veicolo.');
    if (field === 'assignee_id') throw new Error('Seleziona la persona o la squadra a cui assegnare il veicolo.');
    throw new Error('Richiesta non valida.');
  }
  if (result.data.action === 'remove') return result.data;
  const { periods } = result.data;
  if (periods.some(period => period.end_date < period.start_date))
    throw new Error('La data di fine deve essere uguale o successiva alla data di inizio.');
  const sorted = [...periods].sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (sorted.some((period, index) => index > 0 && sorted[index - 1].end_date >= period.start_date))
    throw new Error('I periodi inseriti si sovrappongono. Anche il giorno di fine è incluso.');
  return { ...result.data, periods: sorted };
}

export function hasVehicleConflict(action: Extract<VehicleAssignmentAction, { action: 'save' }>, assignments: readonly VehicleAssignment[]) {
  return assignments.some(assignment => assignment.vehicle_id === action.vehicle_id && assignment.id !== action.id
    && assignment.periods.some(other => action.periods.some(period => period.start_date <= other.end_date && other.start_date <= period.end_date)));
}

export function vehicleAssignmentState(assignment: VehicleAssignment, today: string) {
  if (assignment.periods.some(period => period.start_date <= today && today <= period.end_date)) return 'active';
  if (assignment.periods.some(period => period.start_date > today)) return 'scheduled';
  return 'past';
}

export function vehicleSubjectSamples(today: string): VehicleSubject[] {
  return operationSamples(today).filter(subject => subject.kind === 'article' && subject.fields.category === 'vehicles'
    || vehicleAssigneeGroup(subject));
}

export function localVehicleSubjects(today: string): VehicleSubject[] {
  return [...localOperations(today, 'magazzino').filter(subject => subject.kind === 'article' && subject.fields.category === 'vehicles'),
    ...localOperations(today, 'personale')];
}

export function vehicleAssignmentSamples(today: string): VehicleAssignment[] {
  const subjects = vehicleSubjectSamples(today);
  const vehicle = subjects.find(isSelectableVehicle);
  const assignee = subjects.find(subject => subject.kind === 'crew');
  if (!vehicle || !assignee) return [];
  return [{
    id: '30638ab7-70df-485d-81da-000000000100', vehicle_id: vehicle.id, assignee_id: assignee.id,
    periods: [{ start_date: plusDays(today, -14), end_date: plusDays(today, -12) },
      { start_date: plusDays(today, -9), end_date: plusDays(today, -7) }],
    updated_at: plusDays(today, -14) + 'T08:00:00Z',
  }];
}

export function localVehicleAssignments(today: string): VehicleAssignment[] {
  try {
    const result = storedAssignmentsSchema.safeParse(JSON.parse(localStorage.getItem(vehicleAssignmentsKey) ?? 'null'));
    if (result.success) return result.data;
  } catch { /* An unavailable browser store starts with sample records. */ }
  return vehicleAssignmentSamples(today);
}

export function updateLocalVehicleAssignment(today: string, action: VehicleAssignmentAction) {
  const rows = localVehicleAssignments(today);
  const remaining = rows.filter(row => row.id !== action.id);
  if (action.action === 'remove') {
    localStorage.setItem(vehicleAssignmentsKey, JSON.stringify(remaining));
    return null;
  }
  const subjects = localVehicleSubjects(today);
  if (!subjects.some(subject => subject.id === action.vehicle_id && isSelectableVehicle(subject)))
    throw new Error('Il veicolo selezionato non è più disponibile in magazzino.');
  if (!subjects.some(subject => subject.id === action.assignee_id && isSelectableAssignee(subject)))
    throw new Error('La persona o la squadra selezionata non è più disponibile.');
  if (hasVehicleConflict(action, rows)) throw new Error('Il veicolo è già assegnato per almeno una delle date selezionate.');
  const { action: _, ...data } = action;
  const assignment = { ...data, updated_at: new Date().toISOString() };
  localStorage.setItem(vehicleAssignmentsKey, JSON.stringify([assignment, ...remaining]));
  return assignment;
}
