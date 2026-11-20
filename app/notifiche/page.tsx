import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { NotificationsWorkspace } from '@/components/notifications-workspace';
import { session } from '@/lib/backend';

export const metadata: Metadata = { title: 'Centro notifiche' };

export default async function Notifiche({ searchParams }: { searchParams: Promise<{ azienda?: string; vista?: string }> }) {
  const query = await searchParams;
  const organization = typeof query.azienda === 'string' ? query.azienda.toLowerCase() : null;
  const { identity, db, signedIn } = await session(organization);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  if (db && organization && identity.org.id !== organization) notFound();
  const history = query.vista === 'cronologia';
  return <NotificationsWorkspace key={`${identity.org.id}:${history}`} identity={identity} history={history}/>;
}
