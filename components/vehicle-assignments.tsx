'use client';

import Link from 'next/link';
import { ArrowLeft, CalendarDays, Pencil, Plus, Search, Trash2, Truck, Wrench, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Drawer } from './editor';
import { orgLink } from './shell';
import { useRomeToday } from './use-rome-today';
import { demoKey } from '@/lib/demo';
import { formatDate, type Identity } from '@/lib/domain';
import { demoSiteOptions, operationsKey, updateLocalOperation } from '@/lib/operations-demo';
import { validateOperation } from '@/lib/operations';
import type { SiteOption } from '@/lib/operation-types';
import { assigneeGroups, hasVehicleConflict, isSelectableAssignee, isSelectableVehicle, localVehicleAssignments, localVehicleSubjects,
  maxVehiclePeriods, updateLocalVehicleAssignment, validateVehicleAssignment, vehicleAssigneeGroup, vehicleAssignmentState, vehicleAssignmentsKey,
  type VehicleAssignment, type VehicleAssignmentAction, type VehiclePeriod, type VehicleSubject } from '@/lib/vehicle-assignments';
import { maintenanceBookingError, overlapsVehicleMaintenance, vehicleMaintenance, vehicleMaintenanceState } from '@/lib/vehicle-maintenance';
import styles from './vehicle-assignments.module.css';

const stateLabels = { active: 'In corso', scheduled: 'Programmata', past: 'Conclusa' } as const;
const stateOrder = { active: 0, scheduled: 1, past: 2 } as const;
const statusFilters = [
  { value: 'all', label: 'Tutte' }, { value: 'active', label: 'In corso' },
  { value: 'scheduled', label: 'Programmate' }, { value: 'past', label: 'Concluse' },
] as const;
const pageSize = 12;

type Filter = typeof statusFilters[number]['value'];
type PeriodDraft = VehiclePeriod & { key: string };
type AssignmentDraft = {
  id: string; vehicle_id: string; destination: string; periods: PeriodDraft[];
  createVehicle: boolean; vehicleDraft: { id: string; name: string; code: string } | null;
};

function createPeriod(start = '', end = ''): PeriodDraft {
  return { key: crypto.randomUUID(), start_date: start, end_date: end };
}

function describeVehicle(subject: VehicleSubject) {
  return [subject.title, subject.fields.code].filter(Boolean).join(' · ');
}

function describeSite(site: SiteOption) {
  return [site.name, site.city, site.client].filter(Boolean).join(' · ');
}

function compareSubjects(a: VehicleSubject, b: VehicleSubject) {
  return a.title.localeCompare(b.title, 'it');
}

function describePeriod({ start_date, end_date }: VehiclePeriod) {
  const date = (value: string) => formatDate(value, { day: 'numeric', month: 'short', year: 'numeric' });
  return start_date === end_date ? date(start_date) : `${date(start_date)} – ${date(end_date)}`;
}

async function submitJson(path: string, organization: string, payload: unknown): Promise<unknown> {
  const response = await fetch(path + '?' + new URLSearchParams({ azienda: organization }), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'Operazione non riuscita. Riprova.');
  return result;
}

