'use client';

import { Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Identity } from '@/lib/domain';
import { writeDemoTrash } from '@/lib/trash-demo';
import type { TrashAction } from '@/lib/trash';
import styles from './trash-removal.module.css';

type RecordLabel = { id: string; label: string };
type Removed = RecordLabel & { keyboard: boolean };

const labels = {
  intervention: { name: 'intervento', deleted: 'Intervento eliminato', restored: 'Intervento ripristinato' },
  quote: { name: 'preventivo', deleted: 'Preventivo eliminato', restored: 'Preventivo ripristinato' },
};

export function useTrashRemoval(identity: Identity, { kind, onChange }: {
  kind: TrashAction['kind'];
  onChange: (action: TrashAction['action'], id: string) => void;
}) {
  const [target, setTarget] = useState<(RecordLabel & { detail?: string }) | null>(null);
  const [removed, setRemoved] = useState<Removed[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  const label = labels[kind];

  function request(id: string, name: string, returnFocus?: HTMLElement | null, detail?: string) {
    opener.current = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setTarget({ id, label: name, detail });
  }

  function close() {
    const returnFocus = opener.current;
    setTarget(null);
    requestAnimationFrame(() => { if (returnFocus?.isConnected) returnFocus.focus(); });
  }

  async function persist(action: TrashAction['action'], id: string) {
    if (identity.demo) {
      writeDemoTrash({ action, kind, id });
      return;
    }
    const response = await fetch('/api/cestino?' + new URLSearchParams({ azienda: identity.org.id }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, kind, id }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error ?? 'Operazione non riuscita. Riprova.');
  }

  const dismiss = useCallback((id: string) => {
    setRemoved(current => current.filter(item => item.id !== id));
  }, []);

  const feedback = <>
    <p className="sr-only" role="status">{announcement}</p>
    {target && <ConfirmRemoval item={target} name={label.name} onCancel={close} onConfirm={async keyboard => {
      await persist('delete', target.id);
      if (keyboard) setTarget(null);
      else close();
      setRemoved(current => [...current.filter(item => item.id !== target.id), { ...target, keyboard }]);
      setAnnouncement(label.deleted + ' · ' + target.label + '. Ripristina disponibile.');
      onChange('delete', target.id);
    }}/>}
    {removed.length > 0 && <section className={styles.notifications} aria-label="Eliminazioni recenti">
      {removed.map(item => <RemovalToast key={item.id} item={item} label={label.deleted} onDismiss={dismiss} onRestore={async () => {
        await persist('restore', item.id);
        dismiss(item.id);
        setAnnouncement(label.restored + ' · ' + item.label);
        onChange('restore', item.id);
      }}/>)}
    </section>}
  </>;

  return { request, feedback };
}

function ConfirmRemoval({ item, name, onCancel, onConfirm }: {
  item: RecordLabel & { detail?: string }; name: string; onCancel: () => void; onConfirm: (keyboard: boolean) => Promise<void>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const modal = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const keyboard = useRef(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    modal.current?.showModal();
    cancel.current?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError('');
    try { await onConfirm(keyboard.current); }
    catch (error) { setError(error instanceof Error ? error.message : 'Eliminazione non riuscita. Riprova.'); }
    finally { submitting.current = false; setPending(false); }
  }

  return <dialog ref={modal} className={styles.confirm} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!submitting.current) onCancel(); }}>
    <form onSubmit={submit}>
      <h2 id={titleId}>Conferma eliminazione</h2>
      <div id={descriptionId} className={styles.description}>
        <p>Vuoi eliminare {name === 'intervento' ? 'l’intervento' : 'il preventivo'} <strong>{item.label}</strong>?</p>
        {item.detail && <p>{item.detail}</p>}
      </div>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className={styles.actions}>
        <button ref={cancel} type="button" className="button secondary" disabled={pending} onClick={onCancel}>Annulla</button>
        <button type="submit" className="button" disabled={pending}
          onClick={event => { keyboard.current = event.detail === 0; }}>
          <Trash2 size={17} aria-hidden="true"/>{pending ? 'Eliminazione…' : 'Elimina'}
        </button>
      </div>
    </form>
  </dialog>;
}

function RemovalToast({ item, label, onDismiss, onRestore }: {
  item: Removed; label: string; onDismiss: (id: string) => void; onRestore: () => Promise<void>;
}) {
  const undo = useRef<HTMLButtonElement>(null);
  const restoring = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const paused = hovered || focused || pending || Boolean(error);

  useEffect(() => {
    if (item.keyboard) undo.current?.focus();
  }, [item.keyboard]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onDismiss(item.id), 3000);
    return () => window.clearTimeout(timer);
  }, [paused, item.id, onDismiss]);

  async function restore() {
    if (restoring.current) return;
    restoring.current = true;
    setPending(true);
    setError('');
    try { await onRestore(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Ripristino non riuscito. Riprova.'); }
    finally { restoring.current = false; setPending(false); }
  }

  return <div className={styles.toast} onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true); }}
    onPointerLeave={() => setHovered(false)} onFocus={() => setFocused(true)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div><strong>{label}</strong><small>{item.label}</small></div>
    <button ref={undo} type="button" className="button secondary" disabled={pending} onClick={() => void restore()}>
      <Undo2 size={16} aria-hidden="true"/>{pending ? 'Ripristino…' : 'Ripristina'}
    </button>
    {error && <p role="alert" className="form-error">{error}</p>}
  </div>;
}
