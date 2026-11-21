'use client';

import { StatusToast } from './feedback-toast';
import { ArrowUpRight, ChevronLeft, ChevronRight, FileImage, FileText, FolderOpen, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { blankDocumentFields, documentExtractionSchema, documentFieldLimits, documentKindLabels, documentKinds,
  documentMaxBytes, documentMimeForName, type DocumentEntry, type DocumentExtraction, type DocumentFields,
  type DocumentKind } from '@/lib/document-intake';
import { DocumentIntakeError, documentIntakeChangeEvent, documentIntakeSyncKey, documentOpenHref, listDocuments,
  readDemoDocument, saveImportedDocument } from '@/lib/document-intake-client';
import { demoKey } from '@/lib/demo';
import { formatDate, romeDate, type Identity } from '@/lib/domain';
import type { SiteOption } from '@/lib/operation-types';
import { demoSiteOptions } from '@/lib/operations-demo';
import { demoTrashKey } from '@/lib/trash-storage';
import type { TrashAction } from '@/lib/trash';
import { Drawer } from './editor';
import { ContextActions, type ContextAction } from './context-actions';
import { Shell } from './shell';
import { useTrashRemoval } from './trash-removal';
import styles from './document-intake.module.css';

const acceptedFiles = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';
const sizeFormat = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
const amountFormat = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormat = { day: '2-digit', month: 'short', year: 'numeric' } as const;
const rowsPerPage = 12;
const migrationNotice = 'Per attivare l’archivio applica la migrazione 017 in Supabase.';
const statusLabels: Record<DocumentExtraction['status'], string> = {
  extracted: 'Dati estratti', review: 'Da verificare', unreadable: 'Nessun dato rilevato',
};

type Draft = {
  id: string;
  file: File;
  site: string;
  extraction: DocumentExtraction | null;
};

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${sizeFormat.format(bytes / (1024 * 1024))} MB`
    : `${sizeFormat.format(Math.max(1, bytes / 1024))} KB`;
}

function formatTotal(fields: DocumentFields) {
  const total = Number(fields.total);
  if (!fields.total || !Number.isFinite(total)) return '';
  return [amountFormat.format(total), fields.currency].filter(Boolean).join(' ');
}

function documentTitle(entry: DocumentEntry) {
  return entry.extraction.fields.title || entry.file_name;
}

function DocumentIcon({ pdf, size = 19 }: { pdf: boolean; size?: number }) {
  return pdf ? <FileText size={size} aria-hidden="true"/> : <FileImage size={size} aria-hidden="true"/>;
}

function ExtractedStatus({ status }: { status: DocumentExtraction['status'] }) {
  return <span className={styles.status} data-status={status}>{statusLabels[status]}</span>;
}

function OpenOriginal({ entry, identity, controlRef }: { entry: DocumentEntry; identity: Identity;
  controlRef?: (element: HTMLAnchorElement | HTMLButtonElement | null) => void;
}) {
  const [error, setError] = useState('');
  const label = `Apri file ${entry.file_name}`;
  const content = <><DocumentIcon pdf={entry.mime_type === 'application/pdf'}/><span>Apri file</span><ArrowUpRight className={styles.external} size={14} aria-hidden="true"/></>;
  function open(event: MouseEvent<HTMLButtonElement>) {
    if (event.detail > 1) return;
    const tab = window.open('about:blank', '_blank');
    if (!tab) { setError('Consenti le finestre popup per aprire il file.'); return; }
    tab.opener = null;
    setError('');
    void readDemoDocument(entry).then(file => {
      const url = URL.createObjectURL(new Blob([file], { type: entry.mime_type }));
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
      tab.location.replace(url);
    }).catch(failure => {
      tab.close();
      setError(failure instanceof Error ? failure.message : 'Il file originale non è disponibile.');
    });
  }

  return <div className={styles.openOriginal}>
    {identity.demo ? <button ref={controlRef} type="button" className={`button secondary ${styles.openFile}`} aria-label={label} onClick={open}>{content}</button>
      : <a ref={controlRef} className={`button secondary ${styles.openFile}`} href={documentOpenHref(identity.org.id, entry)} target="_blank"
        rel="noopener noreferrer" aria-label={label} onClick={event => { if (event.detail > 1) event.preventDefault(); }}>{content}</a>}
    {error && <p className={styles.fileError} role="alert">{error}</p>}
  </div>;
}

function DocumentRow({ entry, identity, site, showDetails, remove }: { entry: DocumentEntry; identity: Identity; site?: SiteOption;
  showDetails: (entry: DocumentEntry, trigger: HTMLElement | null) => void;
  remove: (entry: DocumentEntry, trigger: HTMLElement | null) => void;
}) {
  const original = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null);
  const activeTrigger = () => document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const actions: ContextAction[] = [
    { label: 'Dati del documento', icon: FileText, onSelect: () => showDetails(entry, activeTrigger()) },
    { label: 'Apri file originale', icon: ArrowUpRight, onSelect: () => original.current?.click() },
    { label: 'Elimina documento', icon: Trash2, tone: 'danger', onSelect: () => remove(entry, activeTrigger()) },
  ];
  const { fields, status } = entry.extraction;
  const subtitle = [fields.number && `N. ${fields.number}`, site?.name, fields.title !== entry.file_name && fields.title && entry.file_name]
    .filter(Boolean).join(' · ');
  return <ContextActions label={documentTitle(entry)} actions={actions} compact>{({ surface, trigger }) => <li {...surface} className={styles.row}>
    <div className={styles.documentCell}>
      <div className={styles.tags}><span className={styles.category}>{documentKindLabels[entry.kind]}</span><ExtractedStatus status={status}/></div>
      <button type="button" data-context-primary="" className={styles.documentName} aria-haspopup="dialog" onClick={event => showDetails(entry, event.currentTarget)}>
        {documentTitle(entry)}<ChevronRight size={16} aria-hidden="true"/>
      </button>
      {subtitle && <small>{subtitle}</small>}
    </div>
    <div className={styles.parties}>
      <span className={styles.cellLabel}>Emittente</span><span>{fields.issuer || '—'}</span>
      {fields.recipient && <small>Per {fields.recipient}</small>}
    </div>
    <div className={styles.dateCell}>
      <span className={styles.cellLabel}>Data</span>
      {fields.date ? <time dateTime={fields.date}>{formatDate(fields.date, dateFormat)}</time> : '—'}
    </div>
    <div className={styles.totalCell}><span className={styles.cellLabel}>Totale</span><strong>{formatTotal(fields) || '—'}</strong></div>
    <div className={styles.rowActions}>
      <OpenOriginal identity={identity} entry={entry} controlRef={element => { original.current = element; }}/>
      <button type="button" className={`icon-button ${styles.remove}`} aria-label={`Elimina ${entry.file_name}`}
        title="Elimina" aria-haspopup="dialog" onClick={event => remove(entry, event.currentTarget)}>
        <Trash2 size={17} aria-hidden="true"/>
      </button>
      {trigger}
    </div>
  </li>}</ContextActions>;
}

function DocumentDetails({ entry, identity, site, onClose }: { entry: DocumentEntry; identity: Identity; site?: SiteOption; onClose: () => void }) {
  const { fields, status } = entry.extraction;
  const values = [
    ['Tipo di documento', documentKindLabels[entry.kind]], ['Numero', fields.number], ['Data documento', fields.date && formatDate(fields.date, dateFormat)],
    ['Emittente', fields.issuer], ['Destinatario', fields.recipient], ['Totale', formatTotal(fields)], ['Valuta', fields.currency],
    ['Cantiere', site?.name ?? (entry.site_id ? 'Cantiere non disponibile' : '')],
    ['Importato il', formatDate(romeDate(new Date(entry.created_at)), dateFormat)],
  ];
  return <Drawer title="Dati del documento" onClose={onClose}>
    <div className={`drawer-fields ${styles.details}`}>
      <div className={styles.detailsTitle}><ExtractedStatus status={status}/><h3>{documentTitle(entry)}</h3></div>
      <dl className={styles.facts}>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
      <div className={styles.attachment}>
        <span className={styles.attachmentIcon}><DocumentIcon pdf={entry.mime_type === 'application/pdf'}/></span>
        <div><strong>{entry.file_name}</strong><small>{formatSize(entry.size_bytes)}</small></div>
        <OpenOriginal identity={identity} entry={entry}/>
      </div>
      <details className={styles.transcript}>
        <summary>Testo riconosciuto</summary>
        <p>{fields.text || 'Nessun testo disponibile.'}</p>
      </details>
    </div>
    <footer className="drawer-footer"><button type="button" className="button secondary" onClick={onClose}>Chiudi dettagli</button></footer>
  </Drawer>;
}

export function DocumentIntake({ identity, sites, initialKind, initialSite, initialImport = false }: {
  identity: Identity; sites: SiteOption[]; initialKind?: DocumentKind; initialSite?: string; initialImport?: boolean;
}) {
  const [entries, setEntries] = useState<DocumentEntry[]>([]);
  const [siteOptions, setSiteOptions] = useState(sites);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [canImport, setCanImport] = useState(identity.demo);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [kindFilter, setKindFilter] = useState<DocumentKind | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(identity.demo && initialImport);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detail, setDetail] = useState<DocumentEntry | null>(null);
  const [progress, setProgress] = useState('');
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState('');
  const extractionController = useRef<AbortController | null>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const detailsTrigger = useRef<HTMLElement | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  const pendingImport = useRef(initialImport && !identity.demo);
  const org = identity.org.id;
  const demo = identity.demo;
  const importedTrash = useTrashRemoval(identity, { kind: 'document_import', onChange(action, id) { syncTrash('intake', action, id); } });
  const estimateTrash = useTrashRemoval(identity, { kind: 'estimate_pdf', onChange(action, id) { syncTrash('estimate-pdf', action, id); } });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void listDocuments(identity, controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      setEntries(rows);
      setListError('');
      setEditorError(previous => previous === migrationNotice ? '' : previous);
      setLoading(false);
      setCanImport(true);
      if (pendingImport.current) {
        pendingImport.current = false;
        setEditorOpen(true);
      }
    }).catch(failure => {
      if (controller.signal.aborted) return;
      if (failure instanceof DocumentIntakeError && failure.code === 'migration_missing') {
        setCanImport(false);
        setListError(migrationNotice);
        extractionController.current?.abort();
        setProgress('');
        setEditorError(migrationNotice);
      } else setListError('Impossibile caricare l’archivio.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [identity, revision]);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    function sync(event: StorageEvent) {
      if (event.key === null || event.key === documentIntakeSyncKey || (demo && event.key === demoTrashKey)) refresh();
      if (demo && (event.key === null || event.key === demoKey || event.key === demoTrashKey)) readDemoSites();
    }
    function readDemoSites() {
      try { setSiteOptions(demoSiteOptions(romeDate(), true)); }
      catch { setSiteOptions(sites); }
    }
    if (demo) readDemoSites();
    else setSiteOptions(sites);
    window.addEventListener(documentIntakeChangeEvent, refresh);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(documentIntakeChangeEvent, refresh);
      window.removeEventListener('storage', sync);
    };
  }, [demo, sites]);

  useEffect(() => () => extractionController.current?.abort(), [demo, org]);

  const siteById = new Map(siteOptions.map(site => [site.id, site]));
  const query = search.trim().toLocaleLowerCase('it');
  const filtered = entries.filter(entry => {
    if (kindFilter && entry.kind !== kindFilter) return false;
    const { fields } = entry.extraction;
    return !query || [entry.file_name, fields.title, fields.number, fields.issuer, fields.recipient,
      entry.site_id && siteById.get(entry.site_id)?.name].some(value => value?.toLocaleLowerCase('it').includes(query));
  });
  const pages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const current = Math.min(page, pages);

  function syncTrash(source: DocumentEntry['source'], action: TrashAction['action'], id: string) {
    if (action === 'delete') setEntries(previous => previous.filter(entry => entry.source !== source || entry.id !== id));
    setRevision(value => value + 1);
    requestAnimationFrame(() => { if (document.activeElement === document.body) listHeading.current?.focus(); });
  }

  function remove(entry: DocumentEntry, trigger: HTMLElement | null) {
    const trash = entry.source === 'estimate-pdf' ? estimateTrash : importedTrash;
    trash.request(entry.id, entry.file_name, trigger);
  }

  async function selectFile(file: File) {
    if (!canImport || inFlight.current) return;
    if (!documentMimeForName(file.name) || !file.size || file.size > documentMaxBytes) {
      setEditorError('Scegli un PDF o una foto JPG, PNG o WebP fino a 25 MB.');
      return;
    }
    extractionController.current?.abort();
    const controller = new AbortController();
    extractionController.current = controller;
    const id = crypto.randomUUID();
    const site = draft?.site ?? (initialSite && siteById.has(initialSite) ? initialSite : '');
    setNotice('');
    setEditorError('');
    setProgress('Preparazione del file…');
    setDraft({ id, file, site, extraction: null });
    let extraction: DocumentExtraction;
    try {
      const { extractDocument } = await import('@/lib/document-extraction');
      extraction = await extractDocument(file, message => { if (!controller.signal.aborted) setProgress(message); }, controller.signal);
    } catch {
      if (controller.signal.aborted) return;
      extraction = { kind: 'other', fields: blankDocumentFields(), status: 'unreadable' };
    }
    if (controller.signal.aborted) return;
    setProgress('');
    setDraft(previous => previous?.id === id ? { ...previous, extraction: { ...extraction, kind: initialKind ?? extraction.kind } } : previous);
  }

  function closeEditor(target: 'upload' | 'archive' = 'upload') {
    extractionController.current?.abort();
    setEditorOpen(false);
    setDraft(null);
    setProgress('');
    setEditorError('');
    requestAnimationFrame(() => (target === 'upload' && !uploadButton.current?.disabled ? uploadButton.current : listHeading.current)?.focus());
  }

  function changeField(key: keyof DocumentFields, value: string) {
    setDraft(previous => previous?.extraction ? { ...previous,
      extraction: { ...previous.extraction, fields: { ...previous.extraction.fields, [key]: value } },
    } : previous);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canImport || inFlight.current || !draft?.extraction) return;
    const parsed = documentExtractionSchema.safeParse(draft.extraction);
    if (!parsed.success) { setEditorError('Controlla data, importo e valuta del documento.'); return; }
    const extraction = parsed.data;
    inFlight.current = true;
    setSaving(true);
    setEditorError('');
    try {
      const entry = await saveImportedDocument(identity,
        { id: draft.id, file: draft.file, kind: extraction.kind, site_id: draft.site || null, extraction });
      setEntries(previous => [entry, ...previous.filter(item => item.id !== entry.id || item.source !== entry.source)]);
      setSearch(''); setKindFilter(''); setPage(1);
      setNotice('Documento e originale salvati.');
      closeEditor('archive');
    } catch (failure) {
      if (failure instanceof DocumentIntakeError && failure.code === 'migration_missing') {
        setCanImport(false);
        setListError(migrationNotice);
        setEditorError(migrationNotice);
      } else setEditorError(failure instanceof Error ? failure.message : 'Salvataggio non riuscito. Riprova.');
    } finally { setSaving(false); inFlight.current = false; }
  }

  const fields = draft?.extraction?.fields;
  return <Shell identity={identity} section="archivio-documenti">
    <header className={styles.pageHeading}><h1>Archivio documenti</h1></header>
    <section className={`panel ${styles.importPanel}`} aria-labelledby="import-document-heading">
      <span className={styles.importIcon}><Upload size={25} aria-hidden="true"/></span>
      <div className={styles.importCopy}><h2 id="import-document-heading">Importa un documento</h2>
        <p>Carica una fattura, un preventivo, un computo metrico o un altro documento. Puoi verificare i dati estratti prima di salvarli con l’originale.</p>
      </div>
      <button className="button primary" type="button" ref={uploadButton} aria-haspopup="dialog" disabled={!canImport} onClick={() => setEditorOpen(true)}>
        <Upload size={17} aria-hidden="true"/> Importa documento
      </button>
    </section>
    <StatusToast text={notice} onClose={() => setNotice('')}/>
    <section className="panel" aria-labelledby="document-list-heading">
      <header className="panel-header"><div><h2 id="document-list-heading" ref={listHeading} tabIndex={-1}>Documenti salvati</h2>
        {!loading && !listError && <p>{entries.length} {entries.length === 1 ? 'documento' : 'documenti'}</p>}
      </div></header>
      {entries.length > 0 && <div className={styles.filters}>
        <label className="search-field"><Search size={17} aria-hidden="true"/><span className="sr-only">Cerca documenti</span>
          <input type="search" placeholder="Cerca per nome, numero o cantiere" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }}/>
        </label>
        <label className={`filter-field ${styles.kindFilter}`}><span className="sr-only">Filtra per tipo</span><select value={kindFilter}
          onChange={event => { setKindFilter(event.target.value as DocumentKind | ''); setPage(1); }}>
          <option value="">Tutti i tipi</option>
          {documentKinds.map(kind => <option key={kind} value={kind}>{documentKindLabels[kind]}</option>)}
        </select></label>
      </div>}
      {listError ? <div className={styles.listState}><p role="alert">{listError}</p>
        <button className="button secondary" type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Riprova</button></div>
        : loading && !entries.length ? <p className={styles.listState} role="status">Caricamento documenti…</p>
          : !filtered.length ? <div className={styles.emptyState}><FolderOpen size={25} aria-hidden="true"/>
            <strong>{entries.length ? 'Nessun risultato' : 'Nessun documento salvato'}</strong>
            <p>{entries.length ? 'Modifica la ricerca o il tipo di documento.' : 'Importa un file per aggiungere la prima riga all’archivio.'}</p></div> : null}
      {filtered.length > 0 && <>
        <div className={styles.columnHeadings} aria-hidden="true"><span>Documento</span><span>Emittente</span><span>Data</span><span>Totale</span><span>Originale</span></div>
        <ul className={styles.rows} role="list">
          {filtered.slice((current - 1) * rowsPerPage, current * rowsPerPage).map(entry => <DocumentRow key={`${entry.source}:${entry.id}`}
            entry={entry} identity={identity} site={entry.site_id ? siteById.get(entry.site_id) : undefined} remove={remove}
            showDetails={(next, trigger) => { detailsTrigger.current = trigger; setDetail(next); }}/>)}</ul>
        {pages > 1 && <footer className={styles.pagination} aria-label="Paginazione documenti">
          <button type="button" className="button secondary" disabled={current === 1} onClick={() => setPage(current - 1)}>
            <ChevronLeft size={15} aria-hidden="true"/> Precedenti</button>
          <span aria-live="polite">Pagina {current} di {pages}</span>
          <button type="button" className="button secondary" disabled={current === pages} onClick={() => setPage(current + 1)}>
            Successivi <ChevronRight size={15} aria-hidden="true"/></button>
        </footer>}
      </>}
    </section>
    {editorOpen && <Drawer title="Importa documento" busy={saving} onClose={() => closeEditor()}>
      <form className="editor-form" onSubmit={submit}>
        <fieldset className="form-grid drawer-fields" disabled={saving}>
          <div className={styles.filePicker}>
            <label><input className="sr-only" type="file" autoFocus={!draft} disabled={!canImport} accept={acceptedFiles} aria-describedby="document-format-hint"
              onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void selectFile(file); }}/>
              <span className="button secondary"><Upload size={16} aria-hidden="true"/>{draft ? 'Cambia file' : 'Scegli un file'}</span></label>
            <p id="document-format-hint">PDF, JPG, PNG o WebP fino a 25 MB.</p>
          </div>
          {draft && <div className={styles.attachment}>
            <span className={styles.attachmentIcon}><DocumentIcon pdf={documentMimeForName(draft.file.name) === 'application/pdf'}/></span>
            <div><strong>{draft.file.name}</strong><small>{formatSize(draft.file.size)}</small></div>
          </div>}
          {progress && <p className={styles.progress} role="status"><span aria-hidden="true"/>{progress}</p>}
          {fields && draft?.extraction && <>
            <div className={styles.extractionHint}><ExtractedStatus status={draft.extraction.status}/>
              <p>{draft.extraction.status === 'unreadable' ? 'Puoi inserire i dati a mano e salvare comunque il file originale.' : 'Verifica i dati e completa i campi mancanti.'}</p>
            </div>
            <label>Tipo di documento<select value={draft.extraction.kind} onChange={event => {
              const kind = event.currentTarget.value as DocumentKind;
              setDraft(previous => previous?.extraction ? { ...previous, extraction: { ...previous.extraction, kind } } : previous);
            }}>{documentKinds.map(kind => <option key={kind} value={kind}>{documentKindLabels[kind]}</option>)}</select></label>
            <label>Titolo<input value={fields.title} maxLength={documentFieldLimits.title} onChange={event => changeField('title', event.target.value)}/></label>
            <div className="form-pair">
              <label>Numero<input value={fields.number} maxLength={documentFieldLimits.number} onChange={event => changeField('number', event.target.value)}/></label>
              <label>Data documento<input type="date" value={fields.date} onChange={event => changeField('date', event.target.value)}/></label>
            </div>
            <label>Emittente<input value={fields.issuer} maxLength={documentFieldLimits.issuer} onChange={event => changeField('issuer', event.target.value)}/></label>
            <label>Destinatario<input value={fields.recipient} maxLength={documentFieldLimits.recipient} onChange={event => changeField('recipient', event.target.value)}/></label>
            <div className="form-pair">
              <label>Totale<input inputMode="decimal" value={fields.total} placeholder="0,00" onChange={event => changeField('total', event.target.value)}/></label>
              <label>Valuta<input value={fields.currency} maxLength={3} placeholder="EUR" onChange={event => changeField('currency', event.target.value)}/></label>
            </div>
            <label>Cantiere<select value={draft.site} onChange={event => {
              const site = event.currentTarget.value;
              setDraft(previous => previous ? { ...previous, site } : previous);
            }}><option value="">Nessun cantiere</option>
              {siteOptions.map(site => <option value={site.id} key={site.id}>{[site.name, site.city].filter(Boolean).join(' · ')}</option>)}
            </select></label>
            <details className={styles.transcript}><summary>Testo riconosciuto</summary>
              <label>Testo<textarea value={fields.text} rows={7} maxLength={documentFieldLimits.text} onChange={event => changeField('text', event.target.value)}/></label>
            </details>
          </>}
          {editorError && <p role="alert" className="form-error">{editorError}</p>}
        </fieldset>
        <footer className={`drawer-footer ${styles.editorFooter}`}>
          <button className="button secondary" type="button" disabled={saving} onClick={() => closeEditor()}>Annulla</button>
          <button className="button primary" type="submit" disabled={!canImport || saving || !draft?.extraction}>{saving ? 'Salvataggio…' : 'Salva documento'}</button>
        </footer>
      </form>
    </Drawer>}
    {detail && <DocumentDetails entry={detail} identity={identity} site={detail.site_id ? siteById.get(detail.site_id) : undefined} onClose={() => {
      setDetail(null);
      requestAnimationFrame(() => (detailsTrigger.current?.isConnected ? detailsTrigger.current : listHeading.current)?.focus());
    }}/>}
    {importedTrash.feedback}
    {estimateTrash.feedback}
  </Shell>;
}
