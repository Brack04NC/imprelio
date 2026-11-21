'use client';

import { ClipboardList, Pencil, Plus, Truck, Wrench } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { formatDate } from '@/lib/domain';
import type { SiteOption } from '@/lib/operation-types';
import { assigneeGroups, isSelectableAssignee, vehicleAssigneeGroup, type VehicleSubject } from '@/lib/vehicle-assignments';
import { compareVehicleLogs, type VehicleLogEntry, type VehicleLogInput, type VehicleLogKind } from '@/lib/vehicle-log';
import { Drawer } from './editor';
import styles from './vehicle-log.module.css';

type Mode = 'usage' | 'intervention';
type Selection = { mode: Mode; entry?: VehicleLogEntry };

const maintenanceKinds = ['maintenance', 'extraordinary'] as const;
const kindLabels: Record<VehicleLogKind, string> = {
  usage: 'Utilizzo', maintenance: 'Manutenzione ordinaria', extraordinary: 'Manutenzione straordinaria',
};
const stateLabels = { planned: 'Programmato', done: 'Eseguito' } as const;
const dateOptions = { day: 'numeric', month: 'short', year: 'numeric' } as const;

function periodLabel(entry: VehicleLogEntry) {
  return <><time dateTime={entry.start_date}>{formatDate(entry.start_date, dateOptions)}</time>
    {entry.start_date !== entry.end_date && <> – <time dateTime={entry.end_date}>{formatDate(entry.end_date, dateOptions)}</time></>}</>;
}

