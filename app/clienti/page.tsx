import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ClientDirectory } from '@/components/clients-page';
import { Shell } from '@/components/shell';
import { session } from '@/lib/backend';
import { demoClientDirectory, readClientDirectory } from '@/lib/client-directory';
import { demoSeed } from '@/lib/demo';
import { romeDate } from '@/lib/domain';

export const metadata: Metadata = { title: 'Clienti' };

export default async function Clienti({ searchParams }: { searchParams: Promise<{ azienda?: string }> }) {
  const { azienda } = await searchParams;
  const { identity, db, signedIn } = await session(azienda);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  const today = romeDate();
  const initial = db ? await readClientDirectory(db, identity.org.id).catch((error: { code?: string }) => {
    if (error.code === 'PGRST202' || error.code === '42883') return null;
    throw error;
  }) : demoClientDirectory(demoSeed(today));
  if (!initial) {
    const overview = identity.orgs.length > 1 ? `/cantieri?azienda=${identity.org.id}` : '/cantieri';
    return <Shell identity={identity} section="clienti">
      <div className="page-header"><div><h1>Clienti</h1></div></div>
      <section className="empty panel"><strong>Modulo in attesa dell’aggiornamento del database</strong>
        <p>Applica la migrazione Clienti in Supabase per utilizzare queste schede.</p>
        <Link href={overview} className="button secondary">Torna ai cantieri</Link>
      </section>
    </Shell>;
  }
  return <ClientDirectory key={identity.org.id} identity={identity} initial={initial} today={today} />;
}
