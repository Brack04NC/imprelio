'use client';

import { useEffect, useState } from 'react';
import { requestWorkspace } from '@/lib/client-api';
import { demoKey, getDemo, updateDemo } from '@/lib/demo';
import type { Action, Client, Identity } from '@/lib/domain';
import type { SiteOption } from '@/lib/operation-types';
import { Drawer, Editor, type SitePrefill } from './editor';

export function SiteFromEstimate({ prefill, identity, today, onClose, onCreated }: {
  prefill: SitePrefill; identity: Identity; today: string; onClose: () => void; onCreated: (site: SiteOption) => void;
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
    const { id, name, city, client_id, new_client } = action;
    let client = clients?.find(item => item.id === client_id)?.name ?? new_client;
    if (identity.demo) {
      const next = updateDemo(getDemo(today), action);
      localStorage.setItem(demoKey, JSON.stringify(next));
      client = next.clients.find(item => item.id === next.sites.find(site => site.id === id)?.client_id)?.name ?? client;
    } else {
      await requestWorkspace(new URLSearchParams({ azienda: org }), undefined, action);
    }
    onCreated({ id, name, city, client });
  }

  if (clients) return <Editor editor={{ type: 'site', prefill }} clients={clients} today={today} onClose={onClose} save={save}/>;
  return <Drawer title="Crea cantiere dal computo" onClose={onClose}>
    <div className="drawer-fields">
      {error ? <>
        <p role="alert" className="form-error">{error}</p>
        <button className="button secondary" onClick={() => { setError(''); setRetry(value => value + 1); }}>Riprova</button>
      </> : <p role="status">Caricamento clienti…</p>}
    </div>
  </Drawer>;
}
