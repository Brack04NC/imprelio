import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { VehicleWorkspace } from '@/components/vehicle-workspace';
import { session } from '@/lib/backend';
import { romeDate } from '@/lib/domain';
import { demoSiteOptions, operationSamples } from '@/lib/operations-demo';
import { operationSites } from '@/lib/operations-backend';
import { isTrashListMigrationMissing, readTrashLabels } from '@/lib/trash-backend';
import { missingAssignmentTargets, vehicleAssignmentSamples, vehicleSubjectSamples } from '@/lib/vehicle-assignments';
import { isVehicleAssignmentsMigrationMissing, readVehicleAssignees, readVehicleAssignmentList } from '@/lib/vehicle-assignments-backend';
import { isVehicleLogMigrationMissing, readFleetVehicle, readVehicleLog } from '@/lib/vehicle-log-backend';

export const metadata: Metadata = { title: 'Scheda veicolo' };

export default async function VehiclePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ azienda?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) notFound();
  const vehicleId = parsed.data.toLowerCase();
  const organization = typeof query.azienda === 'string' ? query.azienda.toLowerCase() : null;
  const { identity, db, signedIn } = await session(organization);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  if (db && organization && identity.org.id !== organization) notFound();
  const org = identity.org.id;
  const today = romeDate();
  if (!db) {
    const vehicle = operationSamples(today).find(record => record.id === vehicleId && record.fields.category === 'vehicles') ?? null;
    return <VehicleWorkspace key={org + ':' + vehicleId} identity={identity} id={vehicleId} serverToday={today}
      initial={{ vehicle, subjects: vehicleSubjectSamples(today), sites: demoSiteOptions(today),
        assignments: vehicleAssignmentSamples(today).filter(row => row.vehicle_id === vehicleId), deletedTargets: [], entries: [] }}/>;
  }
  const vehicle = await readFleetVehicle(db, org, vehicleId);
  if (!vehicle) notFound();
  const [entries, assignments, subjects, sites] = await Promise.all([
    readVehicleLog(db, org, vehicleId).catch((error: unknown) => { if (isVehicleLogMigrationMissing(error)) return null; throw error; }),
    readVehicleAssignmentList(db, org, vehicleId).then(list => list.assignments).catch((error: unknown) => {
      if (isVehicleAssignmentsMigrationMissing(error)) return null;
      throw error;
    }),
    readVehicleAssignees(db, org),
    operationSites(db, org),
  ]);
  const missingTargets = missingAssignmentTargets(assignments, subjects, sites);
  const deletedTargets = await Promise.all([
    readTrashLabels(db, org, 'operation', missingTargets.operation),
    readTrashLabels(db, org, 'site', missingTargets.site),
  ]).then(labels => labels.flat()).catch((error: unknown) => {
    if (isTrashListMigrationMissing(error)) return [];
    throw error;
  });
  return <VehicleWorkspace key={org + ':' + vehicleId} identity={identity} id={vehicleId} serverToday={today}
    initial={{ vehicle, entries, assignments, subjects, sites, deletedTargets }}/>;
}
