'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { actionSchema, jobKinds, jobLabels, jobStates, kindLabels, siteLabels, siteStates, type Action, type Client, type Job, type Site } from '@/lib/domain';

export function Drawer({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="drawer" ref={dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="drawer-inner">
      <header className="drawer-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Chiudi"><X size={22}/></button></header>
      {children}
    </div>
  </dialog>;
}

export type SitePrefill = Pick<Site, 'name' | 'city' | 'address'> & { clientName: string };

type EditorProps = {
  editor: { type: 'site'; site?: Site; clientId?: string; prefill?: SitePrefill }
    | { type: 'job'; site: Pick<Site, 'id' | 'name'>; job?: Job }
    | { type: 'job'; sites: Pick<Site, 'id' | 'name' | 'city'>[] };
  clients: Client[]; today: string; defaultTime?: string; onClose: () => void; onDelete?: () => void;
  save: (action: Action) => Promise<void>;
};
export function Editor({ editor, clients, today, defaultTime, onClose, onDelete, save }: EditorProps) {
  const job = editor.type === 'job' && 'site' in editor ? editor.job : undefined;
  const site = editor.type === 'site' ? editor.site : undefined;
  const prefill = editor.type === 'site' ? editor.prefill : undefined;
  const preferredClientId = editor.type === 'site' ? editor.clientId || undefined : undefined;
  const clientName = prefill?.clientName.trim().slice(0, 140) ?? '';
  const clientMatch = clientName ? clients.find(client => client.name.toLocaleLowerCase('it') === clientName.toLocaleLowerCase('it')) : undefined;
  const [newClient, setNewClient] = useState(!clients.length || Boolean(prefill && !preferredClientId && !clientMatch && clientName));
  const [newClientName, setNewClientName] = useState(clientName);
  const [selectedClient, setSelectedClient] = useState(site?.client_id ?? preferredClientId ?? clientMatch?.id ?? '');
  const stableId = useRef<string>(job?.id ?? site?.id ?? '');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const title = editor.type === 'site' ? (site ? 'Modifica cantiere' : prefill ? 'Crea cantiere dal computo' : 'Nuovo cantiere') : (job ? 'Modifica intervento' : 'Aggiungi intervento');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = Object.fromEntries(new FormData(event.currentTarget));
    stableId.current ||= crypto.randomUUID();
    const raw = editor.type === 'site'
      ? { ...form, action: 'site', id: stableId.current, client_id: newClient ? null : form.client_id || null, new_client: form.new_client || '' }
      : { ...form, action: 'job', id: stableId.current, site_id: 'site' in editor ? editor.site.id : form.site_id, time: form.time || null };
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
          {prefill && <p className="editor-context">Verifica i dati del computo e completa i campi mancanti. Il cantiere verrà selezionato nella scheda.</p>}
          <label>Nome cantiere <input autoFocus name="name" required maxLength={120} defaultValue={site?.name ?? prefill?.name.slice(0, 120)} placeholder="Es. Palazzo Manzoni"/></label>
          <label>Comune <input name="city" required maxLength={100} defaultValue={site?.city ?? prefill?.city.slice(0, 100)} placeholder="Es. Milano"/></label>
          <label>Indirizzo <input name="address" maxLength={200} defaultValue={site?.address ?? prefill?.address.slice(0, 200)} placeholder="Via e numero civico"/></label>
          <label>Stato <select name="status" defaultValue={site?.status ?? 'planned'}>{siteStates.map(value => <option key={value} value={value}>{siteLabels[value]}</option>)}</select></label>
          <label>Responsabile <input name="manager" maxLength={100} defaultValue={site?.manager} placeholder="Nome e cognome"/></label>
          <div className="client-input">
            {newClient ? <label>Nome del nuovo cliente <input name="new_client" required maxLength={140} value={newClientName} onChange={event => setNewClientName(event.target.value)} placeholder="Nome o ragione sociale" /></label>
              : <label>Cliente <select name="client_id" aria-label="Cliente" required value={selectedClient} onChange={event => setSelectedClient(event.target.value)}><option value="">Seleziona cliente</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>}
            {clients.length > 0 && <button type="button" className="button text-button" onClick={() => setNewClient(value => !value)}>{!newClient && <Plus size={16}/>} {newClient ? 'Scegli un cliente esistente' : 'Crea cliente'}</button>}
          </div>
        </> : <>
          {'site' in editor ? <p className="editor-context">{editor.site.name}</p> : <label>Cantiere
            <select autoFocus name="site_id" required defaultValue={editor.sites.length === 1 ? editor.sites[0].id : ''}>
              <option value="">Seleziona cantiere</option>
              {editor.sites.map(item => <option key={item.id} value={item.id}>{item.name} · {item.city}</option>)}
            </select>
          </label>}
          <label>Tipo di intervento <select autoFocus={'site' in editor} name="kind" defaultValue={job?.kind ?? 'assembly'}>{jobKinds.map(value => <option key={value} value={value}>{kindLabels[value]}</option>)}</select></label>
          <label>Zona <input name="zone" maxLength={120} defaultValue={job?.zone} placeholder="Es. Facciata nord"/></label>
          <div className="form-pair">
            <label>Data prevista <input name="due_date" type="date" required defaultValue={job?.due_date ?? today}/></label>
            <label>Ora <input name="time" type="time" defaultValue={job?.time?.slice(0, 5) ?? defaultTime ?? ''}/></label>
          </div>
          <label>Stato <select name="status" defaultValue={job?.status ?? 'scheduled'}>{jobStates.map(value => <option key={value} value={value}>{jobLabels[value]}</option>)}</select></label>
          <label>Note <textarea name="notes" rows={4} maxLength={2000} defaultValue={job?.notes} placeholder="Indicazioni per l’intervento"/></label>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </fieldset>
      <footer className="drawer-footer">
        {job && onDelete && <button type="button" className="button text-button drawer-delete" disabled={busy} onClick={onDelete}>Elimina intervento</button>}
        <button type="button" className="button secondary" disabled={busy} onClick={onClose}>Annulla</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? 'Salvataggio…' : 'Salva ' + (editor.type === 'site' ? 'cantiere' : 'intervento')}</button>
      </footer>
    </form>
  </Drawer>;
}
