import 'server-only';
import type { database } from './backend';
import type { AttendanceAction, AttendanceEntry, AttendancePerson } from './attendance';

type Database = Awaited<ReturnType<typeof database>>;
const pageSize = 500;
const columns = 'id,person_id,work_date,kind,start_time,end_time,workplace,site_id,updated_at';

function normalize({ id, person_id, work_date, kind, start_time, end_time, workplace, site_id, updated_at }: AttendanceEntry): AttendanceEntry {
  return {
    id, person_id, work_date, kind, start_time: start_time?.slice(0, 5) ?? null, end_time: end_time?.slice(0, 5) ?? null,
    workplace, site_id, updated_at,
  };
}

export function isAttendanceMigrationMissing(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205';
}

export async function readAttendance(db: Database, organization: string, from: string, to: string, site?: string) {
  const entries: AttendanceEntry[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const query = db.from('attendance_entries').select(columns).eq('organization_id', organization)
      .gte('work_date', from).lte('work_date', to).order('work_date').order('id').range(offset, offset + pageSize - 1);
    const { data, error } = await (site ? query.eq('site_id', site) : query);
    if (error) throw error;
    entries.push(...(data as AttendanceEntry[]).map(normalize));
    if (data.length < pageSize) return entries;
  }
}

export async function readAttendancePeople(db: Database, organization: string): Promise<AttendancePerson[]> {
  const people: AttendancePerson[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('operation_records').select('id,title,kind,archived')
      .eq('organization_id', organization).in('kind', ['employee', 'worker'])
      .order('title').order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const record of data) {
      if (record.kind === 'employee' || record.kind === 'worker') {
        people.push({ id: record.id, name: record.title, kind: record.kind, archived: record.archived });
      }
    }
    if (data.length < pageSize) return people;
  }
}

export async function writeAttendance(db: Database, organization: string, action: AttendanceAction) {
  const { data, error } = await db.rpc('imprelio_attendance_write', { org: organization, payload: action });
  if (error) throw error;
  return data ? normalize(data as AttendanceEntry) : null;
}
