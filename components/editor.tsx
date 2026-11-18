'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { actionSchema, jobKinds, jobLabels, jobStates, kindLabels, siteLabels, siteStates, type Action, type Client, type Job, type Site } from '@/lib/domain';

export function Drawer({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="drawer" ref={dialog} aria-labelledby="editor-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="drawer-inner">
      <header className="drawer-header"><h2 id="editor-title">{title}</h2><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Chiudi"><X size={22}/></button></header>
      {children}
    </div>
  </dialog>;
}

type EditorProps = {
  editor: { type: 'site'; site?: Site } | { type: 'job'; site: Pick<Site, 'id' | 'name'>; job?: Job };
  clients: Client[]; today: string; onClose: () => void; save: (action: Action) => Promise<void>;
};
export function Editor({ editor, clients, today, onClose, save }: EditorProps) {
  const job = editor.type === 'job' ? editor.job : undefined;
  const site = editor.type === 'site' ? editor.site : undefined;
  const [newClient, setNewClient] = useState(false);
  const stableId = useRef<string>(job?.id ?? site?.id ?? '');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const title = editor.type === 'site' ? (site ? 'Modifica cantiere' : 'Nuovo cantiere') : (job ? 'Modifica intervento' : 'Aggiungi intervento');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = Object.fromEntries(new FormData(event.currentTarget));
    stableId.current ||= crypto.randomUUID();
    const raw = editor.type === 'site'
      ? { ...form, action: 'site', id: stableId.current, client_id: newClient ? null : form.client_id || null, new_client: form.new_client || '' }
      : { ...form, action: 'job', id: stableId.current, site_id: editor.site.id, time: form.time || null };
    const result = actionSchema.safeParse(raw);
    if (!result.success) { setError('Controlla i dati inseriti e riprova.'); return; }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try { await save(result.data); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Salvataggio non riuscito. Riprova.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <Drawer title={title} onClose={onClose} busy={busy}>
    <form className="editor-form" onSubmit={submit}>
      <fieldset disabled={busy} className="form-grid drawer-fields">
        {editor.type === 'site' ? <>
          <label>Nome cantiere <input autoFocus name="name" required maxLength={120} defaultValue={site?.name} placeholder="Es. Palazzo Manzoni"/></label>
          <label>Comune <input name="city" required maxLength={100} defaultValue={site?.city} placeholder="Es. Milano"/></label>
          <label>Indirizzo <input name="address" maxLength={200} defaultValue={site?.address} placeholder="Via e numero civico"/></label>
          <label>Stato <select name="status" defaultValue={site?.status ?? 'planned'}>{siteStates.map(value => <option key={value} value={value}>{siteLabels[value]}</option>)}</select></label>
          <label>Responsabile <input name="manager" maxLength={100} defaultValue={site?.manager} placeholder="Nome e cognome"/></label>
          <div className="client-input">
            {newClient ? <label>Nome del nuovo cliente <input name="new_client" required maxLength={140} placeholder="Nome o ragione sociale" /></label>
              : <label>Cliente <select name="client_id" defaultValue={site?.client_id ?? ''}><option value="">Seleziona cliente</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>}
            <button type="button" className="button text-button" onClick={() => setNewClient(value => !value)}>{!newClient && <Plus size={16}/>} {newClient ? 'Scegli un cliente esistente' : 'Crea cliente'}</button>
          </div>
        </> : <>
          <p className="editor-context">{editor.site.name}</p>
          <label>Tipo di intervento <select autoFocus name="kind" defaultValue={job?.kind ?? 'assembly'}>{jobKinds.map(value => <option key={value} value={value}>{kindLabels[value]}</option>)}</select></label>
          <label>Zona <input name="zone" maxLength={120} defaultValue={job?.zone} placeholder="Es. Facciata nord"/></label>
          <div className="form-pair">
            <label>Data prevista <input name="due_date" type="date" required defaultValue={job?.due_date ?? today}/></label>
            <label>Ora <input name="time" type="time" defaultValue={job?.time?.slice(0, 5) ?? ''}/></label>
          </div>
          <label>Stato <select name="status" defaultValue={job?.status ?? 'scheduled'}>{jobStates.map(value => <option key={value} value={value}>{jobLabels[value]}</option>)}</select></label>
          <label>Note <textarea name="notes" rows={4} maxLength={2000} defaultValue={job?.notes} placeholder="Indicazioni per l’intervento"/></label>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </fieldset>
      <footer className="drawer-footer">
        <button type="button" className="button secondary" disabled={busy} onClick={onClose}>Annulla</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? 'Salvataggio…' : 'Salva ' + (editor.type === 'site' ? 'cantiere' : 'intervento')}</button>
      </footer>
    </form>
  </Drawer>;
}
