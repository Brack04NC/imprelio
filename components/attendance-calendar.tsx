'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from 'react';
import { attendanceKindLabels, attendancePlaceLabels, validateAttendanceAction, type AttendanceAction, type AttendanceEntry, type AttendancePerson } from '@/lib/attendance';
import { attendanceKey, localAttendance, localAttendancePeople, writeLocalAttendance } from '@/lib/attendance-demo';
import { calendarDays, calendarLabel, shiftCalendar } from '@/lib/calendar';
import { demoKey } from '@/lib/demo';
import { demoTrashKey } from '@/lib/trash-storage';
import { formatDate, plusDays, type Identity } from '@/lib/domain';
import { demoSiteOptions, operationsKey } from '@/lib/operations-demo';
import type { SiteOption } from '@/lib/operation-types';
import { Drawer } from './editor';
import { orgLink } from './shell';
import { useRomeToday } from './use-rome-today';
import styles from './attendance-calendar.module.css';

const weekdays = [['Lun', 'Lunedì'], ['Mar', 'Martedì'], ['Mer', 'Mercoledì'], ['Gio', 'Giovedì'], ['Ven', 'Venerdì'], ['Sab', 'Sabato'], ['Dom', 'Domenica']];
const personKinds = { employee: 'Dipendenti', worker: 'Operai' } as const;
const dayOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } as const;
const arrowOffsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

type EditorSelection = { date: string; entry?: AttendanceEntry };
type AttendanceData = { month: string; entries: AttendanceEntry[]; people: AttendancePerson[]; sites: SiteOption[] };
type CalendarProps = { identity: Identity; today: string; month: string; person: string; initial: AttendanceEntry[]; people: AttendancePerson[]; sites: SiteOption[] };

function monthLink(identity: Identity, month: string, person: string) {
  const params = new URLSearchParams({ mese: month });
  if (person) params.set('persona', person);
  return orgLink('/gestione/presenze?' + params, identity);
}

function siteLabel(site: SiteOption) {
  return [site.name, site.city, site.client].filter(Boolean).join(' · ');
}

function registrationCount(count: number) {
  return count === 1 ? '1 registrazione' : `${count} registrazioni`;
}

function readDemo(today: string, month: string): AttendanceData {
  return { month, entries: localAttendance(today, month), people: localAttendancePeople(today), sites: demoSiteOptions(today, true) };
}

async function saveCloud(identity: Identity, action: AttendanceAction) {
  const response = await fetch('/api/presenze?' + new URLSearchParams({ azienda: identity.org.id }), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
  });
  const result = await response.json().catch(() => null) as { entry?: AttendanceEntry | null; error?: string } | null;
  if (!response.ok || !result || (action.action === 'save' && !result.entry)) {
    throw new Error(result?.error || 'Operazione non riuscita. Riprova.');
  }
  return result.entry ?? null;
}

function PersonOptions({ people }: { people: AttendancePerson[] }) {
  return Object.entries(personKinds).map(([kind, label]) => {
    const group = people.filter(person => person.kind === kind);
    return group.length ? <optgroup key={kind} label={label}>
      {group.map(person => <option key={person.id} value={person.id}>{person.name}{person.archived ? ' (archiviato)' : ''}</option>)}
    </optgroup> : null;
  });
}

