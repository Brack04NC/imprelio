'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowUpRight, Building2, ChevronRight, HardHat, Pencil, Plus, Search, Users } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { clientSchema, demoClientDirectory, type ClientEntry } from '@/lib/client-directory';
import { demoKey, getDemo } from '@/lib/demo';
import { siteLabels, type Identity } from '@/lib/domain';
import { Drawer } from './editor';
import { orgLink, Shell } from './shell';
import styles from './clients-page.module.css';

const fields = [
  { key: 'name', label: 'Nome o ragione sociale', type: 'text', maxLength: 140 },
  { key: 'contact_name', label: 'Referente', type: 'text', maxLength: 140 },
  { key: 'email', label: 'Email', type: 'email', maxLength: 254 },
  { key: 'phone', label: 'Telefono', type: 'tel', maxLength: 50 },
  { key: 'address', label: 'Indirizzo', type: 'text', maxLength: 200 },
] as const;

function searchKey(value: string) {
  return value.toLocaleLowerCase('it').normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function siteCount(count: number) {
  return count === 1 ? '1 cantiere' : `${count} cantieri`;
}

export function ClientDirectory({ identity, initial, today }: { identity: Identity; initial: ClientEntry[]; today: string }) {
  const params = useSearchParams();
  const [clients, setClients] = useState(initial);
  const [ready, setReady] = useState(!identity.demo);
  const [query, setQuery] = useState('');
  const [edit, setEdit] = useState<ClientEntry | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const editId = useRef('');
  const editTrigger = useRef<HTMLElement | null>(null);
  const pending = useRef(false);
  const focusDetail = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const selectedParam = params.get('cliente');
  const search = searchKey(query.trim());
  const filtered = clients.filter(client => [client.name, client.contact_name, client.email, client.phone, client.address]
    .some(value => searchKey(value).includes(search))).sort((a, b) => a.name.localeCompare(b.name, 'it'));
  const selected = filtered.find(client => client.id === selectedParam)
    ?? (selectedParam && !search ? undefined : filtered[0]);

  useEffect(() => {
    if (!identity.demo) { setClients(initial); return; }
    function sync() {
      setClients(demoClientDirectory(getDemo(today)));
      setReady(true);
    }
    function storage(event: StorageEvent) { if (event.key === demoKey || event.key === null) sync(); }
    sync();
    window.addEventListener('storage', storage);
    window.addEventListener('pageshow', sync);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('pageshow', sync);
    };
  }, [identity.demo, initial, today]);

  useEffect(() => {
    if (focusDetail.current && selected?.id === selectedParam) {
      focusDetail.current = false;
      title.current?.focus();
    }
  }, [selected?.id, selectedParam]);

  function selectClient(id: string, focus = false) {
    const href = orgLink(`/clienti?cliente=${encodeURIComponent(id)}`, identity);
    if (selectedParam !== id) {
      focusDetail.current = focus;
      window.history.pushState(null, '', href);
    } else if (focus) title.current?.focus();
  }

  function openEditor(client: ClientEntry | 'new', trigger: HTMLElement) {
    editId.current = client === 'new' ? crypto.randomUUID() : client.id;
    editTrigger.current = trigger;
    setError('');
    setEdit(client);
  }

  function closeEditor() {
    setEdit(null);
    requestAnimationFrame(() => editTrigger.current?.focus());
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const raw = Object.fromEntries(new FormData(event.currentTarget));
    const result = clientSchema.safeParse({ ...raw, id: editId.current });
    if (!result.success) {
      setError('Controlla il nome e i recapiti inseriti.');
      return;
    }
    const profile = result.data;
    pending.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (identity.demo) {
        const store = getDemo(today);
        if (store.clients.some(client => client.id !== profile.id && client.name.toLowerCase() === profile.name.toLowerCase())) {
          throw new Error('Esiste già un cliente con questo nome.');
        }
        store.clients = [...store.clients.filter(client => client.id !== profile.id), profile];
        localStorage.setItem(demoKey, JSON.stringify(store));
        setClients(demoClientDirectory(store));
      } else {
        const response = await fetch(`/api/clienti?azienda=${encodeURIComponent(identity.org.id)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile),
        });
        if (!response.ok) {
          const failure = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(failure?.error ?? 'Salvataggio non riuscito. Riprova.');
        }
        setClients(current => [
          ...current.filter(client => client.id !== profile.id),
          { ...profile, sites: current.find(client => client.id === profile.id)?.sites ?? [] },
        ]);
      }
      setQuery('');
      selectClient(profile.id);
      setNotice(edit === 'new' ? 'Cliente creato.' : 'Cliente aggiornato.');
      closeEditor();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Salvataggio non riuscito. Riprova.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return <Shell identity={identity} section="clienti">
    <header className="page-header">
      <div><h1>Clienti</h1><p>Gestisci le anagrafiche e consulta i cantieri assegnati a ogni cliente.</p></div>
      <button className="button primary" onClick={event => openEditor('new', event.currentTarget)}><Plus size={19}/> Nuovo cliente</button>
    </header>
    {notice && <p className="access-notice" role="status">{notice}</p>}
    <div className={styles.grid}>
      <section className={`panel ${styles.directory}`} aria-label="Elenco clienti">
        <header className="panel-header">
          <div><h2>Anagrafiche</h2><p>{filtered.length} {filtered.length === 1 ? 'cliente' : 'clienti'}</p></div>
          <span className="agenda-heading-icon"><Users size={20}/></span>
        </header>
        <div className={styles.search}>
          <label className="search-field"><Search size={18}/><input type="search" aria-label="Cerca clienti" placeholder="Cerca clienti" maxLength={140} value={query} onChange={event => setQuery(event.currentTarget.value)}/></label>
        </div>
        {filtered.length ? <ul className={styles.clientList}>
          {filtered.map(client => <li key={client.id}>
            <button type="button" className={styles.client} aria-pressed={client.id === selected?.id} onClick={() => selectClient(client.id, true)}>
              <span className={styles.clientIcon}><Building2 size={19}/></span>
              <span className={styles.clientCaption}><strong>{client.name}</strong><small>{siteCount(client.sites.length)}</small></span>
              <ChevronRight size={16} className={styles.arrow}/>
            </button>
          </li>)}
        </ul> : <div className="empty">{query.trim() ? 'Nessun cliente corrisponde alla ricerca.' : 'Aggiungi il primo cliente per collegargli i cantieri.'}</div>}
      </section>

      {!selected && selectedParam && !search && <div className="empty panel" role="status">
        {ready ? 'Cliente non disponibile. Seleziona un cliente dall’elenco.' : 'Caricamento del cliente…'}
      </div>}
      {selected && <section className={`panel ${styles.detail}`} aria-labelledby="client-detail-title">
        <div className={styles.detailHeader}>
          <span className={styles.clientIcon}><Building2 size={23}/></span>
          <div>
            <h2 id="client-detail-title" ref={title} tabIndex={-1}>{selected.name}</h2>
            {selected.contact_name && <p>{selected.contact_name}</p>}
          </div>
          <button className="button secondary" onClick={event => openEditor(selected, event.currentTarget)}><Pencil size={16}/> Modifica</button>
        </div>
        {(selected.email || selected.phone || selected.address || selected.notes) && <dl className={styles.contacts}>
          {selected.email && <div><dt>Email</dt><dd><a href={`mailto:${encodeURIComponent(selected.email)}`}>{selected.email}</a></dd></div>}
          {selected.phone && <div><dt>Telefono</dt><dd>{selected.phone}</dd></div>}
          {selected.address && <div><dt>Indirizzo</dt><dd>{selected.address}</dd></div>}
          {selected.notes && <div className={styles.notes}><dt>Note</dt><dd>{selected.notes}</dd></div>}
        </dl>}
        <div className={styles.sitesHeader}>
          <div><h3>Cantieri collegati</h3><p>{siteCount(selected.sites.length)}</p></div>
          <Link className="button secondary" href={orgLink(`/cantieri?nuovo=1&cliente=${encodeURIComponent(selected.id)}`, identity)}><Plus size={16}/> Nuovo cantiere</Link>
        </div>
        {selected.sites.length ? <ul className={styles.siteList}>
          {selected.sites.map(site => <li key={site.id}>
            <Link className={styles.site} href={orgLink(`/cantieri/${site.id}`, identity)}>
              <span className={styles.siteIcon}><HardHat size={18}/></span>
              <span className={styles.clientCaption}><strong>{site.name}</strong><small>{[site.code, site.address, site.city].filter(Boolean).join(' · ')}</small></span>
              <span className={`badge badge-${site.status}`}><i/>{siteLabels[site.status]}</span>
              <ArrowUpRight size={16} className={styles.arrow}/>
            </Link>
          </li>)}
        </ul> : <div className="empty">I cantieri di questo cliente compariranno qui.</div>}
      </section>}
    </div>

    {edit && <Drawer title={edit === 'new' ? 'Nuovo cliente' : 'Modifica cliente'} busy={saving} onClose={closeEditor}>
      <form onSubmit={save} className="editor-form">
        <fieldset className="form-grid drawer-fields" disabled={saving}>
          {fields.map(({ key, label, type, maxLength }) => <label key={key}>{label}<input name={key} type={type} autoFocus={key === 'name'} required={key === 'name'} maxLength={maxLength} defaultValue={edit === 'new' ? '' : edit[key]}/></label>)}
          <label>Note<textarea name="notes" rows={4} maxLength={2000} defaultValue={edit === 'new' ? '' : edit.notes}/></label>
          {error && <p className="form-error" role="alert">{error}</p>}
        </fieldset>
        <footer className="drawer-footer">
          <button type="button" className="button secondary" disabled={saving} onClick={closeEditor}>Annulla</button>
          <button type="submit" className="button primary" disabled={saving}>{saving ? 'Salvataggio…' : 'Salva cliente'}</button>
        </footer>
      </form>
    </Drawer>}
  </Shell>;
}
