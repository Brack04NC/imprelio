import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BusinessReportSection } from '@/components/business-report-section';
import { Shell } from '@/components/shell';
import { session } from '@/lib/backend';
import { romeDate } from '@/lib/domain';

export const metadata: Metadata = { title: 'Statistiche' };

export default async function Statistiche({ searchParams }: {
  searchParams: Promise<{ azienda?: string; dal?: string; al?: string; cantiere?: string }>;
}) {
  const query = await searchParams;
  const { identity, db, signedIn } = await session(typeof query.azienda === 'string' ? query.azienda : null);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  return <Shell identity={identity} section="statistiche">
    <header className="page-header">
      <div><h1>Statistiche</h1><p>Segui l’avanzamento dei lavori, le ore registrate e l’andamento economico.</p></div>
    </header>
    <BusinessReportSection identity={identity} db={db} today={romeDate()} mode="statistics" query={query}/>
  </Shell>;
}
