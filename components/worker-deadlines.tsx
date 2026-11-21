'use client';

import { StatusToast } from './feedback-toast';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ArrowLeft, BadgeCheck, CalendarDays, Pencil, Plus, RotateCcw, Stethoscope, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatDate, type Identity } from '@/lib/domain';
import { operationsKey } from '@/lib/operations-demo';
import { demoTrashKey } from '@/lib/trash-storage';
import {
  validateWorkerDeadlineAction, workerDeadlineCategoryLabels, workerDeadlineNoticeDays, workerDeadlineState, workerDeadlineStateLabels,
  type DeadlineWorker, type WorkerDeadline, type WorkerDeadlineAction,
} from '@/lib/worker-deadlines';
import { localDeadlineWorker, localWorkerDeadlines, workerDeadlinesKey, writeLocalWorkerDeadline } from '@/lib/worker-deadlines-demo';
import { ContextActions, type ContextAction } from './context-actions';
import { Drawer } from './editor';
import { orgLink } from './shell';
import { useTrashRemoval } from './trash-removal';
import { useRomeToday } from './use-rome-today';
import styles from './worker-deadlines.module.css';

const categoryIcons = { medical: Stethoscope, certificate: BadgeCheck, other: CalendarDays };
const stateLabels = { ...workerDeadlineStateLabels, archived: 'Archiviata' };
const stateStyles = { expired: styles.expired, due: 'badge-late', future: 'badge-planned', undated: '', archived: '' };
const dateOptions = { day: 'numeric', month: 'short', year: 'numeric' } as const;

type EditorSelection = { mode: 'save'; entry?: WorkerDeadline } | { mode: 'archive' | 'restore'; entry: WorkerDeadline };
type Snapshot = { workerId: string; worker: DeadlineWorker | null | undefined; entries: WorkerDeadline[] };

function sortByDeadline(a: WorkerDeadline, b: WorkerDeadline) {
  return Number(!a.due_on) - Number(!b.due_on) || (a.due_on ?? '').localeCompare(b.due_on ?? '') || a.title.localeCompare(b.title, 'it');
}

async function saveCloud(identity: Identity, action: WorkerDeadlineAction) {
  const response = await fetch('/api/scadenze-operai?' + new URLSearchParams({ azienda: identity.org.id }), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
  });
  const result = await response.json().catch(() => null) as { entry?: WorkerDeadline; error?: string } | null;
  if (!response.ok || !result?.entry) throw new Error(result?.error || 'Operazione non riuscita. Riprova.');
  return result.entry;
}

