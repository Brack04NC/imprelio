'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Archive, ArrowLeft, ArrowUpRight, Boxes, Calculator, CalendarCheck, CalendarClock, ClipboardList, FileText, FileUp, HardHat, Package, Pencil, Plus, RotateCcw, Search, Trash2, Truck, Users, Warehouse, Wrench, X } from 'lucide-react';
import { ContextActions, type ContextAction } from './context-actions';
import { Drawer } from './editor';
import { SiteFromEstimate } from './site-from-estimate';
import { Shell, orgLink } from './shell';
import { useTrashRemoval } from './trash-removal';
import { useRomeToday } from './use-rome-today';
import type { Identity } from '@/lib/domain';
import { demoKey } from '@/lib/demo';
import { demoSiteOptions, localOperations, operationsKey, updateLocalOperation } from '@/lib/operations-demo';
import { areas, type Definition, type Field, type OperationArea, type OperationKind, type OperationRecord, type OperationWrite, type Option, type SiteOption, type Values } from '@/lib/operation-types';
import { applicableFields, operationDefinition, validateOperation } from '@/lib/operations';
import { documentLineQuantity, formatQuantity } from '@/lib/operation-documents';
import { formatStockQuantity, getWarehouseAvailability, isBelowMinimum, stockMinimum } from '@/lib/operation-resources';
import { demoTrashKey } from '@/lib/trash-storage';
import { localVehicleAssignments } from '@/lib/vehicle-assignments';
import { maintenanceScheduleError, periodsOverlap, vehicleMaintenance, vehicleMaintenanceState } from '@/lib/vehicle-maintenance';
import styles from './operation-page.module.css';

const icons = { article: Boxes, movement: Truck, employee: Users, worker: HardHat, crew: Users,
  invoice: FileText, order: ClipboardList, ddt: Truck, estimate: Calculator };
const areaIcons = { magazzino: Warehouse, personale: Users, amministrazione: FileText, 'computi-metrici': Calculator };
const numberPerPage = 12;
type Editing = OperationRecord | 'create' | { movementFor: string };

function dateLabel(value: string) {
  return value.split('-').reverse().join('/');
}

function attendanceHref(identity: Identity, person?: string) {
  return orgLink('/gestione/presenze' + (person ? '?' + new URLSearchParams({ persona: person }) : ''), identity);
}

function workerDeadlinesHref(identity: Identity, worker: string) {
  return orgLink('/gestione/operai/' + encodeURIComponent(worker) + '/scadenze', identity);
}

const maintenanceLabels = {
  active: 'In manutenzione', scheduled: 'Manutenzione programmata', past: 'Manutenzione conclusa',
} as const;

function effectiveStatus(record: OperationRecord, today: string) {
  const period = vehicleMaintenance(record);
  return period && vehicleMaintenanceState(period, today) === 'active' ? 'inactive' : record.status;
}