export function VehicleLog({ entries, today, vehicleId, subjects, sites, editable, onSave }: {
  entries: VehicleLogEntry[]; today: string; vehicleId: string; subjects: VehicleSubject[];
  sites: SiteOption[]; editable: boolean; onSave: (input: VehicleLogInput) => Promise<void>;
}) {
  const id = useId();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState<Mode | null>(null);
  const [kindFilter, setKindFilter] = useState<VehicleLogKind | ''>('');
  const [stateFilter, setStateFilter] = useState<VehicleLogInput['state'] | ''>('');
  const trigger = useRef<HTMLElement>(null);
  const usageHeading = useRef<HTMLHeadingElement>(null);
  const interventionHeading = useRef<HTMLHeadingElement>(null);
  const sorted = [...entries].sort(compareVehicleLogs);
  const uses = sorted.filter(entry => entry.kind === 'usage');
  const interventions = sorted.filter(entry => entry.kind !== 'usage');
  const filteredInterventions = interventions.filter(entry => (!kindFilter || kindFilter === entry.kind) && (!stateFilter || stateFilter === entry.state));

  function open(next: Selection, opener: HTMLElement) {
    trigger.current = opener;
    setNotice(null);
    setSelection(next);
  }

  function close(mode: Mode) {
    setSelection(null);
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus();
      else (mode === 'usage' ? usageHeading : interventionHeading).current?.focus();
    });
  }

  function list(records: VehicleLogEntry[], mode: Mode) {
    return <ul className={styles.records} role="list">{records.map(entry => {
      const Icon = mode === 'usage' ? Truck : Wrench;
      return <li className={styles.record} key={entry.id}>
        <span className={styles.recordIcon}><Icon size={19} aria-hidden="true"/></span>
        <div className={styles.detail}>
          <div className={styles.recordHeading}>
            <h3>{entry.title}</h3>
            {mode === 'intervention' && <span className={`badge ${entry.state === 'done' ? 'badge-done' : 'badge-planned'}`}><i/>{stateLabels[entry.state]}</span>}
          </div>
          {mode === 'intervention' && <p className={styles.kind}>{kindLabels[entry.kind]}</p>}
          <dl className={styles.facts}>
            <div><dt>Periodo</dt><dd>{periodLabel(entry)}</dd></div>
            {entry.operator_id && <div><dt>Operatore</dt><dd>{entry.operator_name || 'Operatore non disponibile'}</dd></div>}
            {entry.site_id && <div><dt>Cantiere</dt><dd>{entry.site_name || 'Cantiere non disponibile'}</dd></div>}
            {entry.location && <div><dt>Luogo</dt><dd>{entry.location}</dd></div>}
          </dl>
          {entry.notes && <p className={styles.notes}>{entry.notes}</p>}
        </div>
        {editable && <button type="button" className={`button secondary ${styles.edit}`} aria-label={`Modifica ${entry.title}`}
          onClick={event => open({ mode, entry }, event.currentTarget)}><Pencil size={16} aria-hidden="true"/> Modifica</button>}
      </li>;
    })}</ul>;
  }

  return <>
    <section className={`panel ${styles.panel}`} id="registro-utilizzo" aria-labelledby={id + '-usage'}>
      <header className={`panel-header ${styles.header}`}>
        <div><h2 id={id + '-usage'} ref={usageHeading} tabIndex={-1}>Registro di utilizzo</h2><p>Utilizzi effettivi del mezzo, con operatore, periodo e luogo.</p></div>
        {editable && <button type="button" className="button secondary" onClick={event => open({ mode: 'usage' }, event.currentTarget)}><Plus size={18} aria-hidden="true"/> Registra utilizzo</button>}
      </header>
      <div role="status">{notice === 'usage' && <p className={`access-notice ${styles.notice}`}>Utilizzo salvato.</p>}</div>
      {uses.length ? list(uses, 'usage') : <div className={`empty ${styles.empty}`}><Truck size={24} aria-hidden="true"/><strong>Nessun utilizzo registrato</strong></div>}
    </section>
    <section className={`panel ${styles.panel}`} id="interventi-veicolo" aria-labelledby={id + '-interventions'}>
      <header className={`panel-header ${styles.header}`}>
        <div><h2 id={id + '-interventions'} ref={interventionHeading} tabIndex={-1}>Interventi di manutenzione</h2></div>
        {editable && <button type="button" className="button secondary" onClick={event => open({ mode: 'intervention' }, event.currentTarget)}><Plus size={18} aria-hidden="true"/> Nuovo intervento</button>}
      </header>
      <div role="status">{notice === 'intervention' && <p className={`access-notice ${styles.notice}`}>Intervento salvato.</p>}</div>
      {interventions.length > 0 && <div className={`form-grid ${styles.filters}`}>
        <label htmlFor={id + '-kind'}>Tipo di intervento<select id={id + '-kind'} value={kindFilter} onChange={event => setKindFilter(event.target.value as typeof kindFilter)}>
          <option value="">Tutti i tipi</option>
          {maintenanceKinds.map(kind => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}
        </select></label>
        <label htmlFor={id + '-state'}>Stato intervento<select id={id + '-state'} value={stateFilter} onChange={event => setStateFilter(event.target.value as typeof stateFilter)}>
          <option value="">Tutti gli stati</option>
          {Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>}
      {filteredInterventions.length ? list(filteredInterventions, 'intervention') : <div className={`empty ${styles.empty}`}>
        <ClipboardList size={24} aria-hidden="true"/><strong>{interventions.length ? 'Nessun intervento per questi filtri' : 'Nessun intervento registrato'}</strong>
        {interventions.length > 0 && <button type="button" className="button text-button" onClick={() => { setKindFilter(''); setStateFilter(''); }}>Azzera filtri</button>}
      </div>}
    </section>
    {selection && editable && <VehicleLogEditor key={selection.entry?.id ?? selection.mode} selection={selection} vehicleId={vehicleId}
      sites={sites} subjects={subjects} today={today} onClose={() => close(selection.mode)} onSave={async input => {
        await onSave(input);
        if (selection.mode === 'intervention') { setKindFilter(''); setStateFilter(''); }
        setNotice(selection.mode);
        close(selection.mode);
      }}/>}
  </>;
}

function VehicleLogEditor({ selection, vehicleId, subjects, sites, today, onClose, onSave }: {
  selection: Selection; vehicleId: string; subjects: VehicleSubject[]; sites: SiteOption[]; today: string;
  onClose: () => void; onSave: (input: VehicleLogInput) => Promise<void>;
}) {
  const { mode, entry } = selection;
  const usage = mode === 'usage';
  const stableId = useRef(entry?.id ?? '');
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [state, setState] = useState<VehicleLogInput['state']>(entry?.state ?? 'done');
  const [start, setStart] = useState(entry?.start_date ?? today);
  const [end, setEnd] = useState(entry?.end_date ?? today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string } | null>(null);
  const maxDate = usage || state === 'done' ? today : '9999-12-31';
  const title = usage ? entry ? 'Modifica utilizzo' : 'Registra utilizzo' : entry ? 'Modifica intervento' : 'Nuovo intervento';
  const operators = subjects.filter(isSelectableAssignee).sort((a, b) => a.title.localeCompare(b.title, 'it'));
  const availableSites = [...sites].sort((a, b) => a.name.localeCompare(b.name, 'it'));
  const historicalOperator = entry?.operator_id && !operators.some(operator => operator.id === entry.operator_id);
  const historicalSite = entry?.site_id && !availableSites.some(site => site.id === entry.site_id);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function changeStart(date: string) {
    if (date && (end === start || end < date)) setEnd(date);
    setStart(date);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    const name = text('title');
    const startDate = text('start_date');
    const endDate = text('end_date');
    const site = text('site_id') || null;
    const operator = text('operator_id') || null;
    const location = text('location');
    if (!name) return setError({ text: 'Inserisci una descrizione.' });
    if (!startDate || !endDate || startDate > endDate || endDate > maxDate) return setError({ text: 'Verifica le date del periodo.' });
    if (usage && !operator) return setError({ text: 'Seleziona chi ha utilizzato il veicolo.' });
    if (usage && !site && !location) return setError({ text: 'Indica il cantiere o il luogo di utilizzo.' });

    inFlight.current = true;
    setBusy(true);
    setError(null);
    stableId.current ||= crypto.randomUUID();
    try {
      await onSave({
        id: stableId.current, vehicle_id: vehicleId, kind: usage ? 'usage' : (text('kind') as VehicleLogKind), title: name,
        start_date: startDate, end_date: endDate, operator_id: operator, site_id: site, location, notes: text('notes'),
        state: usage ? 'done' : state,
      });
    } catch (failure) {
      setError({ text: failure instanceof Error ? failure.message : 'Salvataggio non riuscito. Riprova.' });
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <Drawer title={title} busy={busy} onClose={onClose}>
    <form className="editor-form" onSubmit={submit}>
      <fieldset className="drawer-fields form-grid" disabled={busy}>
        <label>Descrizione<input name="title" autoFocus required maxLength={160} defaultValue={entry?.title}
          placeholder={usage ? 'Es. Consegna materiale' : 'Es. Sostituzione freni'}/></label>
        {!usage && <div className={`form-pair ${styles.formPair}`}>
          <label>Tipo di intervento<select name="kind" defaultValue={entry?.kind ?? 'maintenance'} disabled={Boolean(entry)}>
            {maintenanceKinds.map(kind => <option value={kind} key={kind}>{kindLabels[kind]}</option>)}
          </select>{entry && <input type="hidden" name="kind" value={entry.kind}/>}</label>
          <label>Stato<select value={state} onChange={event => setState(event.target.value as VehicleLogInput['state'])}>
            {Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </div>}
        <div className={`form-pair ${styles.formPair}`}>
          <label>Data di inizio<input name="start_date" type="date" min="0001-01-01" max={maxDate} required value={start} onChange={event => changeStart(event.target.value)}/></label>
          <label>Data di fine<input name="end_date" type="date" min={start || '0001-01-01'} max={maxDate} required value={end} onChange={event => setEnd(event.target.value)}/></label>
        </div>
        <label>{usage ? 'Chi ha utilizzato il veicolo' : 'Operatore (facoltativo)'}<select name="operator_id" required={usage} defaultValue={entry?.operator_id ?? ''}>
          <option value="">{usage ? 'Seleziona un operatore' : 'Nessun operatore'}</option>
          {historicalOperator && <option value={entry?.operator_id ?? ''}>{entry?.operator_name || 'Operatore non disponibile'} · Storico</option>}
          {assigneeGroups.map(group => {
            const members = operators.filter(operator => vehicleAssigneeGroup(operator) === group.value);
            return members.length ? <optgroup key={group.value} label={group.label}>
              {members.map(operator => <option value={operator.id} key={operator.id}>{operator.title}</option>)}
            </optgroup> : null;
          })}
        </select></label>
        {usage && !operators.length && !historicalOperator && <p className={styles.hint}>Aggiungi una persona o una squadra in Personale per registrare l’utilizzo.</p>}
        <label>Cantiere<select name="site_id" defaultValue={entry?.site_id ?? ''}>
          <option value="">Nessun cantiere</option>
          {historicalSite && <option value={entry?.site_id ?? ''}>{entry?.site_name || 'Cantiere non disponibile'} · Storico</option>}
          {availableSites.map(site => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}
        </select></label>
        <label>Luogo<input name="location" maxLength={200} defaultValue={entry?.location} placeholder={usage ? 'Es. Deposito o indirizzo' : 'Es. Officina'}/></label>
        {usage && <p className={styles.hint}>Indica il cantiere o il luogo dell’utilizzo.</p>}
        <label>Note<textarea name="notes" maxLength={2000} rows={3} defaultValue={entry?.notes}/></label>
        {error && <p className="form-error" role="alert" ref={errorRef} tabIndex={-1}>{error.text}</p>}
      </fieldset>
      <footer className={`drawer-footer ${styles.footer}`}>
        <button type="button" className="button secondary" disabled={busy} onClick={onClose}>Annulla</button>
        <button type="submit" className="button primary" disabled={busy || (usage && !operators.length && !historicalOperator)}>
          {busy ? 'Salvataggio…' : usage ? 'Salva utilizzo' : 'Salva intervento'}</button>
      </footer>
    </form>
  </Drawer>;
}
