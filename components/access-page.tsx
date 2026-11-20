'use client';

import { Mail, Plus, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { requestWorkspace } from '@/lib/client-api';
import { demoKey, getDemo, getDemoBacking, updateDemo } from '@/lib/demo';
import { actionSchema, type Access, type Action, type Identity } from '@/lib/domain';
import { Drawer } from './editor';
import { Shell } from './shell';

export function AccessPage({ identity, initial, today }: { identity: Identity; initial: Access; today: string }) {
  const [access, setAccess] = useState(initial);
  const [invite, setInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (identity.demo) setAccess(getDemo(today).access); }, [identity.demo, today]);
  function close() { setInvite(false); setError(''); requestAnimationFrame(() => trigger.current?.focus()); }
  async function run(action: Action) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    const query = new URLSearchParams({ azienda: identity.org.id, vista: 'accessi' });
    try {
      if (identity.demo) {
        const next = updateDemo(getDemoBacking(today), action);
        localStorage.setItem(demoKey, JSON.stringify(next));
        setAccess(next.access);
      } else {
        await requestWorkspace(query, undefined, action);
        setAccess(await requestWorkspace<Access>(query));
      }
      setNotice(action.action === 'invite' ? (identity.demo ? 'Invito aggiunto nella demo.' : 'Email di invito inviata.') : 'Accesso aggiornato.');
      if (invite) close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Operazione non riuscita.');
      if (action.action === 'invite' && !identity.demo) {
        try { setAccess(await requestWorkspace<Access>(query)); } catch { /* Keep the last retrieved list. */ }
      }
    } finally { setBusy(false); inFlight.current = false; }
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = actionSchema.safeParse({ action: 'invite', email: String(new FormData(event.currentTarget).get('email') ?? '').trim() });
    if (result.success) void run(result.data);
    else setError('Inserisci un indirizzo email valido.');
  }

  return <Shell identity={identity} section="accessi">
    <section className="page-header"><div><h1>Gestione accessi</h1><p>Invita i coordinatori e gestisci gli accessi all’azienda.</p></div><button ref={trigger} className="button primary" onClick={() => { setError(''); setInvite(true); }}><Plus size={19}/> Invita coordinatore</button></section>
    {notice && <p role="status" className="access-notice">{notice}</p>}
    {error && !invite && <p role="alert" className="form-error">{error}</p>}
    <section className="panel access-panel">
      <header className="panel-header"><div><h2>Utenti</h2><p>{access.members.length} profili</p></div><span className="agenda-heading-icon"><Users size={20}/></span></header>
      <ul className="access-list">{access.members.map(person => <li key={person.user_id}><span className="job-icon job-survey"><ShieldCheck size={18}/></span><div><strong>{person.email}</strong><small>{person.role === 'admin' ? 'Amministratore' : 'Coordinatore'} · {person.active ? 'Attivo' : 'Disattivato'}</small></div>
        {person.role === 'coordinator' && <button className="button secondary" disabled={busy} onClick={() => run({ action: 'member', id: person.user_id, active: !person.active })}>{person.active ? 'Disattiva' : 'Riattiva'}</button>}
      </li>)}</ul>
    </section>
    <section className="panel access-panel">
      <header className="panel-header"><div><h2>Inviti in attesa</h2><p>{access.invitations.length} {access.invitations.length === 1 ? 'invito' : 'inviti'}</p></div><span className="agenda-heading-icon"><Mail size={20}/></span></header>
      {access.invitations.length ? <ul className="access-list">{access.invitations.map(entry => <li key={entry.email}><div><strong>{entry.email}</strong></div><button className="button secondary" disabled={busy} onClick={() => run({ action: 'invite', email: entry.email })}>Reinvia</button></li>)}</ul> : <div className="empty">Nessun invito in attesa.</div>}
    </section>
    {invite && <Drawer title="Invita coordinatore" busy={busy} onClose={close}>
      <form onSubmit={send} className="editor-form"><fieldset className="form-grid drawer-fields" disabled={busy}>
        <label>Indirizzo email <input autoFocus required name="email" type="email" maxLength={254} placeholder="nome@azienda.it"/></label>
        {error && <p className="form-error" role="alert">{error}</p>}
      </fieldset><footer className="drawer-footer"><button type="button" className="button secondary" disabled={busy} onClick={close}>Annulla</button><button className="button primary" disabled={busy}>{busy ? 'Invio…' : 'Invia invito'}</button></footer></form>
    </Drawer>}
  </Shell>;
}
