import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { WorkerDeadlines } from '@/components/worker-deadlines';
import styles from '@/components/worker-deadlines.module.css';
import { Shell } from '@/components/shell';
import { session } from '@/lib/backend';
import { romeDate } from '@/lib/domain';
import { isWorkerDeadlinesMigrationMissing, readDeadlineWorker, readWorkerDeadlines } from '@/lib/worker-deadlines-backend';
import { sampleDeadlineWorker, workerDeadlineSamples } from '@/lib/worker-deadlines-demo';

export const metadata: Metadata = { title: 'Scadenze operaio' };

export default async function ScadenzeOperaio({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ azienda?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const validId = z.uuid().safeParse(id);
  if (!validId.success) notFound();
  const workerId = validId.data.toLowerCase();
  const { db, identity, signedIn } = await session(typeof query.azienda === 'string' ? query.azienda : null);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  const today = romeDate();
  const worker = db ? await readDeadlineWorker(db, identity.org.id, workerId)
    : sampleDeadlineWorker(today, workerId) ?? { id: workerId, name: '', archived: true };
  if (!worker) notFound();
  const entries = db ? await readWorkerDeadlines(db, identity.org.id, worker.id).catch((error: unknown) => {
    if (isWorkerDeadlinesMigrationMissing(error)) return null;
    throw error;
  }) : workerDeadlineSamples(today, worker.id);
  const peoplePath = '/gestione/personale?tipo=worker' + (identity.orgs.length > 1 ? '&azienda=' + identity.org.id : '');

  return <Shell identity={identity} section="personale" detail="Scadenze operaio">
    {entries ? <WorkerDeadlines key={identity.org.id + worker.id} identity={identity} today={today} worker={worker} initial={entries}/> : <>
      <header className={`page-header ${styles.header}`}><div><h1>Visite, certificazioni e scadenze</h1><p>{worker.name}</p></div></header>
      <section className="panel empty">
        <strong>Attiva le scadenze degli operai</strong>
        <p>Applica la migrazione 011 in Supabase per registrare visite, certificazioni e altre scadenze.</p>
        <Link href={peoplePath} className="button secondary">Torna a Operai</Link>
      </section>
    </>}
  </Shell>;
}
