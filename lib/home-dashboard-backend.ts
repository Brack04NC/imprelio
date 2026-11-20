import 'server-only';
import { readAgenda } from './agenda-backend';
import { readClientOptions, type database } from './backend';
import { dashboardAgenda, dashboardAgendaRange, dashboardRecords, type DashboardData } from './home-dashboard-data';
import { operationSites } from './operations-backend';
import type { OperationRecord } from './operation-types';

type Database = Awaited<ReturnType<typeof database>>;
const pageSize = 500;
const operationFields = ['category', 'code', 'location', 'unit', 'stock_min', 'plate', 'serial_number',
  'maintenance_from', 'maintenance_to', 'article_id', 'direction', 'quantity', 'revision', 'role', 'qualification', 'team_type'] as const;
const operationColumns = 'id,kind,title,status,site_id,record_date,archived,updated_at,' + operationFields.map(field => `${field}:fields->>${field}`).join(',');
type OperationProjection = Omit<OperationRecord, 'fields' | 'lines'> & Record<typeof operationFields[number], string | null>;

async function readDashboardOperations(db: Database, org: string) {
  const records: OperationRecord[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('operation_records').select(operationColumns)
      .eq('organization_id', org).eq('archived', false).order('id').range(offset, offset + pageSize - 1)
      .overrideTypes<OperationProjection[], { merge: false }>();
    if (error) throw error;
    records.push(...data.map(row => {
      const { id, kind, title, status, site_id, record_date, archived, updated_at } = row;
      const fields = Object.fromEntries(operationFields.flatMap(key => row[key] === null ? [] : [[key, row[key]]]));
      return { id, kind, title, status, site_id, record_date, archived, updated_at, fields, lines: [] };
    }));
    if (data.length < pageSize) return records;
  }
}

function optionalModule<T>(query: Promise<T>) {
  return query.catch((error: unknown) => {
    const code = (error as { code?: string } | null)?.code;
    if (code && ['42P01', '42703', 'PGRST200', 'PGRST204', 'PGRST205'].includes(code)) return null;
    throw error;
  });
}

export async function readDashboard(db: Database, org: string, today: string): Promise<DashboardData> {
  const [calendar, sites, clients, records] = await Promise.all([
    optionalModule(readAgenda(db, org, dashboardAgendaRange(today)).then(dashboardAgenda)),
    optionalModule(operationSites(db, org)),
    optionalModule(readClientOptions(db, org)),
    optionalModule(readDashboardOperations(db, org).then(items => dashboardRecords(items, today))),
  ]);
  return { calendar, sites, clients, records };
}
