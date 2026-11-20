import { z } from 'zod';
import { plusDays } from './domain.ts';
import { demoSiteOptions, localOperations, operationSamples } from './operations-demo.ts';
import { attendanceEntrySchema, attendanceMonthRange, attendanceOverlapError, attendanceOverlaps, validateAttendanceAction,
  type AttendanceAction, type AttendanceEntry, type AttendancePerson } from './attendance.ts';

export const attendanceKey = 'imprelio-attendance-v1';
const stored = z.array(attendanceEntrySchema);

function peopleFrom(records: ReturnType<typeof operationSamples>): AttendancePerson[] {
  return records.flatMap(record => record.kind === 'employee' || record.kind === 'worker'
    ? [{ id: record.id, name: record.title, kind: record.kind, archived: record.archived }] : [])
    .sort((first, second) => first.name.localeCompare(second.name, 'it'));
}

export function attendancePeopleSamples(today: string) {
  return peopleFrom(operationSamples(today));
}

export function localAttendancePeople(today: string) {
  return peopleFrom(localOperations(today, 'personale'));
}

function samples(today: string): AttendanceEntry[] {
  const data = operationSamples(today);
  const worker = data.find(record => record.kind === 'worker');
  const employee = data.find(record => record.kind === 'employee');
  if (!worker?.site_id || !employee) return [];
  const updated_at = today + 'T08:00:00Z';
  const sample = (i: number, values: Omit<AttendanceEntry, 'id' | 'updated_at'>) => ({
    ...values, updated_at, id: 'e860b069-84dd-4b3e-92b7-' + String(i).padStart(12, '0'),
  });
  return [
    sample(1, { person_id: worker.id, work_date: today, kind: 'work', start_time: '08:00', end_time: '12:00', workplace: 'site', site_id: worker.site_id }),
    sample(2, { person_id: worker.id, work_date: today, kind: 'work', start_time: '13:00', end_time: '16:00', workplace: 'warehouse', site_id: null }),
    sample(3, { person_id: employee.id, work_date: today, kind: 'work', start_time: '09:00', end_time: '13:00', workplace: 'office', site_id: null }),
    sample(4, { person_id: employee.id, work_date: today, kind: 'leave', start_time: '14:00', end_time: '16:00', workplace: null, site_id: null }),
    sample(5, { person_id: worker.id, work_date: plusDays(today, -1), kind: 'vacation', start_time: null, end_time: null, workplace: null, site_id: null }),
  ];
}

function readLocal(today: string) {
  const source = localStorage.getItem(attendanceKey);
  if (source === null) return samples(today);
  try {
    const result = stored.safeParse(JSON.parse(source));
    if (result.success) return result.data;
  } catch { /* Leave the stored value intact if it cannot be read. */ }
  throw new Error('Impossibile leggere le presenze della demo.');
}

function withinRange(entries: AttendanceEntry[], from: string, to: string) {
  return entries.filter(entry => from <= entry.work_date && entry.work_date <= to);
}

export function attendanceSamples(today: string, month: string) {
  const { from, to } = attendanceMonthRange(month);
  return withinRange(samples(today), from, to);
}

export function localAttendanceRange(today: string, from: string, to: string) {
  return withinRange(readLocal(today), from, to);
}

export function localAttendance(today: string, month: string) {
  const { from, to } = attendanceMonthRange(month);
  return localAttendanceRange(today, from, to);
}

export function writeLocalAttendance(today: string, input: AttendanceAction) {
  const action = validateAttendanceAction(input);
  const entries = readLocal(today);
  const previous = entries.find(entry => entry.id === action.id);
  const people = localAttendancePeople(today);
  const editable = (id: string) => people.some(person => person.id === id && !person.archived);
  if (previous && !editable(previous.person_id)) throw new Error('Le registrazioni di una persona archiviata si possono consultare.');
  const remaining = entries.filter(entry => entry.id !== action.id);
  if (action.action === 'remove') {
    if (previous) localStorage.setItem(attendanceKey, JSON.stringify(remaining));
    return null;
  }
  if (!editable(action.person_id)) throw new Error('La persona selezionata non è disponibile.');
  if (action.site_id && !demoSiteOptions(today, true).some(site => site.id === action.site_id)) throw new Error('Il cantiere non è disponibile.');
  if (remaining.some(entry => attendanceOverlaps(action, entry))) throw new Error(attendanceOverlapError);
  const { action: _, ...data } = action;
  const saved: AttendanceEntry = { ...data, updated_at: new Date().toISOString() };
  localStorage.setItem(attendanceKey, JSON.stringify([...remaining, saved]));
  return saved;
}
