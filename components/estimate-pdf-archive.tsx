'use client';

import { Archive, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatDate, romeDate, type Identity } from '@/lib/domain';
import type { EstimatePdfFile } from '@/lib/estimate-pdf-archive';
import { archiveEstimatePdf, downloadDemoEstimatePdf, estimatePdfDownloadUrl, listEstimatePdfs, PdfArchiveError } from '@/lib/estimate-pdf-archive-client';
import type { SiteOption } from '@/lib/operation-types';
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

  async function save(draft: string, site: string, original: File) {
    if (active.current || state !== 'ready' || !site) return;
    const key = archiveKey(draft, site);
    const id = ids.current.get(key) ?? crypto.randomUUID();
    ids.current.set(key, id);
    active.current = true;
    setSaving(true);
    setFailure(null);
    try {
      const file = await archiveEstimatePdf(org, identity.demo, id, site, original);
      setFiles(previous => [file, ...previous.filter(item => item.id !== file.id)]);
    } catch (error) {
      setFailure({ key, message: error instanceof Error ? error.message : 'Salvataggio del PDF non riuscito. Riprova.' });
    } finally {
      active.current = false;
      setSaving(false);
    }
  }

  return {
    state, saving, save,
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

export function DownloadEstimatePdf({ identity, file, label = 'Scarica PDF' }: {
  identity: Identity; file: EstimatePdfFile; label?: string;
}) {
  const [error, setError] = useState('');
  const accessibleLabel = label + ' ' + file.file_name;
  if (!identity.demo) return <a className="button secondary" href={estimatePdfDownloadUrl(identity.org.id, file.id)} aria-label={accessibleLabel}>
    <Download size={16} aria-hidden="true"/>{label}
  </a>;
  return <>
    <button className="button secondary" type="button" aria-label={accessibleLabel} onClick={() => {
      setError('');
      void downloadDemoEstimatePdf(file.id).catch(failure => setError(failure.message));
    }}><Download size={16} aria-hidden="true"/>{label}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}

export function EstimatePdfArchive({ identity, archive, sites }: {
  identity: Identity; archive: ReturnType<typeof useEstimatePdfArchive>; sites: SiteOption[];
}) {
  const [page, setPage] = useState(1);
  const size = 12;
  const pages = Math.max(1, Math.ceil(archive.files.length / size));
  const current = Math.min(page, pages);
  return <details className={`panel ${styles.details}`}>
    <summary><Archive size={18} aria-hidden="true"/> Archivio computi PDF
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
        {identity.demo && <p>I PDF salvati nella demo restano in questo browser.</p>}
        {!archive.files.length && <p>Importa un computo, seleziona il cantiere e salva il PDF originale.</p>}
        <ul className={styles.entries}>
          {archive.files.slice((current - 1) * size, current * size).map(file => {
            const site = sites.find(option => option.id === file.site_id);
            const date = formatDate(romeDate(new Date(file.uploaded_at)), { day: 'numeric', month: 'short', year: 'numeric' });
            return <li key={file.id}>
              <div><strong>{file.file_name}</strong>
                <small>{[site?.name, site?.client, formatSize(file.size_bytes), date].filter(Boolean).join(' · ')}</small>
              </div>
              <DownloadEstimatePdf identity={identity} file={file}/>
            </li>;
          })}
        </ul>
        {pages > 1 && <div className={styles.historyPages}>
          <button className="button secondary" disabled={current === 1} onClick={() => setPage(current - 1)}>Precedenti</button>
          <button className="button secondary" disabled={current === pages} onClick={() => setPage(current + 1)}>Successivi</button>
        </div>}
      </>}
    </div>
  </details>;
}
