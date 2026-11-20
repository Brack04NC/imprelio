import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AttendanceCalendar } from '@/components/attendance-calendar';
import { Shell } from '@/components/shell';
import { attendanceMonth, attendanceMonthRange } from '@/lib/attendance';
import { isAttendanceMigrationMissing, readAttendance, readAttendancePeople } from '@/lib/attendance-backend';
import { attendancePeopleSamples, attendanceSamples } from '@/lib/attendance-demo';
import { session } from '@/lib/backend';
import { romeDate } from '@/lib/domain';
import { operationSites } from '@/lib/operations-backend';
import { demoSiteOptions } from '@/lib/operations-demo';

export const metadata: Metadata = { title: 'Presenze' };

export default async function Presenze({ searchParams }: {
  searchParams: Promise<{ azienda?: string; mese?: string; persona?: string }>;
}) {
  const query = await searchParams;
  const { db, identity, signedIn } = await session(typeof query.azienda === 'string' ? query.azienda : null);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  const today = romeDate();
  const month = attendanceMonth(query.mese, today);
  const { from, to } = attendanceMonthRange(month);
  const selected = z.uuid().safeParse(query.persona);
  const person = selected.success ? selected.data.toLowerCase() : '';

  const data = db ? await Promise.all([
    readAttendance(db, identity.org.id, from, to), readAttendancePeople(db, identity.org.id), operationSites(db, identity.org.id),
  ]).then(([entries, people, sites]) => ({ entries, people, sites })).catch((error: unknown) => {
    if (isAttendanceMigrationMissing(error)) return null;
    throw error;
  }) : { entries: attendanceSamples(today, month), people: attendancePeopleSamples(today), sites: demoSiteOptions(today) };
  const peoplePath = '/gestione/personale' + (identity.orgs.length > 1 ? '?azienda=' + identity.org.id : '');

  return <Shell identity={identity} section="presenze">
    {data ? <AttendanceCalendar key={identity.org.id} identity={identity} today={today} month={month} person={person}
      initial={data.entries} people={data.people} sites={data.sites}/> : <>
      <header className="page-header"><div><h1>Presenze</h1></div></header>
      <section className="panel empty">
        <strong>Attiva il calendario delle presenze</strong>
        <p>Applica la migrazione 010 in Supabase per registrare presenze, assenze e fasce di lavoro.</p>
        <Link href={peoplePath} className="button secondary">Torna a Personale e squadre</Link>
      </section>
    </>}
  </Shell>;
}
