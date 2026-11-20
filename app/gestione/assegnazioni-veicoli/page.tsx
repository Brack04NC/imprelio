import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Shell } from '@/components/shell';
import { VehicleAssignments } from '@/components/vehicle-assignments';
import { session } from '@/lib/backend';
import { romeDate } from '@/lib/domain';
import { operationSites } from '@/lib/operations-backend';
import { demoSiteOptions } from '@/lib/operations-demo';
import { vehicleAssignmentSamples, vehicleSubjectSamples } from '@/lib/vehicle-assignments';
import { isVehicleAssignmentsMigrationMissing, readVehicleAssignmentList, readVehicleSubjects } from '@/lib/vehicle-assignments-backend';

export const metadata: Metadata = { title: 'Assegnazioni veicoli' };

export default async function VehicleAssignmentsPage({ searchParams }: {
  searchParams: Promise<{ azienda?: string; veicolo?: string; nuovo?: string }>;
}) {
  const query = await searchParams;
  const { identity, db, signedIn } = await session(query.azienda);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  const today = romeDate();
  const result = db ? await Promise.all([
    readVehicleAssignmentList(db, identity.org.id), readVehicleSubjects(db, identity.org.id), operationSites(db, identity.org.id),
  ]).then(([list, subjects, sites]) => ({ ...list, subjects, sites })).catch((error: unknown) => {
      if (isVehicleAssignmentsMigrationMissing(error)) return null;
      throw error;
    }) : { assignments: vehicleAssignmentSamples(today), subjects: vehicleSubjectSamples(today), sites: demoSiteOptions(today), supportsSiteAssignment: true };
  const warehousePath = '/gestione/magazzino' + (identity.orgs.length > 1 ? `?azienda=${identity.org.id}` : '');
  return <Shell identity={identity} section="magazzino" detail="Assegnazioni veicoli">
    {result ? <VehicleAssignments key={`${identity.org.id}:${query.veicolo ?? ''}:${query.nuovo ?? ''}`} identity={identity}
      initial={result.assignments} subjects={result.subjects} sites={result.sites} supportsSiteAssignment={result.supportsSiteAssignment}
      today={today} requestedVehicle={query.veicolo} newVehicle={query.nuovo === '1'}/> :
    <>
      <div className="page-header"><div><h1>Assegnazioni veicoli</h1></div></div>
      <section className="empty panel"><strong>Assegnazioni veicoli in attesa dell’aggiornamento del database</strong>
        <p>Applica in Supabase la migrazione Assegnazioni veicoli, dopo la migrazione Operatività.</p>
        <Link href={warehousePath} className="button secondary">Torna al magazzino</Link>
      </section>
    </>}
  </Shell>;
}
