import Link from 'next/link';
import { ArrowLeft, CalendarPlus, Pencil, Truck, Wrench } from 'lucide-react';
import { z } from 'zod';
import { formatDate, type Identity } from '@/lib/domain';
import { vehicleNotificationDeadlines } from '@/lib/notifications';
import type { OperationRecord, SiteOption } from '@/lib/operation-types';
import type { TrashLabel } from '@/lib/trash';
import {
  assigneeGroups, isSelectableVehicle, vehicleAssigneeGroup, type VehicleAssignment, type VehicleSubject,
} from '@/lib/vehicle-assignments';
import { vehicleMaintenance, vehicleMaintenanceState } from '@/lib/vehicle-maintenance';
import { workerDeadlineState, workerDeadlineStateLabels } from '@/lib/worker-deadlines';
import { orgLink } from './shell';
import styles from './vehicle-profile.module.css';

type ProfileProps = {
  identity: Identity;
  today: string;
  vehicle: OperationRecord;
  assignments: VehicleAssignment[] | null;
  subjects: VehicleSubject[];
  sites: SiteOption[];
  deletedTargets: TrashLabel[];
  lastLocation: { label: string; date: string } | null;
};

const date = z.iso.date().refine(value => value >= '0001-01-01');
const dateFormat = { day: 'numeric', month: 'short', year: 'numeric' } as const;
const maintenanceLabels = {
  active: 'Manutenzione in corso',
  scheduled: 'Manutenzione programmata',
  past: 'Manutenzione conclusa',
} as const;
const assignmentLabels = { active: 'In corso', scheduled: 'Programmata', past: 'Conclusa' } as const;
const assignmentOrder = { active: 0, scheduled: 1, past: 2 } as const;

function DisplayDate({ value }: { value: string }) {
  return <time dateTime={value}>{formatDate(value, dateFormat)}</time>;
}

function PeriodDates({ start, end }: { start: string; end: string }) {
  return start === end
    ? <DisplayDate value={start} />
    : <>Dal <DisplayDate value={start} /> al <DisplayDate value={end} /></>;
}