export function AttendanceCalendar({ identity, today: initialToday, month, person, initial, people, sites }: CalendarProps) {
  const today = useRomeToday(initialToday);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fallback = useMemo(() => ({ month, entries: initial, people, sites }), [month, initial, people, sites]);
  const [snapshot, setData] = useState(fallback);
  const data = snapshot.month === month ? snapshot : fallback;
  const defaultDay = today.startsWith(month) ? today : month + '-01';
  const [selected, setSelected] = useState('');
  const [editor, setEditor] = useState<EditorSelection | null>(null);
  const [notice, setNotice] = useState('');
  const [syncError, setSyncError] = useState('');
  const detail = useRef<HTMLElement>(null);
  const openTrigger = useRef<HTMLElement | null>(null);
  const monthGrid = useRef<HTMLTableElement>(null);

  useEffect(() => {
    if (!identity.demo) setData(fallback);
  }, [identity.demo, fallback]);

  useEffect(() => {
    if (!identity.demo) return;
    function sync() {
      try {
        setData(readDemo(today, month));
        setSyncError('');
      } catch {
        setSyncError('Impossibile leggere le registrazioni della demo.');
      }
    }
    sync();
    function onStorage(event: StorageEvent) {
      if ([attendanceKey, demoKey, demoTrashKey, operationsKey, null].includes(event.key)) sync();
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [identity.demo, month, today]);

  const date = selected.startsWith(month) ? selected : defaultDay;
  const selection = { view: 'mese', date: month + '-01' } as const;
  const days = calendarDays(selection);
  // December 9999 is truncated at the domain's final permitted date.
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => days.slice(index * 7, index * 7 + 7));
  const previous = shiftCalendar(selection, -1);
  const next = shiftCalendar(selection, 1);
  const orderedPeople = useMemo(() => [...data.people].sort((a, b) => a.name.localeCompare(b.name, 'it')), [data.people]);
  const peopleById = useMemo(() => new Map(orderedPeople.map(item => [item.id, item])), [orderedPeople]);
  const siteById = useMemo(() => new Map(data.sites.map(item => [item.id, item])), [data.sites]);
  const onlyPerson = peopleById.get(person);
  const availablePeople = orderedPeople.filter(item => !item.archived && (!person || item.id === person));
  const entriesByDay = useMemo(() => {
    const result = new Map<string, AttendanceEntry[]>();
    for (const entry of data.entries) {
      if (person && entry.person_id !== person) continue;
      const day = result.get(entry.work_date);
      if (day) day.push(entry);
      else result.set(entry.work_date, [entry]);
    }
    return result;
  }, [data.entries, person]);
  const selectedEntries = [...(entriesByDay.get(date) ?? [])].sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '') ||
    (peopleById.get(a.person_id)?.name ?? '').localeCompare(peopleById.get(b.person_id)?.name ?? '', 'it') || a.id.localeCompare(b.id));

  function chooseDate(day: string, revealDetails: boolean) {
    setSelected(day);
    setNotice('');
    if (revealDetails && window.matchMedia('(max-width: 850px)').matches) detail.current?.scrollIntoView({ block: 'nearest' });
  }

  function moveDay(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const offset = arrowOffsets[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const target = plusDays(day, offset);
    if (!target.startsWith(month)) return;
    chooseDate(target, false);
    monthGrid.current?.querySelector<HTMLButtonElement>(`button[data-date='${target}']`)?.focus();
  }

  function goTo(period: string, personId: string) {
    setNotice('');
    startTransition(() => router.push(monthLink(identity, period, personId), { scroll: false }));
  }

  function openEditor(entry?: AttendanceEntry) {
    openTrigger.current = document.activeElement as HTMLElement;
    setNotice('');
    setEditor({ date, entry });
  }

  function closeEditor() {
    setEditor(null);
    requestAnimationFrame(() => {
      if (openTrigger.current?.isConnected) openTrigger.current.focus();
      else detail.current?.focus();
    });
  }

  async function save(action: AttendanceAction) {
    const entry = identity.demo ? writeLocalAttendance(today, action) : await saveCloud(identity, action);
    setData(current => ({ ...current, entries: [...current.entries.filter(item => item.id !== action.id),
      ...(entry && entry.work_date.startsWith(month) ? [entry] : [])] }));
    closeEditor();
    if (entry && !entry.work_date.startsWith(month)) goTo(entry.work_date.slice(0, 7), person);
    else if (!identity.demo) router.refresh();
    if (entry) setSelected(entry.work_date);
    setNotice(entry ? 'Registrazione salvata.' : 'Registrazione rimossa.');
  }

  return <>
    <Link href={orgLink(`/gestione/personale${onlyPerson ? `?tipo=${onlyPerson.kind}` : ''}`, identity)} className="button text-button back-link">
      <ArrowLeft size={17}/> Personale e squadre
    </Link>
    <div className="page-header"><div>
      <h1>Presenze</h1>
      <p>{onlyPerson ? <>{onlyPerson.name}{onlyPerson.archived && ' · Profilo archiviato'}</> : 'Registra presenze e assenze di dipendenti e operai.'}</p>
    </div></div>
    {syncError && <p className="form-error" role="alert">{syncError}</p>}
    <div className={styles.workspace} aria-busy={pending || undefined}>
      <section className={`panel ${styles.calendar}`} aria-labelledby="attendance-month-title">
        <header className={styles.calendarHeader}>
          <div className={styles.monthTitle}>
            <span className="agenda-heading-icon"><CalendarDays size={20}/></span>
            <h2 id="attendance-month-title">{calendarLabel(selection)}</h2>
          </div>
          <nav className={styles.monthNavigation} aria-label="Navigazione mese">
            <Link href={monthLink(identity, today.slice(0, 7), person)} className="button secondary" scroll={false} onClick={() => chooseDate(today, false)}>Oggi</Link>
            {previous && <Link href={monthLink(identity, previous.slice(0, 7), person)} className="icon-button" scroll={false} aria-label="Mese precedente"><ChevronLeft size={19}/></Link>}
            {next && <Link href={monthLink(identity, next.slice(0, 7), person)} className="icon-button" scroll={false} aria-label="Mese successivo"><ChevronRight size={19}/></Link>}
          </nav>
        </header>
        <label className={styles.personFilter}>Persona
          <select aria-label="Persona" value={person} disabled={pending} onChange={event => goTo(month, event.target.value)}>
            <option value="">Tutte le persone</option>
            {person && !onlyPerson && <option value={person}>Persona non disponibile</option>}
            <PersonOptions people={orderedPeople}/>
          </select>
        </label>
        <div className={styles.monthGrid}>
          <p id="attendance-calendar-tip" className="sr-only">Usa le frecce per spostarti fra i giorni del mese.</p>
          <table ref={monthGrid} aria-labelledby="attendance-month-title" aria-describedby="attendance-calendar-tip">
            <thead><tr>{weekdays.map(([short, full]) => <th key={short} scope="col"><abbr title={full}>{short}</abbr></th>)}</tr></thead>
            <tbody>{weeks.map(week => <tr key={week[0]}>{Array.from({ length: 7 }, (_, index) => {
              const day = week[index];
              if (!day) return <td key={index} className={styles.outsideDay}/>;
              const number = Number(day.slice(8));
              if (!day.startsWith(month)) return <td key={day} className={styles.outsideDay}><span aria-hidden="true">{number}</span></td>;
              const dayEntries = entriesByDay.get(day) ?? [];
              const work = dayEntries.filter(item => item.kind === 'work').length;
              const absent = dayEntries.length - work;
              const daySummary = [registrationCount(dayEntries.length), work && (work === 1 ? '1 presenza' : `${work} presenze`),
                absent && (absent === 1 ? '1 assenza' : `${absent} assenze`)].filter(Boolean).join(', ');
              return <td key={day}><button type="button" data-date={day} data-selected={day === date}
                aria-current={day === today ? 'date' : undefined}
                aria-pressed={day === date} tabIndex={day === date ? 0 : -1} onKeyDown={event => moveDay(event, day)}
                onClick={event => chooseDate(day, event.detail > 0)} className={styles.day}>
                <time dateTime={day}>{number}<span className="sr-only"> {calendarLabel(selection)}</span></time>
                <span className="sr-only">, {daySummary}</span>
                {(work > 0 || absent > 0) && <span className={styles.dayCounts} aria-hidden="true">
                  {work > 0 && <span className={styles.workCount}>{work}<span> {work === 1 ? 'presenza' : 'presenze'}</span></span>}
                  {absent > 0 && <span className={styles.absenceCount}>{absent}<span> {absent === 1 ? 'assenza' : 'assenze'}</span></span>}
                </span>}
              </button></td>;
            })}</tr>)}</tbody>
          </table>
        </div>
        {entriesByDay.size > 0 && <p className={styles.mobileKey} aria-hidden="true"><span>P · Presenze</span><span>A · Assenze</span></p>}
      </section>

      <section ref={detail} tabIndex={-1} className={`panel ${styles.detail}`} aria-labelledby="attendance-day-title">
        <header className={styles.detailHeader}>
          <div><h2 id="attendance-day-title">{formatDate(date, dayOptions)}</h2>
            <p>{registrationCount(selectedEntries.length)}</p></div>
          {availablePeople.length > 0 && <button type="button" className="button primary" disabled={Boolean(syncError)} onClick={() => openEditor()}><Plus size={17}/> Nuova registrazione</button>}
        </header>
        <div role="status">{notice && <p className={styles.notice}>{notice}</p>}</div>
        {selectedEntries.length ? <ul className={styles.entries}>{selectedEntries.map(entry => {
          const participant = peopleById.get(entry.person_id);
          const site = entry.site_id ? siteById.get(entry.site_id) : undefined;
          const place = entry.workplace === 'site' ? site?.name ?? 'Cantiere non disponibile' : entry.workplace ? attendancePlaceLabels[entry.workplace] : '';
          return <li className={styles.entry} key={entry.id}>
            <div className={styles.entryTop}>
              <strong>{participant?.name ?? 'Persona non disponibile'}</strong>
              <span className={`badge ${entry.kind === 'work' ? 'badge-active' : 'badge-paused'}`}>{attendanceKindLabels[entry.kind]}</span>
            </div>
            <p className={styles.entryMeta}><Clock3 size={15} aria-hidden="true"/>{entry.start_time && entry.end_time
              ? <><time>{entry.start_time.slice(0, 5)}</time>–<time>{entry.end_time.slice(0, 5)}</time></> : 'Giornata intera'}</p>
            {place && <p className={styles.entryMeta}><MapPin size={15} aria-hidden="true"/>{site
              ? <Link href={orgLink(`/cantieri/${site.id}`, identity)}>{place}</Link> : place}</p>}
            {participant && !participant.archived && <button className="button secondary" type="button" disabled={Boolean(syncError)} onClick={() => openEditor(entry)}
              aria-label={`Modifica ${attendanceKindLabels[entry.kind].toLowerCase()} di ${participant.name}${entry.start_time ? ` alle ${entry.start_time.slice(0, 5)}` : ''}`}><Pencil size={15}/> Modifica</button>}
          </li>;
        })}</ul> : <div className={`empty ${styles.empty}`}><CalendarDays size={25}/><strong>Nessuna registrazione per questo giorno</strong></div>}
        {onlyPerson?.archived && <p className={styles.readOnly}>Il profilo è archiviato. Puoi consultare le registrazioni salvate.</p>}
        {!onlyPerson?.archived && !person && !orderedPeople.length && <p className={styles.readOnly}>Aggiungi un dipendente o un operaio in Personale e squadre per iniziare.</p>}
      </section>
    </div>
    {editor && <AttendanceEditor selection={editor} people={availablePeople} sites={data.sites} filterPerson={onlyPerson} onClose={closeEditor} onSave={save}/>}
  </>;
}

