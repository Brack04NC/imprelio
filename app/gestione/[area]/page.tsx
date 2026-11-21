import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { OperationPage } from '@/components/operation-page';
import { Shell } from '@/components/shell';
import { session } from '@/lib/backend';
import { romeDate } from '@/lib/domain';
import { operationSites, readOperations } from '@/lib/operations-backend';
import { demoSiteOptions, forArea, operationSamples } from '@/lib/operations-demo';
import { areas } from '@/lib/operation-types';
import { isArea } from '@/lib/operations';

export async function generateMetadata({ params }: { params: Promise<{ area: string }> }): Promise<Metadata> {
  const { area } = await params;
  return { title: isArea(area) ? areas[area].title : 'Pagina non disponibile' };
}

export default async function OperationalArea({ params, searchParams }: {
  params: Promise<{ area: string }>; searchParams: Promise<{ azienda?: string; cantiere?: string; tipo?: string; veicolo?: string; scheda?: string; modifica?: string }>;
}) {
  const [{ area }, query] = await Promise.all([params, searchParams]);
  if (!isArea(area)) notFound();
  const { identity, db, signedIn } = await session(query.azienda);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  const today = romeDate();
  const result = db ? await readOperations(db, identity.org.id, area).catch((error: { code?: string }) => {
    if (error.code === '42P01' || error.code === 'PGRST205') return null;
    throw error;
  }) : forArea(operationSamples(today), area);
  if (!result) return <Shell identity={identity} section={area}>
    <div className="page-header"><div><h1>{areas[area].title}</h1></div></div>
    <section className="empty panel"><strong>Modulo in attesa dell’aggiornamento del database</strong>
      <p>Applica la migrazione Operatività in Supabase per utilizzare queste schede.</p>
      <Link href="/cantieri" className="button secondary">Torna ai cantieri</Link>
    </section>
  </Shell>;
  const sites = db ? await operationSites(db, identity.org.id) : demoSiteOptions(today);
  const vehicle = area === 'magazzino' && typeof query.veicolo === 'string' ? query.veicolo : undefined;
  const editVehicle = Boolean(vehicle && query.modifica === '1');
  const parsedRecord = z.uuid().safeParse(query.scheda);
  const record = parsedRecord.success ? parsedRecord.data.toLowerCase() : undefined;
  return <OperationPage key={JSON.stringify([identity.org.id, area, query.cantiere, query.tipo, vehicle, record, editVehicle])} identity={identity}
    area={area} today={today} initial={result} sites={sites} requestedSite={query.cantiere} requestedKind={query.tipo}
    requestedVehicle={vehicle} requestedRecord={record} editVehicle={editVehicle}/>;
}
