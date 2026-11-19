import Link from 'next/link';
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
  const data = db ? await readBusinessReportData(db, identity.org.id, filters).catch((error: unknown) => {
    if (isBusinessReportMigrationMissing(error)) return null;
    throw error;
  }) : demoBusinessReportData(today);
  if (!data) return <section className="empty panel">
    <strong>Riepiloghi in attesa dell’aggiornamento del database</strong>
    <p>Applica in Supabase la migrazione Operatività per leggere fatture e schede aziendali.</p>
    <Link href="https://github.com/Brack04NC/imprelio/blob/main/supabase/migrations/202611180002_operativita.sql" className="button secondary">Apri la migrazione 002</Link>
  </section>;
  return <ReportWorkspace key={identity.org.id} identity={identity} mode={mode} today={today} sites={data.sites}
    filters={filters} initial={buildBusinessReport(data, filters, today)}/>;
}
