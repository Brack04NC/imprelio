import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AgendaPage } from '@/components/agenda-page';
import { agendaRange, agendaView } from '@/lib/agenda';
import { readAgenda } from '@/lib/agenda-backend';
import { session } from '@/lib/backend';
import { calendarRange, calendarSelection, calendarViews } from '@/lib/calendar';
import { demoAgenda, demoSeed } from '@/lib/demo';
import { romeDate } from '@/lib/domain';
import { operationSites } from '@/lib/operations-backend';

type AgendaProps = {
  searchParams: Promise<{ azienda?: string; periodo?: string; data?: string; calendario?: string }>;
};

export async function generateMetadata({ searchParams }: AgendaProps): Promise<Metadata> {
  const { calendario } = await searchParams;
  return { title: calendarViews.some(view => view.id === calendario) ? 'Calendario' : 'Agenda' };
}

export default async function Agenda({ searchParams }: AgendaProps) {
  const query = await searchParams;
  const { identity, db, signedIn } = await session(typeof query.azienda === 'string' ? query.azienda : null);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  const today = romeDate();
  const view = agendaView(query.periodo, query.data);
  const calendar = calendarSelection(query.calendario, query.data, today);
  const range = calendar ? calendarRange(calendar) : agendaRange(view, today);
  if (db) {
    const [items, sites] = await Promise.all([
      readAgenda(db, identity.org.id, range),
      operationSites(db, identity.org.id),
    ]);
    return <AgendaPage key={identity.org.id} identity={identity} today={today} view={view} calendar={calendar} items={items} sites={sites}/>;
  }
  return <AgendaPage identity={identity} today={today} view={view} calendar={calendar} {...demoAgenda(demoSeed(today), range)}/>;
}
