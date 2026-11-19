'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Archive, ArrowLeft, ArrowUpRight, Boxes, Calculator, ClipboardList, FileText, FileUp, HardHat, Package, Pencil, Plus, RotateCcw, Search, Truck, Users, Warehouse, X } from 'lucide-react';
import { Drawer } from './editor';
import { SiteFromEstimate } from './site-from-estimate';
import { Shell, orgLink } from './shell';
import type { Identity } from '@/lib/domain';
import { demoKey } from '@/lib/demo';
import { demoSiteOptions, localOperations, operationsKey, updateLocalOperation } from '@/lib/operations-demo';
import { areas, type Definition, type Field, type OperationArea, type OperationKind, type OperationRecord, type OperationWrite, type Option, type SiteOption, type Values } from '@/lib/operation-types';
import { applicableFields, operationDefinition, validateOperation } from '@/lib/operations';
import { documentLineQuantity, formatQuantity } from '@/lib/operation-documents';
import { getWarehouseAvailability, isBelowMinimum } from '@/lib/operation-resources';
import styles from './operation-page.module.css';

const icons = { article: Boxes, movement: Truck, employee: Users, worker: HardHat, crew: Users,
  invoice: FileText, order: ClipboardList, ddt: Truck, estimate: Calculator };
const areaIcons = { magazzino: Warehouse, personale: Users, amministrazione: FileText, 'computi-metrici': Calculator };
const numberPerPage = 12;

function dateLabel(value: string) {
  return value.split('-').reverse().join('/');
}

