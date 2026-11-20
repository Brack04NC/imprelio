'use client';

import { Archive, Download, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type Ref } from 'react';
import { formatDate, romeDate, type Identity } from '@/lib/domain';
import type { EstimatePdfFile } from '@/lib/estimate-pdf-archive';
import { archiveEstimatePdf, downloadDemoEstimatePdf, estimatePdfDownloadUrl, listEstimatePdfs, PdfArchiveError } from '@/lib/estimate-pdf-archive-client';
import type { SiteOption } from '@/lib/operation-types';
import type { TrashAction } from '@/lib/trash';
import { demoTrashKey, isDemoTombstoned } from '@/lib/trash-storage';
import { ContextActions, type ContextAction } from './context-actions';
import { useTrashRemoval } from './trash-removal';
import styles from './estimate-pricing.module.css';

type ArchiveState = 'loading' | 'ready' | 'migration' | 'error';
const archiveMigration = 'https://github.com/Brack04NC/imprelio/blob/main/supabase/migrations/202611180006_archivio_computi_pdf.sql';
const archiveKey = (draft: string, site: string) => draft + ':' + site;
const sizeFormat = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });

export function useEstimatePdfArchive(identity: Identity, scopedSite: string) {
  const [state, setState] = useState<ArchiveState>('loading');
  const [files, setFiles] = useState<EstimatePdfFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const active = useRef(false);
  const ids = useRef(new Map<string, string>());
  const removedIds = useRef(new Set<string>());
  const org = identity.org.id;

  useEffect(() => {
    setState('loading');
    const controller = new AbortController();
    listEstimatePdfs(org, identity.demo, scopedSite, controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      setFiles(rows);
      setState('ready');
    }).catch(error => {
      if (controller.signal.aborted) return;
      setState(error instanceof PdfArchiveError && error.code === 'migration_missing' ? 'migration' : 'error');
    });
    return () => controller.abort();
  }, [identity.demo, org, scopedSite, revision]);

  useEffect(() => {
    if (!identity.demo) return;
    function syncOnStorage(event: StorageEvent) {
      if (event.key === demoTrashKey || event.key === null) setRevision(value => value + 1);
    }
    window.addEventListener('storage', syncOnStorage);
    return () => window.removeEventListener('storage', syncOnStorage);
  }, [identity.demo]);

  async function save(draft: string, site: string, original: File) {
    if (active.current || state !== 'ready' || !site) return;
    const key = archiveKey(draft, site);
    active.current = true;
    setSaving(true);
    setFailure(null);
    try {
      const previousId = ids.current.get(key);
      const removed = previousId && (identity.demo ? isDemoTombstoned('estimate_pdf', previousId) : removedIds.current.has(previousId));
      const id = previousId && !removed ? previousId : crypto.randomUUID();
      ids.current.set(key, id);
      const file = await archiveEstimatePdf(org, identity.demo, id, site, original);
      setFiles(previous => [file, ...previous.filter(item => item.id !== file.id)]);
    } catch (error) {
      setFailure({ key, message: error instanceof Error ? error.message : 'Salvataggio del PDF non riuscito. Riprova.' });
    } finally {
      active.current = false;
      setSaving(false);
    }
  }

  function syncTrash(action: TrashAction['action'], id: string) {
    if (action === 'delete') {
      removedIds.current.add(id);
      setFiles(previous => previous.filter(file => file.id !== id));
    } else {
      removedIds.current.delete(id);
    }
    setRevision(value => value + 1);
  }

  return {
    state, saving, save, syncTrash,
    files: scopedSite ? files.filter(file => file.site_id === scopedSite) : files,
    retry: () => setRevision(value => value + 1),
    original: (draft: string, site: string) => files.find(file => file.id === ids.current.get(archiveKey(draft, site))),
    saveError: (draft: string, site: string) => failure?.key === archiveKey(draft, site) ? failure.message : '',
  };
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? sizeFormat.format(bytes / (1024 * 1024)) + ' MB'
    : sizeFormat.format(Math.max(1, bytes / 1024)) + ' KB';
}

type PdfDownloadProps = {
  identity: Identity; file: EstimatePdfFile; label?: string;
};

function usePdfDownload({ identity, file, label = 'Scarica PDF' }: PdfDownloadProps) {
  const [error, setError] = useState('');
  const accessibleLabel = label + ' ' + file.file_name;
  const action: ContextAction = identity.demo ? { label, icon: Download, onSelect: download } :
    { label, icon: Download, href: estimatePdfDownloadUrl(identity.org.id, file.id) };
  const content = <><Download size={16} aria-hidden="true"/>{label}</>;
  const control = action.href ? <a className="button secondary" href={action.href} aria-label={accessibleLabel}>{content}</a> :
    <button className="button secondary" type="button" aria-label={accessibleLabel} data-context-primary onClick={action.onSelect}>{content}</button>;
  const feedback = error && <p className={`form-error ${styles.downloadError}`} role="alert">{error}</p>;
  return { action, control, feedback };

  function download() {
    setError('');
    void downloadDemoEstimatePdf(file.id).catch(error => setError(error instanceof Error ? error.message : 'Download del PDF non riuscito. Riprova.'));
  }
}

