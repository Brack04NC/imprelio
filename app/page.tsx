import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { HomeDashboard } from '@/components/home-dashboard';
import { session } from '@/lib/backend';
import { romeDate } from '@/lib/domain';
import { readDashboard } from '@/lib/home-dashboard-backend';
import { readDemoDashboard } from '@/lib/home-dashboard-demo';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function Home({ searchParams }: { searchParams: Promise<{ azienda?: string }> }) {
  const { azienda } = await searchParams;
  const { identity, db, signedIn } = await session(typeof azienda === 'string' ? azienda : null);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  const today = romeDate();
  const initial = db ? await readDashboard(db, identity.org.id, today) : readDemoDashboard(today, false);
  return <HomeDashboard key={identity.org.id + ':' + identity.email} identity={identity} today={today} initial={initial}/>;
}