export function VehicleAssignments({ identity, initial, subjects, sites, today: initialToday, requestedVehicle, newVehicle,
  supportsSiteAssignment = true }: {
  identity: Identity; initial: VehicleAssignment[]; subjects: VehicleSubject[]; sites: SiteOption[]; today: string;
  requestedVehicle?: string; newVehicle?: boolean; supportsSiteAssignment?: boolean;
}) {
  const today = useRomeToday(initialToday);
  const [assignments, setAssignments] = useState(initial);
  const [availableSubjects, setAvailableSubjects] = useState(subjects);
  const [availableSites, setAvailableSites] = useState(sites);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<AssignmentDraft | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string } | null>(null);
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const fromLink = useRef(false);
  const backFocus = useRef<HTMLElement | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const cancelRemove = useRef<HTMLButtonElement>(null);
  const periodToFocus = useRef('');

  useEffect(() => {
    if (!identity.demo) {
      setAssignments(initial);
      setAvailableSubjects(subjects);
      setAvailableSites(sites);
    }
  }, [identity.demo, initial, sites, subjects]);

  useEffect(() => {
    if (!identity.demo) return;
    function sync() {
      setAssignments(localVehicleAssignments(today));
      setAvailableSubjects(localVehicleSubjects(today));
      setAvailableSites(demoSiteOptions(today, true));
    }
    sync();
    const onStorage = (event: StorageEvent) => {
      if ([operationsKey, vehicleAssignmentsKey, demoKey, null].includes(event.key)) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [identity.demo, today]);

  useEffect(() => {
    if (fromLink.current || (!requestedVehicle && !newVehicle)) return;
    fromLink.current = true;
    const choices = (identity.demo ? localVehicleSubjects(today) : subjects).filter(isSelectableVehicle);
    const vehicle = choices.find(subject => subject.id === requestedVehicle);
    setDraft({ id: crypto.randomUUID(), vehicle_id: vehicle?.id ?? '', destination: '', periods: [createPeriod(today, today)],
      createVehicle: Boolean(newVehicle) || choices.length === 0, vehicleDraft: null });
    if (requestedVehicle && !vehicle) setError({ text: choices.length
      ? 'Il veicolo collegato non è disponibile. Seleziona un altro veicolo.'
      : 'Il veicolo collegato non è disponibile. Crea un nuovo veicolo per proseguire.' });
  }, [identity.demo, newVehicle, requestedVehicle, subjects, today]);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (confirmRemove) cancelRemove.current?.focus(); }, [confirmRemove]);
  useEffect(() => {
    if (!periodToFocus.current) return;
    document.getElementById('vehicle-period-' + periodToFocus.current)?.focus();
    periodToFocus.current = '';
  }, [draft?.periods]);

  const subjectMap = useMemo(() => new Map(availableSubjects.map(subject => [subject.id, subject])), [availableSubjects]);
  const vehicles = useMemo(() => availableSubjects.filter(isSelectableVehicle).sort(compareSubjects), [availableSubjects]);
  const assignees = useMemo(() => availableSubjects.filter(isSelectableAssignee).sort(compareSubjects), [availableSubjects]);
  const siteOptions = useMemo(() => supportsSiteAssignment ? [...availableSites].sort((a, b) => a.name.localeCompare(b.name, 'it')) : [],
    [availableSites, supportsSiteAssignment]);
  const siteMap = useMemo(() => new Map(siteOptions.map(site => [site.id, site])), [siteOptions]);
  const hasDestinations = assignees.length > 0 || siteOptions.length > 0;
  const groupedAssignees = assigneeGroups.map(group => ({ ...group, members: assignees.filter(subject => vehicleAssigneeGroup(subject) === group.value) }));
  const editing = draft ? assignments.find(item => item.id === draft.id) : undefined;
  const missingSubject = editing && (!vehicles.some(vehicle => vehicle.id === editing.vehicle_id) ||
    (editing.site_id ? !siteMap.has(editing.site_id) : !assignees.some(person => person.id === editing.assignee_id)));
  const maintenances = useMemo(() => availableSubjects.flatMap(vehicle => {
    const period = vehicle.archived ? null : vehicleMaintenance(vehicle);
    return period ? [{ vehicle, period, state: vehicleMaintenanceState(period, today) }] : [];
  }).sort((a, b) => stateOrder[a.state] - stateOrder[b.state] ||
    (a.state === 'past' ? b.period.end_date.localeCompare(a.period.end_date) : a.period.start_date.localeCompare(b.period.start_date)) ||
    compareSubjects(a.vehicle, b.vehicle)), [availableSubjects, today]);
  const selectedVehicle = draft && !draft.createVehicle ? subjectMap.get(draft.vehicle_id) : undefined;
  const selectedMaintenance = selectedVehicle ? vehicleMaintenance(selectedVehicle) : null;
  const conflictingPeriods = new Set(draft?.periods.filter(period => selectedVehicle && period.start_date && period.end_date &&
    period.start_date <= period.end_date && overlapsVehicleMaintenance(selectedVehicle, [period])).map(period => period.key));
  const counts = { all: assignments.length, active: 0, scheduled: 0, past: 0 };
  const needle = query.trim().toLocaleLowerCase('it');
  const visible = assignments.filter(assignment => {
    const status = vehicleAssignmentState(assignment, today);
    counts[status]++;
    if (filter !== 'all' && filter !== status) return false;
    const vehicle = subjectMap.get(assignment.vehicle_id);
    const assignee = assignment.assignee_id ? subjectMap.get(assignment.assignee_id) : undefined;
    const site = assignment.site_id ? siteMap.get(assignment.site_id) : undefined;
    const description = [vehicle?.title, vehicle?.fields.code, assignee?.title, assignee?.fields.company, site && describeSite(site)].join(' ');
    return description.toLocaleLowerCase('it').includes(needle);
  }).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pages);

  function open(assignment?: VehicleAssignment) {
    backFocus.current = document.activeElement as HTMLElement | null;
    setError(null); setConfirmRemove(false);
    const siteId = assignment?.site_id;
    const assigneeId = assignment?.assignee_id;
    setDraft({
      id: assignment?.id ?? crypto.randomUUID(),
      vehicle_id: vehicles.some(vehicle => vehicle.id === assignment?.vehicle_id) ? assignment!.vehicle_id : '',
      destination: siteId && siteMap.has(siteId) ? `site:${siteId}` : assigneeId && assignees.some(person => person.id === assigneeId) ? assigneeId : '',
      periods: assignment ? assignment.periods.map(period => createPeriod(period.start_date, period.end_date)) : [createPeriod(today, today)],
      createVehicle: vehicles.length === 0, vehicleDraft: null,
    });
  }

  function close() {
    setDraft(null); setError(null); setConfirmRemove(false);
    requestAnimationFrame(() => {
      if (backFocus.current?.isConnected) backFocus.current.focus();
      else newButton.current?.focus();
    });
  }

  function editPeriod(key: string, field: keyof VehiclePeriod, value: string) {
    setDraft(current => current && { ...current, periods: current.periods.map(period => period.key === key ? { ...period, [field]: value } : period) });
  }

  function addPeriod() {
    const period = createPeriod();
    periodToFocus.current = period.key;
    setDraft(current => current && { ...current, periods: [...current.periods, period] });
  }

  function removePeriod(key: string, index: number) {
    if (!draft) return;
    const remaining = draft.periods.filter(period => period.key !== key);
    periodToFocus.current = remaining[Math.min(index, remaining.length - 1)]?.key ?? '';
    setDraft({ ...draft, periods: remaining });
  }

  function toggleVehicleCreation() {
    setDraft(current => current && { ...current, createVehicle: !current.createVehicle,
      vehicleDraft: current.vehicleDraft ?? { id: crypto.randomUUID(), name: '', code: '' } });
    setError(null);
  }

  async function persist(action: VehicleAssignmentAction) {
    if (identity.demo) {
      const saved = updateLocalVehicleAssignment(today, action);
      setAssignments(localVehicleAssignments(today));
      return saved;
    }
    const result = await submitJson('/api/assegnazioni-veicoli', identity.org.id, action) as { assignment: VehicleAssignment | null };
    if (action.action === 'save' && !result.assignment) throw new Error('Il server non ha restituito l’assegnazione salvata.');
    setAssignments(current => result.assignment ? [result.assignment, ...current.filter(item => item.id !== action.id)]
      : current.filter(item => item.id !== action.id));
    return result.assignment;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null); setNotice('');
    let storedVehicle = false;
    try {
      if (confirmRemove) {
        await persist({ action: 'remove', id: draft.id });
        setNotice('Assegnazione rimossa.');
        close();
        return;
      }
      const creating = draft.createVehicle ? draft.vehicleDraft : null;
      const siteId = draft.destination.startsWith('site:') ? draft.destination.slice(5) : null;
      const action = validateVehicleAssignment({ action: 'save', id: draft.id,
        vehicle_id: creating?.id ?? draft.vehicle_id,
        assignee_id: siteId ? null : draft.destination, site_id: siteId,
        periods: draft.periods.map(({ start_date, end_date }) => ({ start_date, end_date })) });
      if (action.action !== 'save') return;
      if (selectedVehicle && overlapsVehicleMaintenance(selectedVehicle, action.periods)) throw new Error(maintenanceBookingError);
      const fresh = identity.demo ? localVehicleAssignments(today) : assignments;
      if (hasVehicleConflict(action, fresh)) throw new Error('Il veicolo è già assegnato per almeno una delle date selezionate.');
      if (creating) {
        if (!creating.code.trim()) throw new Error('Inserisci la targa o il codice del veicolo.');
        const record = validateOperation({ action: 'save', id: creating.id, kind: 'article', title: creating.name,
          status: 'active', site_id: null, record_date: null, fields: { category: 'vehicles', unit: 'pz', code: creating.code } });
        if (record.action !== 'save') throw new Error('Il veicolo non è valido.');
        if (identity.demo) updateLocalOperation(today, record);
        else await submitJson('/api/operativita', identity.org.id, record);
        const { action: _, ...vehicle } = record;
        storedVehicle = true;
        setAvailableSubjects(current => [{ ...vehicle, archived: false }, ...current.filter(item => item.id !== vehicle.id)]);
        setDraft(current => current && { ...current, vehicle_id: vehicle.id, createVehicle: false, vehicleDraft: null });
      }
      await persist(action);
      setFilter('all'); setPage(1); setQuery('');
      setNotice('Assegnazione salvata.');
      close();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Operazione non riuscita. Riprova.';
      setError({ text: (storedVehicle ? 'Il veicolo è stato salvato in magazzino. ' : '') + message });
    } finally { setBusy(false); inFlight.current = false; }
  }

  return <>
    <Link href={orgLink('/gestione/magazzino', identity)} className="button text-button back-link"><ArrowLeft size={16}/> Magazzino</Link>
    <div className="page-header"><div><h1>Assegnazioni veicoli</h1>
      <p>{supportsSiteAssignment ? 'Prenota un veicolo per una persona, una squadra o un cantiere.' :
        'Prenota un veicolo per una persona o una squadra.'}</p></div>
      <div className={styles.headerActions}>
        <a href="#manutenzioni-veicoli" className="button secondary"><Wrench size={16}/> Manutenzioni</a>
        <button ref={newButton} type="button" className="button primary" onClick={() => open()}><Plus size={18}/> Nuova assegnazione</button>
      </div>
    </div>
    {notice && <p className="access-notice" role="status">{notice}</p>}
    <section className={`panel ${styles.listPanel}`} aria-label="Elenco assegnazioni">
      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Stato delle assegnazioni">
          {statusFilters.map(option => <button key={option.value} type="button" className={`button ${filter === option.value ? 'primary' : 'secondary'}`}
            aria-pressed={filter === option.value} onClick={() => { setFilter(option.value); setPage(1); }}>
            {option.label} <span className={styles.count}>{counts[option.value]}</span></button>)}
        </div>
        <label className={`search-field ${styles.search}`}><Search size={17}/><input aria-label="Cerca veicolo o destinazione"
          value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Cerca veicolo o destinazione"/></label>
      </div>
      {visible.length ? <ul className={styles.records}>{visible.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(assignment => {
        const vehicle = subjectMap.get(assignment.vehicle_id);
        const assignee = assignment.assignee_id ? subjectMap.get(assignment.assignee_id) : undefined;
        const site = assignment.site_id ? siteMap.get(assignment.site_id) : undefined;
        const group = assignee && assigneeGroups.find(item => item.value === vehicleAssigneeGroup(assignee));
        const status = vehicleAssignmentState(assignment, today);
        return <li key={assignment.id} className={styles.record}>
          <span className={styles.recordIcon}><Truck size={20}/></span>
          <div className={styles.details}>
            <strong>{vehicle ? describeVehicle(vehicle) : 'Veicolo non disponibile'}</strong>
            <p>{assignment.site_id ? site
              ? <>Cantiere · <Link className={styles.siteLink} href={orgLink(`/cantieri/${site.id}`, identity)}>{describeSite(site)}</Link></>
              : 'Cantiere non disponibile'
              : [assignee?.title ?? 'Assegnatario non disponibile', group?.singular].filter(Boolean).join(' · ')}</p>
            <ul className={styles.periodTags} aria-label="Periodi assegnati">
              {assignment.periods.map(period => <li key={period.start_date}><CalendarDays size={14}/>{describePeriod(period)}</li>)}
            </ul>
          </div>
          <div className={styles.assignmentActions}>
            <span className={`badge ${status === 'active' ? 'badge-active' : status === 'scheduled' ? 'badge-planned' : ''}`}>
              <i/>{stateLabels[status]}</span>
            <button type="button" className="button secondary" onClick={() => open(assignment)}><Pencil size={15}/> Modifica</button>
          </div>
        </li>;
      })}</ul> : <div className="empty"><Truck size={24}/><strong>{assignments.length ? 'Nessun risultato' : 'Nessuna assegnazione'}</strong>
        <p>{assignments.length ? 'Modifica i filtri o cerca un altro veicolo.' : 'Seleziona un veicolo per programmare il primo periodo.'}</p>
        {assignments.length > 0 && <button type="button" className="button secondary" onClick={() => {
          setFilter('all'); setQuery(''); setPage(1);
        }}>Azzera filtri</button>}
      </div>}
      {pages > 1 && <div className={styles.pagination}>
        <button type="button" className="button secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Precedente</button>
        <span>Pagina {currentPage} di {pages}</span>
        <button type="button" className="button secondary" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Successiva</button>
      </div>}
    </section>
    <section id="manutenzioni-veicoli" className={`panel ${styles.maintenancePanel}`} aria-labelledby="manutenzioni-veicoli-title" tabIndex={-1}>
      <header className="panel-header"><div>
        <h2 id="manutenzioni-veicoli-title">Manutenzioni veicoli</h2>
        <p>Imposta le date nella scheda del veicolo in Magazzino.</p>
      </div></header>
      {maintenances.length ? <ul className={styles.records}>{maintenances.map(({ vehicle, period, state }) => <li key={vehicle.id} className={styles.record}>
        <span className={`${styles.recordIcon} ${styles.maintenanceIcon}`}><Wrench size={19} aria-hidden="true"/></span>
        <div className={styles.details}>
          <strong>{describeVehicle(vehicle)}</strong>
          <p>{describePeriod(period)}</p>
        </div>
        <div className={styles.assignmentActions}>
          <span className={`badge ${state === 'active' ? 'badge-paused' : state === 'scheduled' ? 'badge-planned' : ''}`}><i/>{stateLabels[state]}</span>
          <Link href={orgLink(`/gestione/magazzino?${new URLSearchParams({ veicolo: vehicle.id })}`, identity)}
            className="button secondary" aria-label={`Apri veicolo ${describeVehicle(vehicle)}`}>Apri veicolo</Link>
        </div>
      </li>)}</ul> : <div className="empty"><Wrench size={24}/><strong>Nessuna manutenzione registrata</strong>
        <Link href={orgLink('/gestione/magazzino', identity)} className="button secondary">Apri Magazzino</Link>
      </div>}
    </section>
    {draft && <Drawer title={confirmRemove ? 'Rimuovi assegnazione' : editing ? 'Modifica assegnazione' : 'Nuova assegnazione'} busy={busy} onClose={close}>
      <form className="editor-form" onSubmit={save}>
        <fieldset className="drawer-fields form-grid" disabled={busy}>
          {confirmRemove ? <p className={styles.hint}>Questa operazione rimuove tutti i periodi di questa assegnazione.</p> : <>
            {missingSubject && <p className={styles.hint}>Il veicolo o la destinazione precedente non è più disponibile. Seleziona una voce disponibile.</p>}
            {draft.createVehicle ? <div className={styles.newVehicle}>
              <label>Nome del veicolo<input autoFocus required maxLength={160} value={draft.vehicleDraft?.name ?? ''} placeholder="Es. Furgone cassonato"
                onChange={event => setDraft({ ...draft, vehicleDraft: { id: draft.vehicleDraft?.id ?? crypto.randomUUID(), code: draft.vehicleDraft?.code ?? '', name: event.target.value } })}/></label>
              <label>Targa o codice<input required maxLength={40} value={draft.vehicleDraft?.code ?? ''} placeholder="Es. AB123CD"
                onChange={event => setDraft({ ...draft, vehicleDraft: { id: draft.vehicleDraft?.id ?? crypto.randomUUID(), name: draft.vehicleDraft?.name ?? '', code: event.target.value } })}/></label>
              <p className={styles.hint}>Al salvataggio il veicolo verrà aggiunto al magazzino.</p>
            </div> : <label>Veicolo dal magazzino<select autoFocus required value={draft.vehicle_id} onChange={event => setDraft({ ...draft, vehicle_id: event.target.value })}>
              <option value="">Seleziona un veicolo</option>
              {vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{describeVehicle(vehicle)}</option>)}
            </select></label>}
            {(vehicles.length > 0 || !draft.createVehicle) && <button type="button" className={`button text-button ${styles.alignStart}`} onClick={toggleVehicleCreation}>
              {draft.createVehicle ? 'Scegli un veicolo dal magazzino' : <><Plus size={16}/> Crea un veicolo</>}</button>}
            {hasDestinations ? <label>Assegna a<select required value={draft.destination} onChange={event => setDraft({ ...draft, destination: event.target.value })}>
              <option value="">Seleziona la destinazione</option>
              {siteOptions.length > 0 && <optgroup label="Cantiere">
                {siteOptions.map(site => <option key={site.id} value={`site:${site.id}`}>{describeSite(site)}</option>)}
              </optgroup>}
              {groupedAssignees.filter(group => group.members.length).map(group => <optgroup key={group.value} label={group.label}>
                {group.members.map(member => <option key={member.id} value={member.id}>{member.title}</option>)}
              </optgroup>)}
            </select></label> : <div className={styles.prerequisite}>
              <p className={styles.hint}>{supportsSiteAssignment ? 'Aggiungi un cantiere, una persona o una squadra per programmare l’assegnazione.' :
                'Aggiungi una persona o una squadra per programmare l’assegnazione.'}</p>
              <div className={styles.headerActions}>
                {supportsSiteAssignment && <Link className="button secondary" href={orgLink('/cantieri', identity)}>Apri Cantieri</Link>}
                <Link className="button secondary" href={orgLink('/gestione/personale', identity)}>Apri Personale e squadre</Link>
              </div>
            </div>}
            <section className={styles.periods} aria-labelledby="vehicle-periods-title">
              <div><h3 id="vehicle-periods-title">Periodi di utilizzo</h3><p className={styles.hint}>I giorni di inizio e fine sono inclusi.</p></div>
              {selectedMaintenance && <div className={styles.maintenanceNotice}>
                <Wrench size={18} aria-hidden="true"/>
                <div><strong>Manutenzione · {stateLabels[vehicleMaintenanceState(selectedMaintenance, today)]}</strong>
                  <p>{describePeriod(selectedMaintenance)}</p></div>
              </div>}
              <div role="status" className="sr-only">{conflictingPeriods.size > 0 && maintenanceBookingError}</div>
              {draft.periods.map((period, index) => {
                const conflict = conflictingPeriods.has(period.key);
                const conflictId = `vehicle-period-conflict-${period.key}`;
                return <div key={period.key} className={`${styles.period} ${conflict ? styles.conflictingPeriod : ''}`}>
                  <header><strong>Periodo {index + 1}</strong>
                    {draft.periods.length > 1 && <button type="button" className="icon-button" aria-label={`Rimuovi periodo ${index + 1}`}
                      onClick={() => removePeriod(period.key, index)}><X size={17}/></button>}
                  </header>
                  <div className={`form-pair ${styles.periodDates}`}>
                    <label>Data di inizio<input id={'vehicle-period-' + period.key} type="date" aria-label={`Data di inizio periodo ${index + 1}`} required value={period.start_date}
                      aria-invalid={conflict || undefined} aria-describedby={conflict ? conflictId : undefined}
                      onChange={event => editPeriod(period.key, 'start_date', event.target.value)}/></label>
                    <label>Data di fine<input type="date" aria-label={`Data di fine periodo ${index + 1}`} required min={period.start_date || undefined} value={period.end_date}
                      aria-invalid={conflict || undefined} aria-describedby={conflict ? conflictId : undefined}
                      onChange={event => editPeriod(period.key, 'end_date', event.target.value)}/></label>
                  </div>
                  {conflict && <p id={conflictId} className={styles.conflictMessage}>Scegli date al di fuori della manutenzione.</p>}
                </div>;
              })}
              <button type="button" className={`button secondary ${styles.alignStart}`} disabled={draft.periods.length >= maxVehiclePeriods}
                onClick={addPeriod}><Plus size={16}/> Aggiungi periodo</button>
            </section>
          </>}
          {error && <p ref={errorRef} tabIndex={-1} className={`form-error ${styles.formAlert}`} role="alert">{error.text}</p>}
        </fieldset>
        <footer className={`drawer-footer ${styles.drawerFooter}`}>
          {editing && !confirmRemove && <button type="button" className={`button secondary ${styles.remove}`} disabled={busy}
            onClick={() => { setError(null); setConfirmRemove(true); }}><Trash2 size={16}/> Rimuovi</button>}
          <button ref={cancelRemove} type="button" className="button secondary" disabled={busy} onClick={confirmRemove ? () => { setConfirmRemove(false); setError(null); } : close}>{confirmRemove ? 'Indietro' : 'Annulla'}</button>
          <button type="submit" className={`button ${confirmRemove ? styles.danger : 'primary'}`}
            disabled={busy || (!confirmRemove && (!hasDestinations || conflictingPeriods.size > 0))}>
            {busy ? 'Attendi…' : confirmRemove ? 'Conferma rimozione' : 'Salva assegnazione'}</button>
        </footer>
      </form>
    </Drawer>}
  </>;
}
