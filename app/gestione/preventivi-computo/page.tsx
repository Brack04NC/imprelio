import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EstimatePricing } from '@/components/estimate-pricing';
import { Shell } from '@/components/shell';
import { session } from '@/lib/backend';
import { romeDate } from '@/lib/domain';
import { readPricing } from '@/lib/estimate-pricing-backend';
import { operationSites } from '@/lib/operations-backend';
import { demoSiteOptions } from '@/lib/operations-demo';

export default async function PreventiviComputo({ searchParams }: { searchParams: Promise<{ azienda?: string; cantiere?: string }> }) {
  const query = await searchParams;
  const { identity, db, signedIn } = await session(query.azienda);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  const today = romeDate();
  const sites = db ? await operationSites(db, identity.org.id) : demoSiteOptions(today);
  const selectedSite = sites.find(site => site.id === query.cantiere)?.id;
  const filters = new URLSearchParams();
  if (selectedSite) filters.set('cantiere', selectedSite);
  if (identity.orgs.length > 1) filters.set('azienda', identity.org.id);
  const back = '/gestione/computi-metrici' + (filters.size ? `?${filters}` : '');
  const pricing = db ? await readPricing(db, identity.org.id, selectedSite).catch((error: { code?: string }) => {
    if (error.code === '42P01' || error.code === 'PGRST205') return null;
    throw error;
  }) : { rates: [], quotes: [] };
  return <Shell identity={identity} section="preventivi-computo">
    {pricing ? <EstimatePricing key={identity.org.id + ':' + (query.cantiere ?? '')} identity={identity} initial={pricing}
      sites={sites} today={today} requestedSite={query.cantiere}/> :
      <section className="empty panel"><strong>Preventivi da PDF in attesa dell’aggiornamento del database</strong>
        <p>Applica la migrazione Preventivi da computo in Supabase.</p><Link href={back} className="button secondary">Torna ai computi</Link>
      </section>}
  </Shell>;
}