export function OperationPage({ identity, area, today, initial, sites, requestedSite, requestedKind }: {
  identity: Identity; area: OperationArea; today: string; initial: OperationRecord[]; sites: SiteOption[];
  requestedSite?: string; requestedKind?: string;
}) {
  const router = useRouter();
  const section = areas[area];
  const kinds: readonly OperationKind[] = section.kinds;
  const [kind, setKind] = useState(kinds.find(value => value === requestedKind) ?? kinds[0]);
  const [records, setRecords] = useState(initial);
  const [availableSites, setAvailableSites] = useState(sites);
  const [siteFilter, setSiteFilter] = useState(typeof requestedSite === 'string' && /^[a-f0-9-]{36}$/i.test(requestedSite) ? requestedSite : '');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [archive, setArchive] = useState(false);
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<OperationRecord | 'create' | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const focusBack = useRef<HTMLElement | null>(null);
  const inFlight = useRef(false);
  const definition = operationDefinition(kind);
  const AreaIcon = areaIcons[area];
  const warehouseAvailability = useMemo(() => area === 'magazzino' ? getWarehouseAvailability(records) : new Map<string, bigint>(), [area, records]);

  useEffect(() => {
    if (!identity.demo) {
      setRecords(initial);
      setAvailableSites(sites);
      return;
    }
    const sync = () => { setRecords(localOperations(today, area)); setAvailableSites(demoSiteOptions(today, true)); };
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === operationsKey || event.key === demoKey || event.key === null) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [identity.demo, initial, sites, today, area]);

  function selectKind(value: OperationKind) {
    setKind(value); setStatus(''); setQuery(''); setPage(1); setNotice(undefined);
  }

  function openView(value: OperationRecord | 'create') {
    focusBack.current = document.activeElement as HTMLElement;
    setEditor(value);
  }
  function closeView() {
    setEditor(null);
    requestAnimationFrame(() => focusBack.current?.isConnected && focusBack.current.focus());
  }

  async function persist(input: OperationWrite) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice(undefined);
    try {
      const action = validateOperation(input);
      let record: OperationRecord;
      if (identity.demo) {
        record = updateLocalOperation(today, action);
      } else {
        const response = await fetch('/api/operativita?' + new URLSearchParams({ azienda: identity.org.id }), {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Salvataggio non riuscito.');
        const updated_at = new Date().toISOString();
        if (action.action === 'save') {
          const { action: _, ...saved } = action;
          record = { ...saved, archived: false, updated_at };
        } else {
          const previous = records.find(item => item.id === action.id)!;
          record = { ...previous, archived: action.action === 'archive', updated_at };
        }
        router.refresh();
      }
      setRecords(previous => [record, ...previous.filter(item => item.id !== record.id)]);
      setNotice({ text: action.action === 'archive' ? 'Scheda archiviata.' : action.action === 'restore' ? 'Scheda ripristinata.' : 'Scheda salvata.' });
      if (editor) closeView();
    } finally { inFlight.current = false; setBusy(false); }
  }

  const selectedSite = availableSites.find(site => site.id === siteFilter);
  const siteById = new Map(availableSites.map(site => [site.id, site]));
  const needle = query.trim().toLocaleLowerCase('it');
  const filterBySite = definition.site !== 'none' && selectedSite;
  const active = records.filter(record => record.kind === kind && !record.archived).length;
  const archived = records.filter(record => record.kind === kind && record.archived).length;
  const filtered = records.filter(record => record.kind === kind && record.archived === archive
    && (!filterBySite || record.site_id === filterBySite.id) && (!status || record.status === status)
    && (!needle || [record.title, ...Object.values(record.fields), siteById.get(record.site_id ?? '')?.name]
      .some(value => value?.toLocaleLowerCase('it').includes(needle))))
    .sort((first, second) => second.updated_at.localeCompare(first.updated_at) || first.title.localeCompare(second.title, 'it'));
  const pageCount = Math.max(1, Math.ceil(filtered.length / numberPerPage));
  const shownPage = Math.min(page, pageCount);
  const shown = filtered.slice((shownPage - 1) * numberPerPage, shownPage * numberPerPage);
  const articles = records.filter(record => record.kind === 'article' && !record.archived)
    .map(record => ({ value: record.id, label: record.title + (record.fields.unit ? ' · ' + record.fields.unit : '') }));

  return <Shell identity={identity} section={area}>
    {selectedSite && <Link className="button text-button back-link" href={orgLink('/cantieri/' + selectedSite.id, identity)}>
      <ArrowLeft size={17}/> {selectedSite.name}</Link>}
    <header className={styles.heading}>
      <div className={styles.headingText}><span className={styles.headingIcon}><AreaIcon size={26}/></span><div>
        <h1>{section.title}</h1><p>{section.description}</p>
      </div></div>
      <div className={styles.recordActions}>
        {(area === 'magazzino' || area === 'personale') && <Link className="button secondary" href={orgLink('/gestione/assegnazioni-veicoli', identity)}>
          <Truck size={18}/> Assegnazioni veicoli
        </Link>}
        {kind === 'estimate' && <Link className="button secondary" href={orgLink('/gestione/preventivi-computo'
          + (selectedSite ? '?cantiere=' + selectedSite.id : ''), identity)}><FileUp size={18}/> Preventivo da PDF</Link>}
        <button className="button primary" onClick={() => openView('create')}><Plus size={19}/> Aggiungi {definition.singular.toLocaleLowerCase('it')}</button>
      </div>
    </header>

    {kinds.length > 1 && <div className={styles.tabs} role="group" aria-label="Tipo di scheda">
      {kinds.map(value => {
        const Icon = icons[value];
        return <button key={value} aria-pressed={value === kind} onClick={() => selectKind(value)}>
          <Icon size={18}/>{operationDefinition(value).plural}</button>;
      })}
    </div>}

    <section className={styles.list} aria-labelledby="operation-list-heading">
      <div className={styles.listHeading}><div><h2 id="operation-list-heading">{kind === 'estimate' ? 'Elenco computi' : definition.plural}</h2>
        {kind !== 'estimate' && <p>{definition.description}</p>}</div>
        <button className="button secondary" aria-pressed={archive} onClick={() => { setArchive(!archive); setPage(1); setNotice(undefined); }}>
          <Archive size={17}/>{archive ? `Attive (${active})` : `Archiviate (${archived})`}</button>
      </div>
      <div className={styles.filters}>
        <label><span>Cerca</span><span className={styles.searchInput}><Search size={17}/><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Cerca nelle schede"/></span></label>
        <label><span>Stato</span><select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
          <option value="">Tutti gli stati</option>{definition.statuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        {definition.site !== 'none' && <label><span>Cantiere</span><select value={selectedSite?.id ?? ''} onChange={event => { setSiteFilter(event.target.value); setPage(1); }}>
          <option value="">Tutti i cantieri</option>{availableSites.map(site => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}
        </select></label>}
      </div>
      {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'form-error' : styles.notice}>{notice.text}</p>}
      {shown.length > 0 ? <ul className={styles.cards}>{shown.map(record => {
        const Icon = icons[record.kind];
        const site = siteById.get(record.site_id ?? '');
        const low = record.kind === 'article' && isBelowMinimum(record, warehouseAvailability.get(record.id) ?? 0n);
        return <li key={record.id} className={styles.record}>
          <div className={styles.recordHead}><span className={styles.recordIcon}><Icon size={19}/></span>
            <span className={styles.badge}>{definition.statuses.find(item => item.value === record.status)?.label ?? record.status}</span></div>
          <h3>{record.title}</h3>
          {record.record_date && <time dateTime={record.record_date}>{dateLabel(record.record_date)}</time>}
          {definition.summary?.(record, records, warehouseAvailability).filter(Boolean).map((value, index) => <p key={index} className={styles.summary}>{value}</p>)}
          {low && <span className={styles.low}>Sotto scorta minima</span>}
          {site && <Link className={styles.site} href={orgLink('/cantieri/' + site.id, identity)}>{site.name}<ArrowUpRight size={14}/></Link>}
          <div className={styles.recordActions}>
            <button className="button secondary" onClick={() => openView(record)}><Pencil size={15}/>{record.archived ? 'Apri' : 'Modifica'}</button>
            <button className="button text-button" disabled={busy} onClick={() => {
              void persist({ action: record.archived ? 'restore' : 'archive', id: record.id, kind: record.kind })
                .catch(error => setNotice({ text: error instanceof Error ? error.message : 'Operazione non riuscita.', error: true }));
            }}>{record.archived ? <RotateCcw size={15}/> : <Archive size={15}/>}
              {record.archived ? 'Ripristina' : 'Archivia'}</button>
          </div>
        </li>;
      })}</ul> : <div className={styles.empty}><Package size={29}/><strong>Nessuna scheda {archive ? 'archiviata' : 'trovata'}</strong>
        <p>{query || status || filterBySite ? 'Cambia i filtri per vedere altre schede.' : archive ? 'Le schede archiviate compariranno qui.' : 'Aggiungi la prima scheda per iniziare.'}</p></div>}
      {pageCount > 1 && <div className={styles.pagination}><span>Pagina {shownPage} di {pageCount}</span>
        <button className="button secondary" disabled={shownPage <= 1} onClick={() => setPage(shownPage - 1)}>Indietro</button>
        <button className="button secondary" disabled={shownPage >= pageCount} onClick={() => setPage(shownPage + 1)}>Avanti</button>
      </div>}
    </section>
    {editor && <OperationEditor definition={definition} record={editor === 'create' ? undefined : editor} today={today}
      identity={identity} sites={availableSites} articles={articles} selectedSite={selectedSite?.id ?? ''} onClose={closeView} save={persist}
      onSiteCreated={site => setAvailableSites(previous => [site, ...previous.filter(item => item.id !== site.id)])}/>}
  </Shell>;
}

function initialValues(fields: Field[], values?: Values): Values {
  return Object.fromEntries(fields.map(field => [field.key, values?.[field.key] ?? field.initial ?? '']));
}

function InputField({ field, value, change, articles = [] }: {
  field: Field; value: string; change: (value: string) => void; articles?: Option[];
}) {
  if (field.type === 'select' || field.type === 'article') {
    const options = field.type === 'article' ? articles : field.options ?? [];
    return <label>{field.label}<select aria-label={field.label} required={field.required} value={value} onChange={event => change(event.target.value)}>
      <option value="">Seleziona</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
  }
  if (field.type === 'textarea') return <label>{field.label}<textarea rows={3} maxLength={2000} required={field.required} value={value}
    placeholder={field.placeholder} onChange={event => change(event.target.value)}/></label>;
  return <label>{field.label}<input type={field.type === 'number' ? 'text' : field.type ?? 'text'}
    inputMode={field.type === 'number' ? (field.decimals ? 'decimal' : 'numeric') : undefined}
    required={field.required} maxLength={field.type === 'number' ? 14 : 2000} value={value}
    placeholder={field.placeholder} onChange={event => change(event.target.value)}/></label>;
}

function OperationEditor({ definition, record, today, identity, sites, articles, selectedSite, onClose, save, onSiteCreated }: {
  definition: Definition; record?: OperationRecord; today: string; sites: SiteOption[]; articles: Option[];
  identity: Identity; onSiteCreated: (site: SiteOption) => void;
  selectedSite: string; onClose: () => void; save: (action: OperationWrite) => Promise<void>;
}) {
  const lineFields = definition.lineFields ?? [];
  const [title, setTitle] = useState(record?.title ?? '');
  const [status, setStatus] = useState(record?.status ?? definition.defaultStatus);
  const [date, setDate] = useState(record?.record_date ?? (definition.dateRequired ? today : ''));
  const [site, setSite] = useState(record ? record.site_id ?? '' : selectedSite);
  const [siteEditor, setSiteEditor] = useState(false);
  const [siteNotice, setSiteNotice] = useState('');
  const siteSelect = useRef<HTMLSelectElement>(null);
  const [fields, setFields] = useState(() => initialValues(definition.fields, record?.fields));
  const [lines, setLines] = useState(() => (record?.lines ?? (lineFields.length ? [{}] : []))
    .map((row, key) => ({ key, fields: initialValues(lineFields, row) })));
  const rowId = useRef(lines.length);
  const identifier = useRef(record?.id ?? '');
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hint = definition.totals?.(fields, lines.map(line => line.fields));
  const readOnly = Boolean(record?.archived);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || readOnly) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      identifier.current ||= crypto.randomUUID();
      await save({ action: 'save', id: identifier.current, kind: definition.kind, title, status, site_id: site || null,
        record_date: date || null, fields, lines: lines.map(line => line.fields) });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Salvataggio non riuscito.');
    } finally { inFlight.current = false; setBusy(false); }
  }

  const subject = definition.singular.toLocaleLowerCase('it');
  const createSite = definition.kind === 'estimate' && !readOnly && !site;
  function closeSiteEditor() {
    setSiteEditor(false);
    requestAnimationFrame(() => siteSelect.current?.focus());
  }

  return <><Drawer title={readOnly ? record!.title : (record ? 'Modifica ' : 'Aggiungi ') + subject} onClose={onClose} busy={busy}>
    <form className="editor-form" onSubmit={submit}>
      <div className="drawer-fields">
        <fieldset className={`form-grid ${styles.editorFields}`} disabled={busy || readOnly}>
          <label>{definition.titleLabel}<input autoFocus maxLength={160} required value={title} onChange={event => setTitle(event.target.value)}/></label>
          <div className="form-pair">
            <label>Stato<select aria-label="Stato" value={status} onChange={event => setStatus(event.target.value)}>
              {definition.statuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            {definition.dateLabel && <label>{definition.dateLabel}<input type="date" required={definition.dateRequired} value={date} onChange={event => setDate(event.target.value)}/></label>}
          </div>
          {definition.site !== 'none' && <div className="client-input">
            <label>Cantiere<select ref={siteSelect} aria-label="Cantiere" required={definition.site === 'required'} value={site} onChange={event => {
              setSite(event.target.value); setSiteNotice('');
            }}>
              <option value="">{definition.site === 'required' ? 'Seleziona cantiere' : 'Nessun cantiere'}</option>
              {sites.map(item => <option key={item.id} value={item.id}>{item.name} · {item.client || item.city}</option>)}</select></label>
            {createSite && <button type="button" className="button text-button" onClick={() => setSiteEditor(true)}>
              <HardHat size={17}/> Crea cantiere dal computo
            </button>}
            {siteNotice && <p role="status" className={styles.notice}>{siteNotice}</p>}
          </div>}
          {applicableFields(definition.fields, fields).map(field => <InputField key={field.key} field={field} value={fields[field.key]}
            articles={articles} change={value => setFields(previous => ({ ...previous, [field.key]: value }))}/>)}
          {lineFields.length > 0 && <section className={styles.lines} aria-label="Righe">
            <div className={styles.lineHead}><h3>{definition.kind === 'estimate' ? 'Misurazioni' : 'Righe del documento'}</h3>
              {!readOnly && <button className="button secondary" type="button" disabled={lines.length >= 100} onClick={() => {
                const key = rowId.current++;
                setLines(previous => [...previous, { key, fields: initialValues(lineFields) }]);
              }}><Plus size={16}/> Aggiungi riga</button>}</div>
            {lines.map((row, index) => {
              const measured = definition.kind === 'estimate' ? documentLineQuantity('estimate', row.fields) : null;
              return <fieldset key={row.key} className={styles.line}>
                <legend>Riga {index + 1}</legend>
                <div className={styles.lineFields}>{lineFields.map(field => <InputField key={field.key} field={field} value={row.fields[field.key]}
                  change={value => setLines(previous => previous.map(entry => entry.key === row.key
                    ? { ...entry, fields: { ...entry.fields, [field.key]: value } } : entry))}/>)}</div>
                {measured !== null && <small>Quantità misura {formatQuantity(measured)} {row.fields.unit}</small>}
                {!readOnly && <button type="button" className="button text-button" aria-label={`Rimuovi riga ${index + 1}`}
                  onClick={() => setLines(previous => previous.filter(entry => entry.key !== row.key))}><X size={15}/> Rimuovi</button>}
              </fieldset>;
            })}
            {hint && <dl className={styles.totals} aria-label="Riepilogo calcoli">{hint.map(item =>
              <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>}
          </section>}
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <footer className="drawer-footer"><button type="button" disabled={busy} className="button secondary" onClick={onClose}>{readOnly ? 'Chiudi' : 'Annulla'}</button>
        {!readOnly && <button type="submit" className="button primary" disabled={busy}>{busy ? 'Salvataggio…' : 'Salva scheda'}</button>}</footer>
    </form>
  </Drawer>
    {siteEditor && <SiteFromEstimate prefill={{ name: title, city: '', address: '', clientName: '' }} identity={identity} today={today}
      onClose={closeSiteEditor} onCreated={created => {
        onSiteCreated(created);
        setSite(created.id);
        setSiteNotice('Cantiere creato e selezionato.');
        closeSiteEditor();
      }}/>}
  </>;
}
