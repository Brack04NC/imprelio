'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Identity } from '@/lib/domain';
import { demoKey } from '@/lib/demo';
import { demoSiteOptions, localOperations, operationsKey } from '@/lib/operations-demo';
import type { OperationRecord, SiteOption } from '@/lib/operation-types';
import type { TrashLabel } from '@/lib/trash';
import { demoTrashKey, readDemoTombstones } from '@/lib/trash-storage';
import { localVehicleAssignments, localVehicleSubjects, missingAssignmentTargets, vehicleAssignmentsKey, type VehicleAssignment, type VehicleSubject } from '@/lib/vehicle-assignments';
import { compareVehicleLogs, lastVehicleLocation, type VehicleLogEntry, type VehicleLogInput } from '@/lib/vehicle-log';
import { localVehicleLogs, saveLocalVehicleLog, vehicleLogStorageKey } from '@/lib/vehicle-log-demo';
import { orgLink, Shell } from './shell';
import { useRomeToday } from './use-rome-today';
import { VehicleLog } from './vehicle-log';
import { VehicleProfile } from './vehicle-profile';

type Data = {
  vehicle: OperationRecord | null;
  entries: VehicleLogEntry[] | null;
  assignments: VehicleAssignment[] | null;
  subjects: VehicleSubject[];
  sites: SiteOption[];
  deletedTargets: TrashLabel[];
};

export function VehicleWorkspace({ identity, initial, id, serverToday }: {
  identity: Identity; initial: Data; id: string; serverToday: string;
}) {
  const today = useRomeToday(serverToday);
  const [data, setData] = useState(initial);
  const [ready, setReady] = useState(!identity.demo);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    if (!identity.demo) { setData(initial); return; }
    function sync() {
      try {
        const vehicle = localOperations(today, 'magazzino').find(record =>
          record.id === id && record.kind === 'article' && record.fields.category === 'vehicles') ?? null;
        const subjects = localVehicleSubjects(today);
        const sites = demoSiteOptions(today, true);
        const assignments = localVehicleAssignments(today).filter(row => row.vehicle_id === id);
        const missingTargets = missingAssignmentTargets(assignments, subjects, sites);
        const operationIds = new Set(missingTargets.operation);
        const siteIds = new Set(missingTargets.site);
        const deletedTargets = readDemoTombstones().filter(entry => entry.kind === 'operation' && operationIds.has(entry.id)
          || entry.kind === 'site' && siteIds.has(entry.id)).map(({ id, kind, label }) => ({ id, kind, label }));
        let entries: VehicleLogEntry[] | null = null;
        try { entries = localVehicleLogs(today, id); } catch { /* A damaged store stays available for recovery. */ }
        setStorageError(entries === null);
        setData({ vehicle, entries, assignments, subjects, sites, deletedTargets });
      } catch { setStorageError(true); }
      setReady(true);
    }
    function storage(event: StorageEvent) {
      if ([null, demoKey, demoTrashKey, operationsKey, vehicleAssignmentsKey, vehicleLogStorageKey].includes(event.key)) sync();
    }
    sync();
    window.addEventListener('storage', storage);
    window.addEventListener('pageshow', sync);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('pageshow', sync);
    };
  }, [id, identity.demo, initial, today]);

  async function save(input: VehicleLogInput) {
    let entry: VehicleLogEntry;
    if (identity.demo) {
      entry = navigator.locks ? await navigator.locks.request(vehicleLogStorageKey, () => saveLocalVehicleLog(today, input))
        : saveLocalVehicleLog(today, input);
    } else {
      const response = await fetch('/api/registro-veicoli?' + new URLSearchParams({ azienda: identity.org.id }), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      const result = await response.json().catch(() => null) as { entry?: VehicleLogEntry; error?: string } | null;
      if (!response.ok || !result?.entry) throw new Error(result?.error ?? 'Salvataggio non riuscito. Riprova.');
      entry = result.entry;
    }
    setData(current => ({ ...current, entries: [entry, ...(current.entries ?? []).filter(row => row.id !== entry.id)].sort(compareVehicleLogs) }));
  }

  return <Shell identity={identity} section="magazzino" detail="Scheda veicolo">
    {data.vehicle ? <>
      <VehicleProfile identity={identity} vehicle={data.vehicle} assignments={data.assignments} subjects={data.subjects}
        sites={data.sites} deletedTargets={data.deletedTargets} today={today}
        lastLocation={data.entries ? lastVehicleLocation(data.entries) : null}/>
      {data.entries ? <VehicleLog entries={data.entries} today={today} vehicleId={id} subjects={data.subjects} sites={data.sites}
        editable={!data.vehicle.archived && !storageError} onSave={save}/> : <section className="panel empty">
        <strong>{storageError ? 'Registro non disponibile nel browser' : 'Attiva il registro veicoli'}</strong>
        <p>{storageError ? 'Impossibile leggere le registrazioni salvate.' : 'Applica la migrazione 016 in Supabase per registrare utilizzi e interventi.'}</p>
      </section>}
    </> : <section className="panel empty">
      <strong>{ready ? 'Veicolo non disponibile' : 'Caricamento scheda veicolo…'}</strong>
      <Link className="button secondary" href={orgLink('/gestione/magazzino?tipo=veicoli', identity)}>Torna ai veicoli</Link>
    </section>}
  </Shell>;
}