type AttendanceDraft = Pick<AttendanceEntry, 'person_id' | 'work_date' | 'kind'> & {
  startTime: string; endTime: string; workplace: NonNullable<AttendanceEntry['workplace']> | ''; siteId: string; allDay: boolean;
};

function AttendanceEditor({ selection, people, sites, filterPerson, onClose, onSave }: {
  selection: EditorSelection; people: AttendancePerson[]; sites: SiteOption[]; filterPerson?: AttendancePerson;
  onClose: () => void; onSave: (action: AttendanceAction) => Promise<void>;
}) {
  const { date, entry } = selection;
  const [id] = useState(() => entry?.id ?? crypto.randomUUID());
  const [draft, setDraft] = useState<AttendanceDraft>({
    person_id: entry?.person_id ?? filterPerson?.id ?? (people.length === 1 ? people[0].id : ''), work_date: entry?.work_date ?? date,
    kind: entry?.kind ?? 'work', startTime: entry?.start_time?.slice(0, 5) ?? '', endTime: entry?.end_time?.slice(0, 5) ?? '',
    workplace: entry?.workplace ?? '', siteId: entry?.site_id ?? '', allDay: Boolean(entry && !entry.start_time),
  });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const work = draft.kind === 'work';
  const timed = work || !draft.allDay;
  const personName = people.find(person => person.id === entry?.person_id)?.name;

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (confirmRemove) back.current?.focus(); }, [confirmRemove]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const action = validateAttendanceAction(confirmRemove ? { action: 'remove', id } : {
        action: 'save', id, person_id: draft.person_id, work_date: draft.work_date, kind: draft.kind,
        start_time: timed ? draft.startTime : null, end_time: timed ? draft.endTime : null,
        workplace: work ? draft.workplace : null, site_id: work && draft.workplace === 'site' ? draft.siteId : null,
      });
      await onSave(action);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Operazione non riuscita. Riprova.');
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <Drawer title={confirmRemove ? 'Rimuovi registrazione' : entry ? 'Modifica registrazione' : 'Nuova registrazione'} onClose={onClose} busy={busy}>
    <form className="editor-form" onSubmit={submit}>
      <fieldset className="drawer-fields form-grid" disabled={busy}>
        {confirmRemove && entry ? <p className={styles.hint}>Vuoi rimuovere la registrazione di {personName ?? 'questa persona'} del {formatDate(entry.work_date, dayOptions)}?</p> : <>
          {filterPerson ? <p className="editor-context">{filterPerson.name}</p> : <label>Persona<select autoFocus aria-label="Persona" required value={draft.person_id}
            onChange={event => setDraft({ ...draft, person_id: event.target.value })}>
            <option value="">Seleziona una persona</option><PersonOptions people={people}/>
          </select></label>}
          <label>Data<input autoFocus={Boolean(filterPerson)} type="date" required value={draft.work_date} min="0001-01-01" max="9999-12-31"
            onChange={event => setDraft({ ...draft, work_date: event.target.value })}/></label>
          <label>Tipo<select aria-label="Tipo" value={draft.kind} onChange={event => {
            const kind = event.target.value as AttendanceEntry['kind'];
            setDraft({ ...draft, kind, allDay: kind !== 'work' && (work || draft.allDay) });
          }}>{Object.entries(attendanceKindLabels).map(([kind, label]) => <option value={kind} key={kind}>{label}</option>)}</select></label>
          {!work && <label className={styles.allDay}><input type="checkbox" checked={draft.allDay}
            onChange={event => setDraft({ ...draft, allDay: event.target.checked })}/>Giornata intera</label>}
          {timed && <div className={`form-pair ${styles.times}`}>
            <label>Ora di inizio<input type="time" required value={draft.startTime} onChange={event => setDraft({ ...draft, startTime: event.target.value })}/></label>
            <label>Ora di fine<input type="time" required value={draft.endTime} onChange={event => setDraft({ ...draft, endTime: event.target.value })}/></label>
          </div>}
          {work && <label>Luogo di lavoro<select aria-label="Luogo di lavoro" required value={draft.workplace} onChange={event =>
            setDraft({ ...draft, workplace: event.target.value as AttendanceDraft['workplace'] })}>
            <option value="">Seleziona un luogo</option>
            {Object.entries(attendancePlaceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select></label>}
          {work && draft.workplace === 'site' && <label>Cantiere<select aria-label="Cantiere" required value={draft.siteId} onChange={event => setDraft({ ...draft, siteId: event.target.value })}>
            <option value="">{sites.length ? 'Seleziona un cantiere' : 'Nessun cantiere disponibile'}</option>
            {sites.map(site => <option value={site.id} key={site.id}>{siteLabel(site)}</option>)}
          </select></label>}
        </>}
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="form-error">{error}</p>}
      </fieldset>
      <footer className={`drawer-footer ${styles.drawerFooter}`}>
        {entry && !confirmRemove && <button type="button" className="button secondary drawer-delete" disabled={busy} onClick={() => {
          setError(''); setConfirmRemove(true);
        }}><Trash2 size={16}/> Rimuovi</button>}
        <button ref={back} type="button" className="button secondary" disabled={busy} onClick={confirmRemove ? () => {
          setError(''); setConfirmRemove(false);
        } : onClose}>{confirmRemove ? 'Indietro' : 'Annulla'}</button>
        <button type="submit" className={`button ${confirmRemove ? styles.danger : 'primary'}`} disabled={busy}>
          {busy ? 'Attendi…' : confirmRemove ? 'Conferma rimozione' : 'Salva registrazione'}</button>
      </footer>
    </form>
  </Drawer>;
}
