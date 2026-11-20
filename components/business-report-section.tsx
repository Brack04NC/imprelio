import Link from 'next/link';
import { isAttendanceMigrationMissing, readAttendance, readAttendancePeople } from '@/lib/attendance-backend';
import { buildAttendanceReport } from '@/lib/attendance-report';
import { buildBusinessReport, parseReportFilters } from '@/lib/business-reports';
import { isBusinessReportMigrationMissing, readBusinessReportData } from '@/lib/business-reports-backend';
import { demoBusinessReportData } from '@/lib/business-reports-demo';
import type { database } from '@/lib/backend';
import type { Identity } from '@/lib/domain';
import { ReportWorkspace } from './report-workspace';

export async function BusinessReportSection({ identity, db, today, mode, query }: {
  identity: Identity; db: Awaited<ReturnType<typeof database>> | null; today: string;
  mode: 'statistics' | 'balance'; query: { dal?: string; al?: string; cantiere?: string };
}) {
  const filters = parseReportFilters(query, today);
  const org = identity.org.id;
  const [data, attendance] = await Promise.all([
    db ? readBusinessReportData(db, org, filters).catch((error: unknown) => {
      if (isBusinessReportMigrationMissing(error)) return null;
      throw error;
    }) : demoBusinessReportData(today),
    db && mode === 'statistics' ? Promise.all([
      readAttendance(db, org, filters.from, filters.to, filters.site || undefined), readAttendancePeople(db, org),
    ]).then(([entries, people]) => ({ state: 'ready' as const, data: { entries, people } })).catch((error: unknown) => ({
      state: isAttendanceMigrationMissing(error) ? 'migration' as const : 'error' as const,
    })) : undefined,
  ]);
  if (!data) return <section className="empty panel">
    <strong>Riepiloghi in attesa dell’aggiornamento del database</strong>
    <p>Applica in Supabase la migrazione Operatività per leggere fatture e schede aziendali.</p>
    <Link href="https://github.com/Brack04NC/imprelio/blob/main/supabase/migrations/202611180002_operativita.sql" className="button secondary">Apri la migrazione 002</Link>
  </section>;
  const initialAttendance = attendance?.state === 'ready'
    ? { state: 'ready' as const, report: buildAttendanceReport(attendance.data, filters, data.sites) }
    : attendance;
  return <ReportWorkspace key={org} identity={identity} mode={mode} today={today} sites={data.sites}
    filters={filters} initial={buildBusinessReport(data, filters, today)} initialAttendance={initialAttendance}/>;
}