export function WorkerDeadlines({ identity, today: initialToday, worker, initial }: {
  identity: Identity; today: string; worker: DeadlineWorker; initial: WorkerDeadline[];
}) {
  const today = useRomeToday(initialToday);
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot>({ workerId: worker.id, worker: worker.name ? worker : undefined, entries: initial });
  const [editor, setEditor] = useState<EditorSelection | null>(null);
  const [notice, setNotice] = useState('');
  const [storageError, setStorageError] = useState(false);
  const openTrigger = useRef<HTMLElement | null>(null);
  const activeHeading = useRef<HTMLHeadingElement>(null);
  const trash = useTrashRemoval(identity, { kind: 'worker_deadline', onChange(action, id) {
    setNotice('');
    if (identity.demo) {
      setSnapshot(current => ({ ...current, entries: localWorkerDeadlines(today, worker.id) }));
    } else {
      if (action === 'delete') setSnapshot(current => ({ ...current, entries: current.entries.filter(entry => entry.id !== id) }));
      router.refresh();
    }
  } });

  useEffect(() => {
    if (!identity.demo) setSnapshot({ workerId: worker.id, worker, entries: initial });
  }, [identity.demo, initial, worker]);

  useEffect(() => {
    if (!identity.demo) return;
    function sync() {
      try {
        const localWorker = localDeadlineWorker(today, worker.id);
        setSnapshot({ workerId: worker.id, worker: localWorker, entries: localWorker ? localWorkerDeadlines(today, worker.id) : [] });
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    }
    sync();
    function onStorage(event: StorageEvent) {
      if ([workerDeadlinesKey, operationsKey, demoTrashKey, null].includes(event.key)) sync();
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [identity.demo, today, worker.id]);

  useEffect(() => {
    if (identity.demo || editor) return;
    function refreshDeadlines() {
      if (document.visibilityState === 'visible') router.refresh();
    }
    window.addEventListener('focus', refreshDeadlines);
    return () => window.removeEventListener('focus', refreshDeadlines);
  }, [editor, identity.demo, router]);

  const currentWorker = snapshot.workerId === worker.id ? snapshot.worker : worker.name ? worker : undefined;
  const entries = snapshot.workerId === worker.id ? snapshot.entries : initial;
  const canEdit = Boolean(currentWorker && !currentWorker.archived && !storageError);
  const canDelete = Boolean(currentWorker && !storageError);
  const active = entries.filter(entry => !entry.archived).sort(sortByDeadline);
  const archived = entries.filter(entry => entry.archived).sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  function open(selection: EditorSelection) {
    openTrigger.current = document.activeElement as HTMLElement;
    setNotice('');
    setEditor(selection);
  }

  function close() {
    setEditor(null);
    requestAnimationFrame(() => {
      if (openTrigger.current?.isConnected) openTrigger.current.focus();
      else activeHeading.current?.focus();
    });
  }

  async function persist(action: WorkerDeadlineAction) {
    const saved = identity.demo ? writeLocalWorkerDeadline(today, action) : await saveCloud(identity, action);
    setSnapshot(current => ({ ...current, entries: [saved, ...current.entries.filter(entry => entry.id !== saved.id)] }));
    close();
    setNotice(({ save: 'Scadenza salvata.', archive: 'Scadenza archiviata.', restore: 'Scadenza ripristinata.' })[action.action]);
    if (!identity.demo) router.refresh();
  }

  function list(records: WorkerDeadline[]) {
    return <ul className={styles.records} role="list">{records.map(entry => {
      const Icon = categoryIcons[entry.category];
      const state = entry.archived ? 'archived' : workerDeadlineState(entry, today);
      const completedDate = entry.completed_on ? formatDate(entry.completed_on, dateOptions) : '';
      const dueDate = entry.due_on ? formatDate(entry.due_on, dateOptions) : '';
      const entryLabel = [entry.title, completedDate && `data registrata ${completedDate}`, dueDate && `scadenza ${dueDate}`].filter(Boolean).join(', ');
      const actions: ContextAction[] = [];
      if (canEdit) {
        if (entry.archived) actions.push({ label: 'Ripristina', icon: RotateCcw, onSelect: () => open({ mode: 'restore', entry }) });
        else actions.push(
          { label: 'Modifica', icon: Pencil, onSelect: () => open({ mode: 'save', entry }) },
          { label: 'Archivia', icon: Archive, onSelect: () => open({ mode: 'archive', entry }) },
        );
      }
      if (canDelete) actions.push({ label: 'Elimina', icon: Trash2, tone: 'danger', onSelect: () => trash.request(entry.id, entryLabel) });
      return <ContextActions key={entry.id} label={entryLabel} actions={actions}>
        {({ surface, trigger }) => <li {...surface} className={styles.record}>
          <span className={styles.recordIcon}><Icon size={20} aria-hidden="true"/></span>
          <div className={styles.recordDetails}>
            <div className={styles.recordHeading}>
              <h3>{entry.title}</h3>
              <span className={`badge ${stateStyles[state]}`}><i/>{stateLabels[state]}</span>
            </div>
            {entry.category !== 'medical' && <p className={styles.category}>{workerDeadlineCategoryLabels[entry.category]}</p>}
            <dl className={styles.dates}>
              {entry.completed_on && <div>
                <dt>{entry.category === 'medical' ? 'Visita effettuata' : 'Completata'}</dt>
                <dd><time dateTime={entry.completed_on}>{completedDate}</time></dd>
              </div>}
              {entry.due_on && <div>
                <dt>{entry.category === 'medical' ? 'Visita prevista / scadenza' : 'Scadenza'}</dt>
                <dd><time dateTime={entry.due_on}>{dueDate}</time></dd>
              </div>}
            </dl>
          </div>
          {actions.length > 0 && <div className={styles.recordActions}>
            {actions.map(action => {
              const ActionIcon = action.icon;
              const secondary = action.label === 'Modifica' || action.label === 'Ripristina';
              return <button type="button" key={action.label} data-context-primary={secondary ? '' : undefined}
                className={`button ${secondary ? 'secondary' : 'text-button'}${action.tone === 'danger' ? ` ${styles.deleteAction}` : ''}`}
                aria-label={`${action.label} ${entryLabel}`} onClick={action.onSelect}>
                {ActionIcon && <ActionIcon size={16} aria-hidden="true"/>} {action.label}
              </button>;
            })}
            {trigger}
          </div>}
        </li>}
      </ContextActions>;
    })}</ul>;
  }

  return <>
    <Link href={orgLink('/gestione/personale?tipo=worker', identity)} className="button text-button back-link"><ArrowLeft size={17}/> Operai</Link>
    <div className={`page-header ${styles.header}`}><div>
      <h1>Visite, certificazioni e scadenze</h1>
      {currentWorker && <p>{currentWorker.name}{currentWorker.archived && ' · Profilo archiviato'}</p>}
    </div>
      {canEdit && <button type="button" className="button primary" onClick={() => open({ mode: 'save' })}><Plus size={18}/> Nuova scadenza</button>}
    </div>
    {storageError && <p className="form-error" role="alert">Impossibile leggere le scadenze della demo.</p>}
    <StatusToast text={notice} onClose={() => setNotice('')}/>
    {currentWorker ? <>
      {currentWorker.archived && <p className={styles.readOnly}>Il profilo è archiviato. Puoi consultare le scadenze e lo storico.</p>}
      <section className={`panel ${styles.panel}`} aria-labelledby="active-deadlines-title">
        <header className="panel-header"><div>
          <h2 ref={activeHeading} id="active-deadlines-title" tabIndex={-1}>Scadenze attive</h2>
          {active.length > 0 && <p>«In scadenza» include oggi e i prossimi {workerDeadlineNoticeDays} giorni.</p>}
        </div></header>
        {active.length ? list(active) : <div className={`empty ${styles.empty}`}><CalendarDays size={25}/><strong>Nessuna scadenza attiva</strong></div>}
      </section>
      <section className={`panel ${styles.panel}`} aria-labelledby="archived-deadlines-title">
        <header className="panel-header"><h2 id="archived-deadlines-title">Storico</h2></header>
        {archived.length ? list(archived) : <div className={styles.archivedEmpty}>Nessuna scadenza archiviata.</div>}
      </section>
    </> : !storageError && <section className="panel empty"><strong>{currentWorker === null ? 'Operaio non disponibile' : 'Caricamento della scheda…'}</strong></section>}
    {editor && currentWorker && canEdit && <DeadlineEditor selection={editor} worker={currentWorker} onClose={close} onSave={persist}/>}
    {trash.feedback}
  </>;
}

function DeadlineEditor({ selection, worker, onClose, onSave }: {
  selection: EditorSelection; worker: DeadlineWorker; onClose: () => void; onSave: (action: WorkerDeadlineAction) => Promise<void>;
}) {
  const { mode, entry } = selection;
  const [id] = useState(() => entry?.id ?? crypto.randomUUID());
  const [category, setCategory] = useState<WorkerDeadline['category']>(entry?.category ?? 'medical');
  const [name, setName] = useState(entry && entry.category !== 'medical' ? entry.title : '');
  const [completed, setCompleted] = useState(entry?.completed_on ?? '');
  const [due, setDue] = useState(entry?.due_on ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string } | null>(null);
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const medical = category === 'medical';
  const buttonText = { save: 'Salva scadenza', archive: 'Conferma archiviazione', restore: 'Ripristina scadenza' };
  const title = mode === 'archive' ? 'Archivia scadenza' : mode === 'restore' ? 'Ripristina scadenza' : entry ? 'Modifica scadenza' : 'Nuova scadenza';

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const target = { action: mode, id, worker_id: worker.id };
      const action = validateWorkerDeadlineAction(mode === 'save' ? {
        ...target, category, title: medical ? workerDeadlineCategoryLabels.medical : name, completed_on: completed || null, due_on: due || null,
      } : target);
      await onSave(action);
    } catch (failure) {
      setError({ text: failure instanceof Error ? failure.message : 'Operazione non riuscita. Riprova.' });
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <Drawer title={title} busy={busy} onClose={onClose}>
    <form className="editor-form" onSubmit={submit}>
      <fieldset disabled={busy} className="drawer-fields form-grid">
        {mode === 'save' ? <>
          <p className={`editor-context ${styles.workerName}`}>{worker.name}</p>
          <label>Tipo<select autoFocus aria-label="Tipo" value={category} onChange={event => setCategory(event.target.value as WorkerDeadline['category'])}>
            {Object.entries(workerDeadlineCategoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select></label>
          {!medical && <label>Titolo<input required maxLength={160} value={name} onChange={event => setName(event.target.value)}/></label>}
          <div className={`form-pair ${styles.formDates}`}>
            <label>{medical ? 'Data della visita effettuata' : 'Data di completamento'}
              <input type="date" min="0001-01-01" max="9999-12-31" value={completed} onChange={event => setCompleted(event.target.value)}/>
            </label>
            <label>{medical ? 'Data prevista o scadenza' : 'Data di scadenza'}
              <input type="date" min={completed || '0001-01-01'} max="9999-12-31" value={due} onChange={event => setDue(event.target.value)}/>
            </label>
          </div>
          <p className={styles.hint}>Compila almeno una data.</p>
        </> : <div className={styles.confirmation}>
          <p><strong>{entry?.title}</strong></p>
          <p className={styles.hint}>{mode === 'archive' ? 'Troverai questa voce nello storico e potrai ripristinarla.' : 'La voce tornerà nell’elenco delle scadenze attive.'}</p>
        </div>}
        {error && <p className="form-error" ref={errorRef} tabIndex={-1} role="alert">{error.text}</p>}
      </fieldset>
      <footer className={`drawer-footer ${styles.drawerFooter}`}>
        <button type="button" className="button secondary" autoFocus={mode !== 'save'} disabled={busy} onClick={onClose}>Annulla</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? 'Attendi…' : buttonText[mode]}</button>
      </footer>
    </form>
  </Drawer>;
}
