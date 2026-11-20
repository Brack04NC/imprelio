'use client';

import { useRef, useState, type FormEvent } from 'react';
import { clientSchema } from '@/lib/client-directory';
import { demoKey, getDemoBacking } from '@/lib/demo';
import type { Client, Identity } from '@/lib/domain';
import { isDemoTombstoned } from '@/lib/trash-storage';
import { Drawer } from './editor';

export function EstimateClientEditor({ identity, today, initialName, onClose, onCreated }: {
  identity: Identity; today: string; initialName?: string; onClose: () => void; onCreated: (client: Client) => void;
}) {
  const id = useRef<string | null>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;

    const form = new FormData(event.currentTarget);
    id.current ??= crypto.randomUUID();
    const result = clientSchema.safeParse({
      id: id.current, name: form.get('name'), email: form.get('email'), phone: form.get('phone'),
      address: '', contact_name: '', notes: '',
    });
    if (!result.success) {
      setError('Controlla il nome e i recapiti inseriti.');
      return;
    }

    const profile = result.data;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (identity.demo) {
        const store = getDemoBacking(today);
        if (isDemoTombstoned('client', profile.id)) throw new Error('Il cliente è nel cestino. Ripristinalo prima di modificarlo.');
        const name = profile.name.toLowerCase();
        if (store.clients.some(client => client.id !== profile.id && client.name.toLowerCase() === name)) {
          throw new Error('Esiste già un cliente con questo nome.');
        }
        const clients = [...store.clients.filter(client => client.id !== profile.id), profile];
        localStorage.setItem(demoKey, JSON.stringify({ ...store, clients }));
      } else {
        const query = new URLSearchParams({ azienda: identity.org.id });
        const response = await fetch(`/api/clienti?${query}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile),
        });
        if (!response.ok) {
          const failure = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(failure?.error || 'Salvataggio non riuscito. Riprova.');
        }
      }
      onCreated({ id: profile.id, name: profile.name });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Salvataggio non riuscito. Riprova.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <Drawer title="Nuovo cliente" onClose={onClose} busy={busy}>
    <form className="editor-form" onSubmit={save} aria-busy={busy}>
      <fieldset className="form-grid drawer-fields" disabled={busy}>
        <label>Nome o ragione sociale<input autoFocus name="name" required maxLength={140} defaultValue={initialName?.slice(0, 140)}/></label>
        <label>Email<input name="email" type="email" maxLength={254}/></label>
        <label>Telefono<input name="phone" type="tel" maxLength={50}/></label>
        {error && <p className="form-error" role="alert">{error}</p>}
      </fieldset>
      <footer className="drawer-footer">
        <button type="button" className="button secondary" onClick={onClose} disabled={busy}>Annulla</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? 'Salvataggio…' : 'Salva cliente'}</button>
      </footer>
    </form>
  </Drawer>;
}