export function DownloadEstimatePdf(props: PdfDownloadProps) {
  const { control, feedback } = usePdfDownload(props);
  return <>{control}{feedback}</>;
}

function ArchivedPdfRow({ identity, file, site, selectedName, deletingDisabled, onDelete }: {
  identity: Identity; file: EstimatePdfFile; site?: SiteOption; selectedName?: Ref<HTMLElement>;
  deletingDisabled: boolean; onDelete: (trigger?: HTMLElement) => void;
}) {
  const { action, control, feedback } = usePdfDownload({ identity, file });
  const date = formatDate(romeDate(new Date(file.uploaded_at)), { day: 'numeric', month: 'short', year: 'numeric' });
  const actions: ContextAction[] = [action, {
    label: 'Elimina PDF', icon: Trash2, tone: 'danger', disabled: deletingDisabled, onSelect: () => onDelete(),
  }];
  return <ContextActions label={'PDF ' + file.file_name} actions={actions}>
    {({ surface, trigger }) => <li {...surface} className={selectedName ? styles.selectedPdf : undefined}>
      <div><strong ref={selectedName} tabIndex={selectedName ? -1 : undefined}>{file.file_name}</strong>
        <small>{[site?.name, site?.client, formatSize(file.size_bytes), date].filter(Boolean).join(' · ')}</small></div>
      <div className={styles.entryActions}>
        {control}
        <button type="button" className="button text-button" disabled={deletingDisabled} aria-haspopup="dialog"
          aria-label={'Elimina PDF ' + file.file_name} onClick={event => onDelete(event.currentTarget)}>
          <Trash2 size={16} aria-hidden="true"/> Elimina
        </button>
        {trigger}
      </div>
      {feedback}
    </li>}
  </ContextActions>;
}

export function EstimatePdfArchive({ identity, archive, sites, requestedPdf }: {
  identity: Identity; archive: ReturnType<typeof useEstimatePdfArchive>; sites: SiteOption[]; requestedPdf?: string;
}) {
  const [page, setPage] = useState<number | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const heading = useRef<HTMLElement>(null);
  const selectedName = useRef<HTMLElement>(null);
  const selectedRevealed = useRef(false);
  const size = 12;
  const pages = Math.max(1, Math.ceil(archive.files.length / size));
  const selectedIndex = archive.files.findIndex(file => file.id === requestedPdf);
  const targetPage = Math.max(1, Math.floor(selectedIndex / size) + 1);
  const current = Math.min(page ?? targetPage, pages);
  const trash = useTrashRemoval(identity, { kind: 'estimate_pdf', onChange(action, id) {
    archive.syncTrash(action, id);
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) heading.current?.focus();
    });
  } });

  useEffect(() => {
    selectedRevealed.current = false;
    function openFromLink() {
      if (!details.current || (!requestedPdf && window.location.hash !== '#archivio-pdf')) return;
      details.current.open = true;
      heading.current?.focus();
    }
    openFromLink();
    window.addEventListener('hashchange', openFromLink);
    return () => window.removeEventListener('hashchange', openFromLink);
  }, [requestedPdf]);

  useEffect(() => {
    if (archive.state !== 'ready' || !details.current?.open || !selectedName.current || selectedRevealed.current) return;
    selectedRevealed.current = true;
    selectedName.current.focus();
  }, [archive.state, selectedIndex, current]);

  return <><details id="archivio-pdf" ref={details} className={`panel ${styles.details}`}>
    <summary ref={heading}><Archive size={18} aria-hidden="true"/> Archivio computi PDF
      {archive.state === 'ready' && <span>{archive.files.length} PDF</span>}
    </summary>
    <div className={styles.panelContent}>
      {archive.state === 'loading' && <p role="status">Caricamento archivio…</p>}
      {archive.state === 'migration' && <p>Per attivare l’archivio PDF, esegui la <a className={styles.inlineLink} href={archiveMigration}>migrazione 006</a> in Supabase.</p>}
      {archive.state === 'error' && <>
        <p role="alert">Impossibile caricare l’archivio PDF.</p>
        <button className="button secondary" onClick={archive.retry}>Riprova</button>
      </>}
      {archive.state === 'ready' && <>
        {requestedPdf && selectedIndex < 0 && <p role="status">Il PDF collegato non è più disponibile.</p>}
        {identity.demo && <p>I PDF salvati nella demo restano in questo browser.</p>}
        {!archive.files.length && <p>Importa un computo, seleziona il cantiere e salva il PDF originale.</p>}
        <ul className={styles.entries} role="list">
          {archive.files.slice((current - 1) * size, current * size).map(file => <ArchivedPdfRow key={file.id} identity={identity} file={file}
            site={sites.find(option => option.id === file.site_id)} selectedName={file.id === requestedPdf ? selectedName : undefined}
            deletingDisabled={archive.saving} onDelete={trigger => trash.request(file.id, file.file_name, trigger)}/>)}
        </ul>
        {pages > 1 && <div className={styles.historyPages}>
          <button className="button secondary" disabled={current === 1} onClick={() => setPage(current - 1)}>Precedenti</button>
          <button className="button secondary" disabled={current === pages} onClick={() => setPage(current + 1)}>Successivi</button>
        </div>}
      </>}
    </div>
  </details>{trash.feedback}</>;
}
