import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { EstimatePricing } from '@/components/estimate-pricing';
import { Shell } from '@/components/shell';
import { readClientOptions, session } from '@/lib/backend';
import { demoSeed } from '@/lib/demo';
import { romeDate } from '@/lib/domain';
import { readPricing } from '@/lib/estimate-pricing-backend';
import { operationSites } from '@/lib/operations-backend';
import { demoSiteOptions } from '@/lib/operations-demo';

export const metadata: Metadata = { title: 'Preventivi da PDF' };

export default async function PreventiviComputo({ searchParams }: {
  searchParams: Promise<{ azienda?: string; cantiere?: string; preventivo?: string; pdf?: string }>;
}) {
  const query = await searchParams;
  const { identity, db, signedIn } = await session(query.azienda);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  const today = romeDate();
  const quoteParam = z.uuid().safeParse(query.preventivo);
  const pdfParam = z.uuid().safeParse(query.pdf);
  const requestedQuote = quoteParam.success ? quoteParam.data.toLowerCase() : undefined;
  const requestedPdf = pdfParam.success ? pdfParam.data.toLowerCase() : undefined;
  const [sites, clients] = db ? await Promise.all([operationSites(db, identity.org.id), readClientOptions(db, identity.org.id)])
    : [demoSiteOptions(today), demoSeed(today).clients];
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
    {pricing ? <EstimatePricing key={JSON.stringify([identity.org.id, query.cantiere, requestedQuote, requestedPdf])} identity={identity} initial={pricing}
      sites={sites} clients={clients} today={today} requestedSite={query.cantiere} requestedQuote={requestedQuote} requestedPdf={requestedPdf}/> :
      <section className="empty panel"><strong>Preventivi da PDF in attesa dell’aggiornamento del database</strong>
        <p>Applica la migrazione Preventivi da computo in Supabase.</p><Link href={back} className="button secondary">Torna ai computi</Link>
      </section>}
  </Shell>;
}
