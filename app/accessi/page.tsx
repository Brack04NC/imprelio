import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccessPage } from '@/components/access-page';
import { readAccess, session } from '@/lib/backend';
import { demoSeed } from '@/lib/demo';
import { romeDate } from '@/lib/domain';

export const metadata: Metadata = { title: 'Gestione accessi' };

export default async function Accessi({ searchParams }: { searchParams: Promise<{ azienda?: string }> }) {
  const { azienda } = await searchParams;
  const { identity, db, signedIn } = await session(azienda);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  if (identity.org.role !== 'admin') notFound();
  const today = romeDate();
  const access = db ? await readAccess(db, identity.org.id) : demoSeed(today).access;
  return <AccessPage identity={identity} initial={access} today={today} />;
}
