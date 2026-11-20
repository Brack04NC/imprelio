'use client';

import { estimatePdfFileName, type EstimatePdfFile } from './estimate-pdf-archive.ts';
import { demoTombstoneIds, isDemoTombstoned } from './trash-storage.ts';

type StoredPdf = EstimatePdfFile & { blob: Blob };
type UploadPreparation = { file: EstimatePdfFile } | { uploadUrl: string };

export class PdfArchiveError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

function archiveUrl(organization: string, params?: Record<string, string>) {
  return '/api/computi-pdf?' + new URLSearchParams({ azienda: organization, ...params });
}

export function estimatePdfDownloadUrl(organization: string, id: string) {
  return archiveUrl(organization, { id });
}

async function archiveRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new PdfArchiveError(result?.error ?? 'Archivio PDF temporaneamente non disponibile.', result?.code);
  return result as T;
}

function archiveWrite<T>(organization: string, action: object) {
  return archiveRequest<T>(archiveUrl(organization), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
  });
}

function localArchive<T>(mode: IDBTransactionMode, run: (files: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const open = indexedDB.open('imprelio-computi-pdf-v1', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files', { keyPath: 'id' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction('files', mode);
      const request = run(transaction.objectStore('files'));
      transaction.oncomplete = () => { database.close(); resolve(request.result); };
      transaction.onabort = () => { database.close(); reject(transaction.error ?? request.error); };
    };
  });
}

export async function listEstimatePdfs(organization: string, demo: boolean, site: string, signal: AbortSignal) {
  if (demo) {
    const items = await localArchive<StoredPdf[]>('readonly', files => files.getAll());
    const trash = demoTombstoneIds('estimate_pdf');
    return items.filter(file => (!site || file.site_id === site) && !trash.has(file.id)).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
      .map(({ blob: _, ...file }) => file);
  }
  const { files } = await archiveRequest<{ files: EstimatePdfFile[] }>(archiveUrl(organization, site ? { cantiere: site } : {}), { signal });
  return files;
}

export async function archiveEstimatePdf(organization: string, demo: boolean, id: string, site: string, original: File) {
  const file_name = estimatePdfFileName(original.name);
  const metadata = { id, site_id: site, file_name, size_bytes: original.size };
  if (demo) {
    if (isDemoTombstoned('estimate_pdf', id)) throw new Error('Il PDF è nel cestino. Ripristinalo prima di salvarlo.');
    if (isDemoTombstoned('site', site)) throw new Error('Il cantiere non è disponibile.');
    const now = new Date().toISOString();
    const file = { ...metadata, created_at: now, uploaded_at: now };
    await localArchive('readwrite', files => files.put({ ...file, blob: original }));
    return file;
  }
  const preparation = await archiveWrite<UploadPreparation>(organization, { action: 'prepare', ...metadata });
  if ('file' in preparation) return preparation.file;

  const body = new FormData();
  body.append('cacheControl', '0');
  body.append('', new Blob([original], { type: 'application/pdf' }), file_name);
  let uploadError: Error | undefined;
  try {
    const response = await fetch(preparation.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body });
    if (!response.ok) throw new Error('Caricamento PDF non riuscito. Riprova.');
  } catch {
    uploadError = new Error('Caricamento PDF non riuscito. Riprova.');
  }

  try {
    const { file } = await archiveWrite<{ file: EstimatePdfFile }>(organization, { action: 'finish', id });
    return file;
  } catch (failure) {
    throw uploadError ?? failure;
  }
}

export async function getDemoEstimatePdf(id: string) {
  const file = await localArchive<StoredPdf | undefined>('readonly', files => files.get(id));
  if (!file) return null;
  const { blob: _, ...metadata } = file;
  return metadata;
}

export async function downloadDemoEstimatePdf(id: string) {
  const file = await localArchive<StoredPdf | undefined>('readonly', files => files.get(id));
  if (!file || isDemoTombstoned('estimate_pdf', id)) throw new Error('Il PDF non è più disponibile in questo browser.');
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.file_name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
