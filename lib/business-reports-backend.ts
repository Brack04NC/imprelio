import 'server-only';
import type { database } from './backend';
import type { ReportData, ReportFilters } from './business-reports';
import { romeDate } from './domain';
import type { QuoteSummary } from './estimate-pricing';
import type { OperationKind, OperationRecord } from './operation-types';
import { isVehicleAssignmentsMigrationMissing, readVehicleAssignments } from './vehicle-assignments-backend';

type Database = Awaited<ReturnType<typeof database>>;
type SiteRow = Omit<ReportData['sites'][number], 'client'> & { clients: unknown };
type Page<T> = { data: T[] | null; error: unknown };

const pageSize = 500;
const recordColumns = 'id,kind,site_id,title,status,record_date,fields,lines,archived,updated_at';
const currentKinds = ['article', 'movement', 'employee', 'worker', 'crew'] as const;
const documentKinds = ['order', 'ddt', 'estimate'] as const;

export function isBusinessReportMigrationMissing(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202';
}

async function readPages<T>(fetchPage: (from: number, to: number) => PromiseLike<Page<T>>) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data) throw new Error('Il database ha restituito dati incompleti per le statistiche.');
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

async function readSites(db: Database, org: string): Promise<ReportData['sites']> {
  const rows = await readPages<SiteRow>((from, to) => db.from('sites')
    .select('id,name,city,status,client_id,clients(name)').eq('organization_id', org)
    .order('name').order('id').range(from, to));
  return rows.map(({ clients, ...site }) => ({ ...site, client: (clients as { name: string } | null)?.name ?? '' }));
}

function readJobs(db: Database, org: string, filters: ReportFilters): Promise<ReportData['jobs']> {
  return readPages<ReportData['jobs'][number]>((from, to) => {
    const query = db.from('interventions').select('id,site_id,kind,due_date,status')
      .eq('organization_id', org).gte('due_date', filters.from).lte('due_date', filters.to);
    if (filters.site) query.eq('site_id', filters.site);
    return query.order('id').range(from, to);
  });
}

function readRecords(db: Database, org: string, kinds: readonly OperationKind[], site = '', period?: ReportFilters) {
  return readPages<OperationRecord>((from, to) => {
    const query = db.from('operation_records').select(recordColumns).eq('organization_id', org)
      .eq('archived', false).in('kind', kinds);
    if (site) query.eq('site_id', site);
    if (period) query.gte('record_date', period.from).lte('record_date', period.to);
    return query.order('id').range(from, to);
  });
}

async function readQuotes(db: Database, org: string, filters: ReportFilters) {
  // Obtain UTC bounds wide enough for both Rome offsets, then apply the exact local dates.
  const earliest = `${filters.from}T00:00:00+02:00`;
  const latest = `${filters.to}T23:59:59.999999+01:00`;
  try {
    const rows = await readPages<QuoteSummary>((from, to) => {
      const query = db.from('estimate_quotes').select('id,site_id,title,source_name,created_at')
        .eq('organization_id', org).gte('created_at', earliest).lte('created_at', latest);
      if (filters.site) query.eq('site_id', filters.site);
      return query.order('id').range(from, to);
    });
    return rows.filter(row => {
      const date = romeDate(new Date(row.created_at));
      return filters.from <= date && date <= filters.to;
    });
  } catch (error) {
    if (isBusinessReportMigrationMissing(error)) return [];
    throw error;
  }
}

export async function readBusinessReportData(db: Database, org: string, filters: ReportFilters): Promise<ReportData> {
  const [sites, jobs, current, invoices, documents, quotes, assignments] = await Promise.all([
    readSites(db, org),
    readJobs(db, org, filters),
    readRecords(db, org, currentKinds),
    readRecords(db, org, ['invoice'], filters.site),
    readRecords(db, org, documentKinds, filters.site, filters),
    readQuotes(db, org, filters),
    readVehicleAssignments(db, org).catch(error => {
      if (isVehicleAssignmentsMigrationMissing(error)) return null;
      throw error;
    }),
  ]);
  return { sites, jobs, records: [...current, ...invoices, ...documents], quotes, assignments };
}
