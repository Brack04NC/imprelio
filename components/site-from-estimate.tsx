'use client';

import { useEffect, useState } from 'react';
import { requestWorkspace } from '@/lib/client-api';
import { demoKey, getDemo, updateDemo } from '@/lib/demo';
import type { Action, Client, Identity, Workspace } from '@/lib/domain';
import type { SiteOption } from '@/lib/operation-types';
import { Drawer, Editor, type SitePrefill } from './editor';

export function SiteFromEstimate({ prefill, clientId, identity, today, onClose, onCreated }: {
  prefill: SitePrefill; clientId?: string; identity: Identity; today: string; onClose: () => void; onCreated: (site: SiteOption) => void;
}) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const org = identity.org.id;

  useEffect(() => {
    if (identity.demo) {
      setClients([...getDemo(today).clients].sort((a, b) => a.name.localeCompare(b.name, 'it')));
      return;
    }
    const controller = new AbortController();
    requestWorkspace<Client[]>(new URLSearchParams({ azienda: org, vista: 'clienti' }), controller.signal)
      .then(options => { if (!controller.signal.aborted) setClients(options); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message || 'Impossibile caricare i clienti.'); });
    return () => controller.abort();
  }, [identity.demo, org, retry, today]);

  async function save(action: Action) {
    if (action.action !== 'site') return;
    if (identity.demo) {
      const next = updateDemo(getDemo(today), action);
      const site = next.sites.find(item => item.id === action.id);
      if (!site) throw new Error('Il cantiere non è disponibile.');
      const { id, name, city, client_id } = site;
      const client = next.clients.find(item => item.id === client_id)?.name ?? '';
      localStorage.setItem(demoKey, JSON.stringify(next));
      onCreated({ id, name, city, client_id, client });
      return;
    }

    await requestWorkspace(new URLSearchParams({ azienda: org }), undefined, action);
    const pendingSelection = 'Cantiere salvato. Riprova per selezionarlo nel computo.';
    const { current } = await requestWorkspace<Workspace>(new URLSearchParams({ azienda: org, cantiere: action.id }))
      .catch(() => { throw new Error(pendingSelection); });
    if (!current || current.site.id !== action.id) throw new Error(pendingSelection);
    const { id, name, city, client_id, client } = current.site;
    onCreated({ id, name, city, client_id, client });
  }

  if (clients) return <Editor editor={{ type: 'site', prefill, clientId }} clients={clients} today={today} onClose={onClose} save={save}/>;
  return <Drawer title="Crea cantiere dal computo" onClose={onClose}>
    <div className="drawer-fields">
      {error ? <>
        <p role="alert" className="form-error">{error}</p>
        <button className="button secondary" onClick={() => { setError(''); setRetry(value => value + 1); }}>Riprova</button>
      </> : <p role="status">Caricamento clienti…</p>}
    </div>
  </Drawer>;
}