export function OperationPage({ identity, area, today: initialToday, initial, sites, requestedSite, requestedKind, requestedVehicle, requestedRecord }: {
  identity: Identity; area: OperationArea; today: string; initial: OperationRecord[]; sites: SiteOption[];
  requestedSite?: string; requestedKind?: string; requestedVehicle?: string; requestedRecord?: string;
}) {
  const router = useRouter();
  const today = useRomeToday(initialToday, area === 'magazzino');
  const section = areas[area];
  const kinds: readonly OperationKind[] = section.kinds;
  const linkedId = area === 'magazzino' && typeof requestedVehicle === 'string' && /^[a-f0-9-]{36}$/i.test(requestedVehicle)
    ? requestedVehicle.toLowerCase() : '';
  const [kind, setKind] = useState(linkedId ? 'article' : kinds.find(value => value === requestedKind) ?? kinds[0]);
  const [vehicleFilter, setVehicleFilter] = useState(linkedId);
  const [records, setRecords] = useState(initial);
  const [recordsReady, setRecordsReady] = useState(!identity.demo);
  const [availableSites, setAvailableSites] = useState(sites);
  const [siteFilter, setSiteFilter] = useState(typeof requestedSite === 'string' && /^[a-f0-9-]{36}$/i.test(requestedSite) ? requestedSite : '');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [archive, setArchive] = useState(() => Boolean(linkedId && initial.some(record => record.id === linkedId && record.archived)));
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const focusBack = useRef<HTMLElement | null>(null);
  const selectedHeading = useRef<HTMLHeadingElement>(null);
  const selectedRevealed = useRef(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const inFlight = useRef(false);
  const definition = operationDefinition(kind);
  const AreaIcon = areaIcons[area];
  const warehouseAvailability = useMemo(() => area === 'magazzino' ? getWarehouseAvailability(records) : new Map<string, bigint>(), [area, records]);
  const movementFor = editor && editor !== 'create' && 'movementFor' in editor ? editor.movementFor : '';
  const editingRecord = editor && editor !== 'create' && 'id' in editor ? editor : undefined;
  const trash = useTrashRemoval(identity, { kind: 'operation', onChange(action, id) {
    setNotice(undefined);
    if (identity.demo) {
      setRecords(localOperations(today, area));
    } else {
      if (action === 'delete') setRecords(previous => previous.filter(record => record.id !== id));
      router.refresh();
    }
  } });

  useEffect(() => {
    if (!identity.demo) {
      setRecords(initial);
      setAvailableSites(sites);
      return;
    }
    const sync = () => { setRecords(localOperations(today, area)); setAvailableSites(demoSiteOptions(today, true)); setRecordsReady(true); };
    sync();
    const onStorage = (event: StorageEvent) => {
      if ([operationsKey, demoKey, demoTrashKey, null].includes(event.key)) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [identity.demo, initial, sites, today, area]);

  useEffect(() => {
    if (identity.demo && linkedId && localOperations(today, area).some(record => record.id === linkedId && record.archived))
      setArchive(true);
  }, [identity.demo, linkedId, area, today]);

  useEffect(() => {
    if (identity.demo) return;
    function refreshRecords() {
      if (document.visibilityState === 'visible' && !inFlight.current) router.refresh();
    }
    window.addEventListener('focus', refreshRecords);
    return () => window.removeEventListener('focus', refreshRecords);
  }, [identity.demo, router]);

  function selectKind(value: OperationKind) {
    if (value !== 'article') setVehicleFilter('');
    setKind(value); setStatus(''); setQuery(''); setPage(1); setNotice(undefined);
  }

  function openView(value: Editing) {
    focusBack.current = document.activeElement as HTMLElement;
    setEditor(value);
  }
  function closeView() {
    setEditor(null);
    requestAnimationFrame(() => focusBack.current?.isConnected && focusBack.current.focus());
  }
  function focusNotice() {
    requestAnimationFrame(() => noticeRef.current?.focus());
  }

  async function persist(input: OperationWrite) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice(undefined);
    try {
      const action = validateOperation(input);
      let record: OperationRecord;
      if (identity.demo) {
        if (action.action === 'save') {
          const period = vehicleMaintenance(action);
          if (period && localVehicleAssignments(today).some(assignment => assignment.vehicle_id === action.id
            && assignment.periods.some(booking => periodsOverlap(booking, period)))) {
            throw new Error(maintenanceScheduleError);
          }
        }
        record = updateLocalOperation(today, action);
      } else {
        const response = await fetch('/api/operativita?' + new URLSearchParams({ azienda: identity.org.id }), {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result) throw new Error(result?.error || 'Salvataggio non riuscito. Riprova.');
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
      if (action.action === 'save' && action.kind === kind) {
        setArchive(false);
        setPage(1);
        if (status && status !== effectiveStatus(record, today)) setStatus('');
        if (filterBySite && filterBySite.id !== record.site_id) setSiteFilter('');
        if (vehicleFilter && vehicleFilter !== record.id) setVehicleFilter('');
        if (!matchesSearch(record)) setQuery('');
      }
      setNotice({ text: action.action === 'archive' ? 'Scheda archiviata.' : action.action === 'restore' ? 'Scheda ripristinata.' : 'Scheda salvata.' });
      if (editor) setEditor(null);
      focusNotice();
    } finally { inFlight.current = false; setBusy(false); }
  }

  function toggleArchive(record: OperationRecord) {
    void persist({ action: record.archived ? 'restore' : 'archive', id: record.id, kind: record.kind }).catch(error => {
      setNotice({ text: error instanceof Error ? error.message : 'Operazione non riuscita.', error: true });
      focusNotice();
    });
  }

  const selectedSite = availableSites.find(site => site.id === siteFilter);
  const siteById = new Map(availableSites.map(site => [site.id, site]));
  const needle = query.trim().toLocaleLowerCase('it');
  const filterBySite = definition.site !== 'none' && selectedSite;
  const filterByVehicle = kind === 'article' && vehicleFilter;
  const linkedVehicle = filterByVehicle && records.find(record => record.id === vehicleFilter && record.kind === 'article'
    && record.fields.category === 'vehicles');
  const linkedRecord = requestedRecord && records.find(record => record.id === requestedRecord && record.kind === kind && !record.archived);
  const hasFilters = Boolean(needle || status || filterBySite || filterByVehicle);
  const active = records.filter(record => record.kind === kind && !record.archived).length;
  const archived = records.filter(record => record.kind === kind && record.archived).length;
  function matchesSearch(record: OperationRecord) {
    return !needle || [record.title, ...Object.values(record.fields), siteById.get(record.site_id ?? '')?.name]
      .some(value => value?.toLocaleLowerCase('it').includes(needle));
  }
  const filtered = records.filter(record => record.kind === kind && record.archived === archive
    && (!filterBySite || record.site_id === filterBySite.id) && (!filterByVehicle || linkedVehicle && record.id === linkedVehicle.id)
    && (!status || effectiveStatus(record, today) === status) && matchesSearch(record))
    .sort((first, second) => Number(second.id === requestedRecord) - Number(first.id === requestedRecord)
      || second.updated_at.localeCompare(first.updated_at) || first.title.localeCompare(second.title, 'it'));
  const pageCount = Math.max(1, Math.ceil(filtered.length / numberPerPage));
  const shownPage = Math.min(page, pageCount);
  const shown = filtered.slice((shownPage - 1) * numberPerPage, shownPage * numberPerPage);
  const articles = records.filter(record => record.kind === 'article' && !record.archived)
    .map(record => ({ value: record.id, label: record.title + (record.fields.unit ? ' · ' + record.fields.unit : '') }));
  const needsArticle = kind === 'movement' && !articles.length;
  const selectedVisible = shown.some(record => record.id === requestedRecord);

  useEffect(() => {
    if (!recordsReady || !selectedVisible || selectedRevealed.current || !selectedHeading.current) return;
    selectedRevealed.current = true;
    selectedHeading.current.focus();
  }, [recordsReady, selectedVisible]);

  function openCreate() {
    if (needsArticle) {
      selectKind('article');
      setArchive(false);
    }
    openView('create');
  }

  return <Shell identity={identity} section={area}>
    {selectedSite && <Link className="button text-button back-link" href={orgLink('/cantieri/' + selectedSite.id, identity)}>
      <ArrowLeft size={17}/> {selectedSite.name}</Link>}
    <header className={styles.heading}>
      <div className={styles.headingText}><span className={styles.headingIcon}><AreaIcon size={26}/></span><div>
        <h1>{section.title}</h1><p>{section.description}</p>
      </div></div>
      <div className={styles.recordActions}>
        {area === 'personale' && <Link className="button secondary" href={attendanceHref(identity)}>
          <CalendarCheck size={18} aria-hidden="true"/> Presenze
        </Link>}
        {(area === 'magazzino' || area === 'personale') && <Link className="button secondary" href={orgLink('/gestione/assegnazioni-veicoli', identity)}>
          <Truck size={18}/> Assegnazioni veicoli
        </Link>}
        {kind !== 'estimate' && <button className="button primary" disabled={busy} onClick={openCreate}>
          <Plus size={19}/> Aggiungi {needsArticle ? 'articolo' : definition.singular.toLocaleLowerCase('it')}
        </button>}
      </div>
    </header>

    {kind === 'estimate' && <section className={styles.pdfFeature} aria-labelledby="pdf-feature-heading">
      <div className={styles.pdfFeatureIntro}>
        <span className={styles.pdfFeatureIcon}><FileUp size={27} aria-hidden="true"/></span>
        <div>
          <h2 id="pdf-feature-heading">Preventivi da PDF</h2>
          <p>Importa un computo, applica il listino aziendale e prepara il preventivo per il cantiere.</p>
        </div>
      </div>
      <Link className={`button ${styles.pdfFeatureAction}`} href={orgLink('/gestione/preventivi-computo'
        + (selectedSite ? '?cantiere=' + selectedSite.id : ''), identity)}>
        Apri Preventivi da PDF <ArrowUpRight size={17}/>
      </Link>
    </section>}

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
        <div className={styles.listActions}>
          {kind === 'estimate' && <button className="button primary" disabled={busy} onClick={openCreate}>
            <Plus size={18}/> Aggiungi computo metrico
          </button>}
          <button className="button secondary" aria-pressed={archive} onClick={() => { setArchive(!archive); setPage(1); setNotice(undefined); }}>
            <Archive size={17}/>{archive ? `Attive (${active})` : `Archiviate (${archived})`}</button>
        </div>
      </div>
      <div className={`${styles.filters} ${definition.statuses.length === 1 || definition.site === 'none' ? styles.condensedFilters : ''}`}>
        <label><span>Cerca</span><span className={styles.searchInput}><Search size={17}/><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Cerca nelle schede"/></span></label>
        {definition.statuses.length > 1 && <label><span>Stato</span><select aria-label="Stato" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
          <option value="">Tutti gli stati</option>{definition.statuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>}
        {definition.site !== 'none' && <label><span>Cantiere</span><select value={selectedSite?.id ?? ''} onChange={event => { setSiteFilter(event.target.value); setPage(1); }}>
          <option value="">Tutti i cantieri</option>{availableSites.map(site => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}
        </select></label>}
      </div>
      {linkedVehicle && <div className={styles.linkedVehicle}>
        <span>Veicolo selezionato <strong>{linkedVehicle.title}</strong></span>
        <button type="button" className="button text-button" onClick={() => { setVehicleFilter(''); setPage(1); }}>Mostra tutti gli articoli</button>
      </div>}
      {notice && <p ref={noticeRef} tabIndex={-1} role={notice.error ? 'alert' : 'status'} className={notice.error ? 'form-error' : styles.notice}>{notice.text}</p>}
      {recordsReady && requestedRecord && !linkedRecord && !archive && kind === (requestedKind ?? kinds[0]) &&
        <p role="status" className={styles.linkedVehicle}>La scheda collegata non è più disponibile tra le schede attive.</p>}
      {shown.length > 0 ? <ul className={styles.cards} role="list">{shown.map(record => {
        const Icon = icons[record.kind];
        const site = siteById.get(record.site_id ?? '');
        const siteHref = site && orgLink('/cantieri/' + site.id, identity);
        const available = warehouseAvailability.get(record.id) ?? 0n;
        const low = record.kind === 'article' && isBelowMinimum(record, available);
        const isVehicle = record.kind === 'article' && record.fields.category === 'vehicles';
        const period = vehicleMaintenance(record);
        const maintenanceState = period ? vehicleMaintenanceState(period, today) : null;
        const cardStatus = maintenanceState === 'active' ? 'inactive' : record.status;
        const selected = record.id === requestedRecord;
        const openLabel = record.archived ? 'Apri' : 'Modifica';
        const archiveLabel = record.archived ? 'Ripristina' : 'Archivia';
        const ArchiveIcon = record.archived ? RotateCcw : Archive;
        const contextActions: ContextAction[] = [{ label: openLabel, icon: Pencil, disabled: busy, onSelect: () => openView(record) }];
        if (siteHref) contextActions.push({ label: 'Apri cantiere', icon: HardHat, href: siteHref });
        contextActions.push(
          { label: archiveLabel, icon: ArchiveIcon, disabled: busy, onSelect: () => toggleArchive(record) },
          { label: 'Elimina', icon: Trash2, tone: 'danger', disabled: busy, onSelect: () => trash.request(record.id, record.title) },
        );
        return <ContextActions key={record.id} label={record.title} actions={contextActions}>
          {({ surface, trigger }) => <li {...surface} className={`${styles.record}${selected ? ` ${styles.selectedRecord}` : ''}`}>
            <div className={styles.recordHead}><span className={styles.recordIcon}><Icon size={19}/></span>
              <div className={styles.recordTools}>
                <span className={`${styles.badge} ${maintenanceState === 'active' ? styles.maintenanceBadge : ''}`}>
                  {definition.statuses.find(item => item.value === cardStatus)?.label ?? cardStatus}</span>
                {trigger}
              </div></div>
            <h3 ref={selected ? selectedHeading : undefined} tabIndex={selected ? -1 : undefined}>{record.title}</h3>
            {record.record_date && <time dateTime={record.record_date}>{dateLabel(record.record_date)}</time>}
            {definition.summary?.(record, records).filter(Boolean).map((value, index) => <p key={index} className={styles.summary}>{value}</p>)}
            {record.kind === 'article' && <dl className={styles.stock}>
              <div><dt>{isVehicle ? 'Giacenza' : 'Disponibilità'}</dt><dd>{formatStockQuantity(available)} {record.fields.unit}</dd></div>
              <div><dt>Scorta minima</dt><dd>{formatStockQuantity(stockMinimum(record))} {record.fields.unit}</dd></div>
            </dl>}
            {period && maintenanceState && <div className={`${styles.maintenanceCard} ${styles[maintenanceState]}`}>
              <Wrench size={15} aria-hidden="true"/>
              <div><strong>{maintenanceLabels[maintenanceState]}</strong>
                <span>Dal <time dateTime={period.start_date}>{dateLabel(period.start_date)}</time> al <time dateTime={period.end_date}>{dateLabel(period.end_date)}</time></span>
              </div>
            </div>}
            {low && <span className={styles.low}>Sotto scorta minima</span>}
            {site && siteHref && <Link className={styles.site} href={siteHref}>{site.name}<ArrowUpRight size={14}/></Link>}
            <div className={styles.recordActions}>
              <button className="button secondary" data-context-primary="" disabled={busy}
                onClick={() => openView(record)}><Pencil size={15}/>{openLabel}</button>
              {(record.kind === 'employee' || record.kind === 'worker') &&
                <Link className="button secondary" href={attendanceHref(identity, record.id)} aria-label={`Presenze di ${record.title}`}>
                  <CalendarCheck size={15} aria-hidden="true"/> Presenze
                </Link>}
              {record.kind === 'worker' &&
                <Link className="button secondary" href={workerDeadlinesHref(identity, record.id)} aria-label={`Scadenze di ${record.title}`}>
                  <CalendarClock size={15} aria-hidden="true"/> Scadenze
                </Link>}
              {record.kind === 'article' && !record.archived && <button type="button" className="button secondary" disabled={busy}
                onClick={() => openView({ movementFor: record.id })}><Boxes size={15}/> Carico / scarico</button>}
              {isVehicle && record.status === 'active' && !record.archived &&
                <Link className="button secondary" href={orgLink('/gestione/assegnazioni-veicoli?veicolo=' + record.id, identity)}>
                  <Truck size={15}/> {maintenanceState === 'active' ? 'Assegna per altre date' : 'Assegna'}
                </Link>}
              <button className="button text-button" disabled={busy} onClick={() => toggleArchive(record)}>
                <ArchiveIcon size={15}/>{archiveLabel}</button>
              <button type="button" className={`button text-button ${styles.deleteAction}`} disabled={busy}
                aria-label={`Elimina ${record.title}`} onClick={event => trash.request(record.id, record.title, event.currentTarget)}>
                <Trash2 size={15} aria-hidden="true"/> Elimina</button>
            </div>
          </li>}
        </ContextActions>;
      })}</ul> : <div className={styles.empty}>
        <Package size={29}/>
        <strong>{hasFilters ? 'Nessun risultato' : archive ? 'Nessuna scheda archiviata' : 'Nessuna scheda'}</strong>
        {hasFilters ? <>
          <p>{filterByVehicle && !linkedVehicle ? 'Il veicolo collegato non è disponibile.' : 'Prova senza i filtri attuali.'}</p>
          <button type="button" className="button secondary" onClick={() => {
            setQuery(''); setStatus(''); setSiteFilter(''); setVehicleFilter(''); setPage(1);
          }}>Azzera filtri</button>
        </> : <p>{archive ? 'Le schede archiviate compariranno qui.' : needsArticle
          ? 'Aggiungi un articolo prima di registrare un carico o uno scarico.' : 'Aggiungi la prima scheda per iniziare.'}</p>}
      </div>}
      {pageCount > 1 && <div className={styles.pagination}><span>Pagina {shownPage} di {pageCount}</span>
        <button className="button secondary" disabled={shownPage <= 1} onClick={() => setPage(shownPage - 1)}>Indietro</button>
        <button className="button secondary" disabled={shownPage >= pageCount} onClick={() => setPage(shownPage + 1)}>Avanti</button>
      </div>}
    </section>
    {editor && <OperationEditor key={kind + ':' + (movementFor || editingRecord?.id || 'new')}
      definition={movementFor ? operationDefinition('movement') : definition} record={editingRecord} today={today}
      identity={identity} sites={availableSites} articles={articles} movementFor={movementFor}
      selectedSite={selectedSite?.id ?? ''} onClose={closeView} save={persist}
      onSiteCreated={site => setAvailableSites(previous => [site, ...previous.filter(item => item.id !== site.id)])}/>}
    {trash.feedback}
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
  return <label data-field={field.key}>{field.label}<input type={field.type === 'number' ? 'text' : field.type ?? 'text'}
    inputMode={field.type === 'number' ? (field.decimals ? 'decimal' : 'numeric') : undefined}
    required={field.required} maxLength={field.type === 'number' ? 14 : 2000} value={value}
    placeholder={field.placeholder} onChange={event => change(event.target.value)}/></label>;
}

function OperationEditor({ definition, record, today, identity, sites, articles, movementFor, selectedSite, onClose, save, onSiteCreated }: {
  definition: Definition; record?: OperationRecord; today: string; sites: SiteOption[]; articles: Option[];
  identity: Identity; onSiteCreated: (site: SiteOption) => void;
  movementFor: string; selectedSite: string; onClose: () => void; save: (action: OperationWrite) => Promise<void>;
}) {
  const lineFields = definition.lineFields ?? [];
  const [title, setTitle] = useState(record?.title ?? '');
  const [status, setStatus] = useState(record?.status ?? definition.defaultStatus);
  const [date, setDate] = useState(record?.record_date ?? (definition.dateRequired ? today : ''));
  const [site, setSite] = useState(record ? record.site_id ?? '' : selectedSite);
  const [siteEditor, setSiteEditor] = useState(false);
  const [siteNotice, setSiteNotice] = useState('');
  const siteSelect = useRef<HTMLSelectElement>(null);
  const [fields, setFields] = useState(() => initialValues(definition.fields, record?.fields ?? { article_id: movementFor }));
  const [maintenance, setMaintenance] = useState(() => {
    const period = record ? vehicleMaintenance(record) : null;
    return { enabled: Boolean(period), start_date: period?.start_date ?? '', end_date: period?.end_date ?? '' };
  });
  const [lines, setLines] = useState(() => (record?.lines ?? (lineFields.length ? [{}] : []))
    .map((row, key) => ({ key, fields: initialValues(lineFields, row) })));
  const rowId = useRef(lines.length);
  const descriptionToFocus = useRef<number | null>(null);
  const lineList = useRef<HTMLElement>(null);
  const addLineButton = useRef<HTMLButtonElement>(null);
  const identifier = useRef(record?.id ?? '');
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string } | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const hint = definition.totals?.(fields, lines.map(line => line.fields));
  const readOnly = Boolean(record?.archived);
  const isVehicle = definition.kind === 'article' && fields.category === 'vehicles';
  const attendancePerson = record && (record.kind === 'employee' || record.kind === 'worker') ? record : null;
  const personChanged = attendancePerson && (
    title !== attendancePerson.title || status !== attendancePerson.status || date !== (attendancePerson.record_date ?? '')
    || site !== (attendancePerson.site_id ?? '') || definition.fields.some(field =>
      fields[field.key] !== (attendancePerson.fields[field.key] ?? field.initial ?? ''))
  );

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    const key = descriptionToFocus.current;
    if (key === null) return;
    lineList.current?.querySelector<HTMLInputElement>(`[data-line-key="${key}"] [data-field="description"] input`)?.focus();
    descriptionToFocus.current = null;
  }, [lines]);

  function addLine() {
    const key = rowId.current++;
    descriptionToFocus.current = key;
    setLines(previous => [...previous, { key, fields: initialValues(lineFields) }]);
  }

  function removeLine(key: number, index: number) {
    const remaining = lines.filter(row => row.key !== key);
    descriptionToFocus.current = remaining[Math.min(index, remaining.length - 1)]?.key ?? null;
    setLines(remaining);
    if (!remaining.length) addLineButton.current?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || readOnly) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      identifier.current ||= crypto.randomUUID();
      const savedFields = definition.kind === 'article' ? { ...fields,
        maintenance_from: isVehicle && maintenance.enabled ? maintenance.start_date : '',
        maintenance_to: isVehicle && maintenance.enabled ? maintenance.end_date : '',
      } : fields;
      await save({ action: 'save', id: identifier.current, kind: definition.kind, title, status, site_id: site || null,
        record_date: date || null, fields: savedFields, lines: lines.map(line => line.fields) });
    } catch (failure) {
      setError({ text: failure instanceof Error ? failure.message : 'Salvataggio non riuscito.' });
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
      <div className={attendancePerson ? `drawer-fields ${styles.personDrawerFields}` : 'drawer-fields'}>
        {attendancePerson && <div className={styles.attendanceAction}>
          {personChanged || busy ? <p role="status">Salva o annulla le modifiche per consultare {attendancePerson.kind === 'worker' ? 'presenze e scadenze' : 'le presenze'}.</p>
            : <>
              <Link className="button secondary" href={attendanceHref(identity, attendancePerson.id)}>
                <CalendarCheck size={17} aria-hidden="true"/> Consulta presenze
              </Link>
              {attendancePerson.kind === 'worker' &&
                <Link className={`button secondary ${styles.deadlineLink}`} href={workerDeadlinesHref(identity, attendancePerson.id)}>
                  <CalendarClock size={17} aria-hidden="true"/> Visite, certificazioni e scadenze
                </Link>}
            </>}
        </div>}
        <fieldset className={`form-grid ${styles.editorFields}`} disabled={busy || readOnly}>
          <label>{definition.titleLabel}<input autoFocus maxLength={160} required value={title} onChange={event => setTitle(event.target.value)}/></label>
          <div className={definition.statuses.length > 1 && definition.dateLabel ? 'form-pair' : undefined}>
            {definition.statuses.length > 1 && <label>Stato<select aria-label="Stato" value={status} onChange={event => setStatus(event.target.value)}>
              {definition.statuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
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
          {isVehicle && <section className={styles.maintenanceEditor}>
            <label className={styles.maintenanceToggle}><input type="checkbox" checked={maintenance.enabled} onChange={event => {
              const enabled = event.target.checked;
              setMaintenance(current => ({ enabled, start_date: current.start_date || today, end_date: current.end_date || today }));
            }}/><span>Manutenzione (meccanico)</span></label>
            {maintenance.enabled && <>
              <div className={`form-pair ${styles.maintenanceDates}`}>
                <label>Inizio manutenzione<input type="date" required value={maintenance.start_date}
                  onChange={event => setMaintenance({ ...maintenance, start_date: event.target.value })}/></label>
                <label>Fine manutenzione<input type="date" required min={maintenance.start_date || undefined} value={maintenance.end_date}
                  onChange={event => setMaintenance({ ...maintenance, end_date: event.target.value })}/></label>
              </div>
              <p className={styles.maintenanceHelp}>Il veicolo risulta fuori uso nelle date indicate, estremi inclusi. Dal giorno successivo torna automaticamente allo stato impostato nella scheda.</p>
            </>}
          </section>}
          {lineFields.length > 0 && <section ref={lineList} className={styles.lines} aria-label="Righe">
            <div className={styles.lineHead}><h3>{definition.kind === 'estimate' ? 'Misurazioni' : 'Righe del documento'}</h3>
              {!readOnly && <button ref={addLineButton} className="button secondary" type="button" disabled={lines.length >= 100} onClick={addLine}>
                <Plus size={16}/> Aggiungi riga</button>}</div>
            {lines.map((row, index) => {
              const measured = definition.kind === 'estimate' ? documentLineQuantity('estimate', row.fields) : null;
              return <fieldset key={row.key} data-line-key={row.key} className={styles.line}>
                <legend>Riga {index + 1}</legend>
                <div className={styles.lineFields}>{lineFields.map(field => <InputField key={field.key} field={field} value={row.fields[field.key]}
                  change={value => setLines(previous => previous.map(entry => entry.key === row.key
                    ? { ...entry, fields: { ...entry.fields, [field.key]: value } } : entry))}/>)}</div>
                {measured !== null && <small>Quantità misura {formatQuantity(measured)} {row.fields.unit}</small>}
                {!readOnly && <button type="button" className="button text-button" aria-label={`Rimuovi riga ${index + 1}`}
                  onClick={() => removeLine(row.key, index)}><X size={15}/> Rimuovi</button>}
              </fieldset>;
            })}
            {hint && <dl className={styles.totals} aria-label="Riepilogo calcoli">{hint.map(item =>
              <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>}
          </section>}
        </fieldset>
        {error && <p ref={errorRef} tabIndex={-1} className={`form-error ${styles.editorError}`} role="alert">{error.text}</p>}
      </div>
      <footer className="drawer-footer"><button type="button" disabled={busy} className="button secondary" onClick={onClose}>{readOnly ? 'Torna all’elenco' : 'Annulla'}</button>
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