export function VehicleProfile({ identity, today, vehicle, assignments, subjects, sites, deletedTargets, lastLocation }: ProfileProps) {
  const { fields } = vehicle;
  const maintenance = vehicleMaintenance(vehicle);
  const maintenanceState = maintenance ? vehicleMaintenanceState(maintenance, today) : null;
  const selectable = isSelectableVehicle(vehicle);
  const active = selectable && maintenanceState !== 'active';
  const assignmentsPath = '/gestione/assegnazioni-veicoli';
  const subjectById = new Map(subjects.map(subject => [subject.id, subject]));
  const siteById = new Map(sites.map(site => [site.id, site]));
  const deletedByKey = new Map(deletedTargets.map(target => [`${target.kind}:${target.id}`, target.label]));
  const periods = assignments
    ?.filter(assignment => assignment.vehicle_id === vehicle.id)
    .flatMap(assignment => assignment.periods.map(period => ({
      assignment,
      period,
      state: vehicleMaintenanceState(period, today),
    })))
    .sort((first, second) => assignmentOrder[first.state] - assignmentOrder[second.state]
      || (first.state === 'past'
        ? second.period.end_date.localeCompare(first.period.end_date)
        : first.period.start_date.localeCompare(second.period.start_date)));
  const currentPeriods = periods?.filter(period => period.state !== 'past') ?? [];
  const pastPeriods = periods?.filter(period => period.state === 'past') ?? [];
  const details = [
    ['Targa', fields.plate],
    ['Matricola', fields.serial_number],
    ['Categoria', fields.vehicle_category],
    ['Codice articolo', fields.code],
    ['Posizione in anagrafica', fields.location],
  ];

  function renderPeriods(items: typeof currentPeriods) {
    return <ul className={styles.periods}>
      {items.map(({ assignment, period, state }) => {
        const site = assignment.site_id ? siteById.get(assignment.site_id) : undefined;
        const subject = assignment.assignee_id ? subjectById.get(assignment.assignee_id) : undefined;
        const deletedLabel = deletedByKey.get(assignment.site_id ? `site:${assignment.site_id}` : `operation:${assignment.assignee_id}`);
        const group = subject ? vehicleAssigneeGroup(subject) : null;
        const targetType = assignment.site_id
          ? 'Cantiere'
          : assigneeGroups.find(item => item.value === group)?.singular ?? 'Persona o squadra';
        return <li key={`${assignment.id}-${period.start_date}-${period.end_date}`}>
          <div className={styles.rowData}>
            <small>{targetType}</small>
            {site
              ? <Link className={styles.siteLink} href={orgLink(`/cantieri/${site.id}`, identity)}>{site.name}</Link>
              : <strong>{subject?.title || deletedLabel || 'Destinatario non disponibile'}</strong>}
            {deletedLabel && !site && !subject && <small>Nel cestino</small>}
            <span><PeriodDates start={period.start_date} end={period.end_date} /></span>
          </div>
          <span className={styles.badge} data-tone={state}>{assignmentLabels[state]}</span>
        </li>;
      })}
    </ul>;
  }

  return <div className={styles.profile}>
    <header className={styles.header}>
      <div>
        <Link className={styles.back} href={orgLink('/gestione/magazzino?tipo=veicoli', identity)}>
          <ArrowLeft size={16} aria-hidden="true" /> Tutti i veicoli
        </Link>
        <div className={styles.heading}>
          <Truck size={24} aria-hidden="true" />
          <h1>{vehicle.title}</h1>
          <span className={styles.badge} data-tone={vehicle.archived ? 'past' : active ? 'active' : 'expired'}>
            {vehicle.archived ? 'Archiviato' : active ? 'Attivo' : 'Fuori uso'}
          </span>
        </div>
      </div>
      {!vehicle.archived && <Link className="button" href={orgLink(`/gestione/magazzino?veicolo=${vehicle.id}&modifica=1`, identity)}>
        <Pencil size={16} aria-hidden="true" /> Modifica anagrafica
      </Link>}
    </header>

    {maintenance && maintenanceState && <div className={styles.maintenance} data-tone={maintenanceState}>
      <Wrench size={18} aria-hidden="true" />
      <div>
        <strong>{maintenanceLabels[maintenanceState]}</strong>
        <p><PeriodDates start={maintenance.start_date} end={maintenance.end_date} /></p>
      </div>
    </div>}

    <div className={styles.grid}>
      <section className={`panel ${styles.panel}`} aria-labelledby="vehicle-details">
        <h2 id="vehicle-details">Anagrafica</h2>
        <dl className={styles.fields}>
          {details.map(([label, value]) => <div key={label}>
            <dt>{label}</dt>
            <dd>{value || 'Non indicato'}</dd>
          </div>)}
          <div>
            <dt>Ultima posizione registrata</dt>
            <dd>{lastLocation?.label || 'Nessuna registrazione'}</dd>
            {lastLocation && date.safeParse(lastLocation.date).success && <dd className={styles.locationDate}>
              <DisplayDate value={lastLocation.date} />
            </dd>}
          </div>
          {fields.notes && <div className={styles.notes}>
            <dt>Note</dt>
            <dd>{fields.notes}</dd>
          </div>}
        </dl>
      </section>

      <section className={`panel ${styles.panel}`} aria-labelledby="vehicle-deadlines">
        <h2 id="vehicle-deadlines">Scadenze</h2>
        <dl className={styles.deadlines}>
          {vehicleNotificationDeadlines.map(({ field, label }) => {
            const parsed = date.safeParse(fields[field]);
            const dueOn = parsed.success ? parsed.data : null;
            const state = workerDeadlineState({ due_on: dueOn }, today);
            return <div key={field}>
              <dt>{label}</dt>
              <dd>
                {dueOn && <DisplayDate value={dueOn} />}
                <span className={styles.badge} data-tone={state}>{workerDeadlineStateLabels[state]}</span>
              </dd>
            </div>;
          })}
        </dl>
      </section>
    </div>

    <section className={`panel ${styles.panel}`} aria-labelledby="vehicle-assignments">
      <div className={styles.panelHeader}>
        <h2 id="vehicle-assignments">Assegnazioni</h2>
        <div className={styles.actions}>
          <Link className="button" href={orgLink(assignmentsPath, identity)}>Gestisci assegnazioni</Link>
          {selectable && <Link className="button primary" href={orgLink(`${assignmentsPath}?veicolo=${vehicle.id}`, identity)}>
            <CalendarPlus size={16} aria-hidden="true" /> Nuova assegnazione
          </Link>}
        </div>
      </div>
      {assignments === null && <p className={styles.empty}>Assegnazioni temporaneamente non disponibili.</p>}
      {periods?.length === 0 && <p className={styles.empty}>Nessuna assegnazione registrata.</p>}
      {currentPeriods.length > 0 && renderPeriods(currentPeriods)}
      {pastPeriods.length > 0 && <details className={styles.history} open={currentPeriods.length === 0}>
        <summary>Periodi conclusi ({pastPeriods.length})</summary>
        {renderPeriods(pastPeriods)}
      </details>}
    </section>
  </div>;
}
