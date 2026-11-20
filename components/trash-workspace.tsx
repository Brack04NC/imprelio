'use client';

import { ChevronLeft, ChevronRight, Trash2, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Identity } from '@/lib/domain';
import { persistTrash } from '@/lib/trash-client';
import { readDemoTrash } from '@/lib/trash-demo';
import { trashKinds, trashLabels, type TrashEntry, type TrashKind } from '@/lib/trash';
import styles from './trash-workspace.module.css';

const size = 12;
const date = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' });

function keyFor(entry: TrashEntry) { return `${entry.kind}:${entry.id}`; }

export function TrashWorkspace({ identity, initial, today }: { identity: Identity; initial: TrashEntry[]; today: string }) {
  const router = useRouter();
  const [entries, setEntries] = useState(initial);
  const [ready, setReady] = useState(!identity.demo);
  const [storageError, setStorageError] = useState(false);
  const [kind, setKind] = useState<TrashKind | ''>('');
  const [page, setPage] = useState(1);
  const [restoring, setRestoring] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const filtered = kind ? entries.filter(entry => entry.kind === kind) : entries;
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * size, current * size);

  useEffect(() => {
    if (!identity.demo) { setEntries(initial); return; }
    function sync() {
      try { setEntries(readDemoTrash(today)); setStorageError(false); }
      catch { setStorageError(true); }
      setReady(true);
    }
    function storage(event: StorageEvent) {
      if (!event.key || event.key.startsWith('imprelio-cestino-')) sync();
    }
    sync();
    window.addEventListener('storage', storage);
    window.addEventListener('pageshow', sync);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('pageshow', sync);
    };
  }, [identity.demo, initial, today]);

  async function restore(entry: TrashEntry) {
    if (inFlight.current) return;
    inFlight.current = true;
    setRestoring(keyFor(entry));
    setNotice('');
    setError('');
    try {
      await persistTrash(identity, { kind: entry.kind, id: entry.id, action: 'restore' });
      setEntries(items => items.filter(item => keyFor(item) !== keyFor(entry)));
      setNotice(`${trashLabels[entry.kind].restored} · ${entry.label}`);
      if (!identity.demo) router.refresh();
      heading.current?.focus();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Ripristino non riuscito. Riprova.');
    } finally { inFlight.current = false; setRestoring(''); }
  }

  return <section className="panel" aria-labelledby="trash-items">
    <header className={`panel-header ${styles.header}`}>
      <div><h2 id="trash-items" ref={heading} tabIndex={-1}>Elementi eliminati</h2>
        {ready && !storageError && <p>{filtered.length} {filtered.length === 1 ? 'elemento' : 'elementi'}</p>}
      </div>
      <div className={styles.filter}>
        <label htmlFor="trash-kind">Tipo di elemento</label>
        <select id="trash-kind" value={kind} onChange={event => { setKind(event.target.value as TrashKind | ''); setPage(1); }}>
          <option value="">Tutti i tipi</option>
          {trashKinds.map(option => <option value={option} key={option}>{trashLabels[option].name}</option>)}
        </select>
      </div>
    </header>
    <div role="status">{notice && <p className={styles.notice}>{notice}</p>}</div>
    {error && <p role="alert" className={`form-error ${styles.error}`}>{error}</p>}
    {!ready || storageError ? <p className={styles.empty} role={storageError ? 'alert' : 'status'}>
      {storageError ? 'Impossibile leggere il cestino in questo browser.' : 'Caricamento…'}
    </p> : visible.length ? <ul className={styles.items} role="list">
      {visible.map(entry => {
        const timestamp = new Date(entry.deleted_at);
        const hasDate = Number.isFinite(timestamp.getTime());
        return <li key={keyFor(entry)}>
          <span className={styles.icon}><Trash2 size={18} aria-hidden="true"/></span>
          <div className={styles.description}><h3>{entry.label}</h3><p>{trashLabels[entry.kind].name}
            {hasDate && <> · <time dateTime={entry.deleted_at}>{date.format(timestamp)}</time></>}
          </p></div>
          <button type="button" className={`button secondary ${styles.restore}`} disabled={Boolean(restoring)}
            aria-label={`Ripristina ${entry.label}`} onClick={() => void restore(entry)}>
            <Undo2 size={17} aria-hidden="true"/> {restoring === keyFor(entry) ? 'Ripristino…' : 'Ripristina'}</button>
        </li>;
      })}
    </ul> : <p className={styles.empty}>{kind ? 'Nessun elemento eliminato per questo tipo.' : 'Il cestino è vuoto.'}</p>}
    {pages > 1 && <nav className={styles.pages} aria-label="Pagine del cestino">
      <span>Pagina {current} di {pages}</span>
      <div>
        <button type="button" className="icon-button" aria-label="Pagina precedente" disabled={current === 1} onClick={() => {
          setPage(current - 1); heading.current?.focus();
        }}><ChevronLeft size={19} aria-hidden="true"/></button>
        <button type="button" className="icon-button" aria-label="Pagina successiva" disabled={current === pages} onClick={() => {
          setPage(current + 1); heading.current?.focus();
        }}><ChevronRight size={19} aria-hidden="true"/></button>
      </div>
    </nav>}
  </section>;
}
