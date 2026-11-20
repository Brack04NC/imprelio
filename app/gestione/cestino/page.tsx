import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Shell } from '@/components/shell';
import { TrashWorkspace } from '@/components/trash-workspace';
import { session } from '@/lib/backend';
import { romeDate } from '@/lib/domain';
import { isTrashListMigrationMissing, readTrashEntries } from '@/lib/trash-backend';

export const metadata: Metadata = { title: 'Cestino' };

export default async function Cestino({ searchParams }: { searchParams: Promise<{ azienda?: string }> }) {
  const query = await searchParams;
  const organization = typeof query.azienda === 'string' ? query.azienda.toLowerCase() : null;
  const { identity, db, signedIn } = await session(organization);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  if (db && organization && identity.org.id !== organization) notFound();
  const entries = db ? await readTrashEntries(db, identity.org.id).catch((error: unknown) => {
    if (isTrashListMigrationMissing(error)) return null;
    throw error;
  }) : [];

  return <Shell identity={identity} section="cestino">
    <header className="page-header"><div><h1>Cestino</h1><p>Consulta e ripristina gli elementi eliminati.</p></div></header>
    {entries ? <TrashWorkspace key={identity.org.id} identity={identity} initial={entries} today={romeDate()}/>
      : <section className="empty panel"><strong>Cestino in attesa dell’aggiornamento del database</strong>
        <p>Applica le migrazioni 013 e 014 in Supabase per consultare e ripristinare le schede eliminate.</p>
      </section>}
  </Shell>;
}
