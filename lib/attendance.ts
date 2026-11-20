import { z } from 'zod';

const kinds = ['work', 'vacation', 'leave', 'sick', 'rest', 'other'] as const;
const places = ['site', 'warehouse', 'office'] as const;
export type AttendanceKind = typeof kinds[number];
export type AttendancePlace = typeof places[number];
export type AttendancePerson = { id: string; name: string; kind: 'employee' | 'worker'; archived: boolean };

export const attendanceKindLabels: Record<AttendanceKind, string> = {
  work: 'Presenza', vacation: 'Ferie', leave: 'Permesso', sick: 'Malattia', rest: 'Riposo', other: 'Altra assenza',
};
export const attendancePlaceLabels: Record<AttendancePlace, string> = {
  site: 'Cantiere', warehouse: 'Magazzino', office: 'Ufficio',
};

const date = z.iso.date().refine(value => value >= '0001-01-01');
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const fields = {
  id: z.uuid(), person_id: z.uuid(), work_date: date, kind: z.enum(kinds),
  start_time: time.nullable().default(null), end_time: time.nullable().default(null),
  workplace: z.enum(places).nullable().default(null), site_id: z.uuid().nullable().default(null),
};
const actionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('save'), ...fields }),
  z.strictObject({ action: z.literal('remove'), id: z.uuid() }),
]);
export const attendanceEntrySchema = z.object({ ...fields, updated_at: z.iso.datetime({ offset: true }) });
export type AttendanceEntry = z.infer<typeof attendanceEntrySchema>;
export type AttendanceAction = z.infer<typeof actionSchema>;

export const attendanceOverlapError = 'Questa persona ha già una registrazione che si sovrappone alla fascia scelta.';

export function validateAttendanceAction(raw: unknown): AttendanceAction {
  const result = actionSchema.safeParse(raw);
  if (!result.success) throw new Error('Controlla persona, data e orari prima di salvare.');
  const entry = result.data;
  if (entry.action === 'remove') return entry;
  const { kind, start_time, end_time, workplace, site_id } = entry;
  if ((start_time === null) !== (end_time === null) || (kind === 'work' && start_time === null)) {
    throw new Error('Inserisci l’ora di inizio e l’ora di fine.');
  }
  if (start_time !== null && end_time !== null && start_time >= end_time) {
    throw new Error('L’ora di fine deve essere successiva all’inizio nella stessa giornata.');
  }
  if (kind === 'work') {
    if (!workplace) throw new Error('Scegli il luogo di lavoro.');
    if (workplace === 'site' && !site_id) throw new Error('Seleziona un cantiere.');
  } else if (workplace || site_id) {
    throw new Error('Il luogo di lavoro si applica alle fasce di presenza.');
  }
  if (workplace !== 'site' && site_id) throw new Error('Seleziona un cantiere solo per il lavoro in cantiere.');
  return entry;
}

export function attendanceOverlaps(first: AttendanceEntry | (AttendanceAction & { action: 'save' }), second: AttendanceEntry) {
  if (first.id === second.id || first.person_id !== second.person_id || first.work_date !== second.work_date) return false;
  if (first.start_time === null || first.end_time === null || second.start_time === null || second.end_time === null) return true;
  return first.start_time < second.end_time && second.start_time < first.end_time;
}

export function attendanceMinutes({ start_time, end_time }: Pick<AttendanceEntry, 'start_time' | 'end_time'>) {
  if (!start_time || !end_time || !time.safeParse(start_time).success || !time.safeParse(end_time).success || start_time >= end_time) return null;
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  return minutes(end_time) - minutes(start_time);
}

export function attendanceMonth(value: unknown, today: string) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[012])$/.test(value) && !value.startsWith('0000-')
    ? value : today.slice(0, 7);
}

export function attendanceMonthRange(month: string) {
  const from = month + '-01';
  const end = new Date(from + 'T12:00:00Z');
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { from, to: end.toISOString().slice(0, 10) };
}
