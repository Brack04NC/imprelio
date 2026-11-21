'use client';

import type { Identity } from './domain.ts';
import {
  blankDocumentFields, documentEntrySchema, documentExtractionSchema, documentFileName, documentMaxBytes, documentMimeForName,
  type DocumentEntry, type DocumentExtraction, type DocumentKind,
} from './document-intake.ts';
import {
  getDemoIntakeDocument, listDemoEstimateExtractions, listDemoIntakeDocuments, saveDemoEstimateExtraction, saveDemoIntakeDocument,
} from './document-intake-demo.ts';
import { getDemoEstimatePdf, listEstimatePdfs, readDemoEstimatePdfBlob } from './estimate-pdf-archive-client.ts';
import type { EstimatePdfFile } from './estimate-pdf-archive.ts';
import { demoTombstoneIds, isDemoTombstoned } from './trash-storage.ts';

export const documentIntakeChangeEvent = 'imprelio-documenti-aggiornati';
export const documentIntakeSyncKey = 'imprelio-archivio-documenti-aggiornato-v1';

export class DocumentIntakeError extends Error {
  readonly code?: string;
  readonly status?: number;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = 'DocumentIntakeError';
    this.code = code;
    this.status = status;
  }
}

type DocumentUpload = {
  id: string;
  file: File;
  kind: DocumentKind;
  site_id: string | null;
  extraction: DocumentExtraction;
};

type Preparation = { entry: DocumentEntry } | { uploadUrl: string | null };

function apiUrl(organization: string, params?: Record<string, string>) {
  return '/api/archivio-documenti?' + new URLSearchParams({ azienda: organization, ...params });
}

export function documentOpenHref(organization: string, entry: DocumentEntry) {
  return apiUrl(organization, { id: entry.id, source: entry.source });
}

async function request<T>(organization: string, options: RequestInit = {}) {
  const response = await fetch(apiUrl(organization), { ...options, cache: 'no-store' });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const message = typeof result?.error === 'string' ? result.error : 'Archivio documenti non disponibile. Riprova.';
    throw new DocumentIntakeError(message, typeof result?.code === 'string' ? result.code : undefined, response.status);
  }
  return result as T;
}

function write<T>(organization: string, action: object) {
  return request<T>(organization, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
  });
}

function decodeEntry(entry: unknown) {
  const parsed = documentEntrySchema.safeParse(entry);
  if (!parsed.success) throw new DocumentIntakeError('I dati del documento non sono disponibili. Riprova.');
  return parsed.data;
}

function prepareExtraction(kind: DocumentKind, extraction: DocumentExtraction) {
  const parsed = documentExtractionSchema.safeParse({ ...extraction, kind });
  if (!parsed.success) throw new DocumentIntakeError('Controlla i dati estratti prima di salvare.');
  return parsed.data;
}

function notifyChange() {
  try { localStorage.setItem(documentIntakeSyncKey, crypto.randomUUID()); } catch { /* The file is already saved. */ }
  window.dispatchEvent(new Event(documentIntakeChangeEvent));
}

function legacyEntry(file: EstimatePdfFile, extraction?: DocumentExtraction): DocumentEntry {
  return {
    id: file.id, kind: 'estimate', file_name: file.file_name, mime_type: 'application/pdf',
    size_bytes: file.size_bytes, site_id: file.site_id, created_at: file.uploaded_at, source: 'estimate-pdf',
    extraction: extraction ?? {
      kind: 'estimate', status: 'review',
      fields: { ...blankDocumentFields(), title: file.file_name.replace(/\.pdf$/i, '').trim() || file.file_name },
    },
  };
}

export async function listDocuments(identity: Identity, signal?: AbortSignal): Promise<DocumentEntry[]> {
  if (identity.demo) {
    const [imports, files, extractions] = await Promise.all([
      listDemoIntakeDocuments(), listEstimatePdfs(identity.org.id, true, '', signal), listDemoEstimateExtractions(),
    ]);
    signal?.throwIfAborted();
    const deletedSites = demoTombstoneIds('site');
    const estimates = files.filter(file => !deletedSites.has(file.site_id)).map(file => legacyEntry(file, extractions.get(file.id)));
    return [...imports, ...estimates].sort((first, second) => second.created_at.localeCompare(first.created_at) || first.id.localeCompare(second.id));
  }
  const { entries } = await request<{ entries: unknown[] }>(identity.org.id, { signal });
  if (!Array.isArray(entries)) throw new DocumentIntakeError('L’elenco dei documenti non è disponibile. Riprova.');
  return entries.map(decodeEntry);
}

async function matchesFormat(file: File, mime: DocumentEntry['mime_type']) {
  if (mime === 'application/pdf') return (await file.slice(0, 1024).text()).trimStart().startsWith('%PDF-');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  switch (mime) {
    case 'image/jpeg': return starts([0xff, 0xd8, 0xff]);
    case 'image/png': return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp': return starts([0x52, 0x49, 0x46, 0x46]) && [0x57, 0x45, 0x42, 0x50].every((byte, index) => bytes[index + 8] === byte);
  }
}

export async function saveImportedDocument(identity: Identity, upload: DocumentUpload): Promise<DocumentEntry> {
  const { id, file, kind, site_id } = upload;
  const file_name = documentFileName(file.name);
  const mime_type = documentMimeForName(file_name);
  if (!mime_type) throw new DocumentIntakeError('Scegli un file PDF, JPEG, PNG o WebP.');
  if (file.size < 1 || file.size > documentMaxBytes) throw new DocumentIntakeError('Scegli un file valido fino a 25 MB.');
  if (!(await matchesFormat(file, mime_type))) throw new DocumentIntakeError('Il contenuto del file non corrisponde al formato indicato.');
  const metadata = { id, kind, file_name, mime_type, size_bytes: file.size, site_id };
  const extraction = prepareExtraction(kind, upload.extraction);
  const blob = file.type === mime_type ? file : file.slice(0, file.size, mime_type);

  if (identity.demo) {
    const entry = decodeEntry({ ...metadata, source: 'intake', created_at: new Date().toISOString(), extraction });
    let saved: DocumentEntry;
    try { saved = await saveDemoIntakeDocument(entry, blob); }
    catch (failure) {
      if (failure instanceof DOMException && failure.name === 'QuotaExceededError') {
        throw new DocumentIntakeError('Il browser non ha spazio sufficiente per salvare il file.');
      }
      throw failure;
    }
    notifyChange();
    return saved;
  }

  const organization = identity.org.id;
  const preparation = await write<Preparation>(organization, { action: 'prepare', ...metadata });
  if ('entry' in preparation) {
    const entry = decodeEntry(preparation.entry);
    notifyChange();
    return entry;
  }

  let uploadFailed = false;
  if (preparation.uploadUrl) {
    const body = new FormData();
    body.append('cacheControl', '0');
    body.append('', blob, file_name);
    try {
      const response = await fetch(preparation.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body });
      uploadFailed = !response.ok;
    } catch { uploadFailed = true; }
  }
  let result: { entry: DocumentEntry };
  try { result = await write(organization, { action: 'finish', id, extraction }); }
  catch (failure) {
    if (uploadFailed && failure instanceof DocumentIntakeError && failure.status === 409) {
      throw new DocumentIntakeError('Caricamento del file non riuscito. Riprova.');
    }
    throw failure;
  }
  const entry = decodeEntry(result.entry);
  notifyChange();
  return entry;
}

export async function readDemoDocument(entry: DocumentEntry): Promise<Blob> {
  if (entry.source === 'estimate-pdf') {
    if (entry.site_id && isDemoTombstoned('site', entry.site_id)) throw new DocumentIntakeError('Il cantiere non è disponibile.');
    const { blob } = await readDemoEstimatePdfBlob(entry.id);
    return blob.type === 'application/pdf' ? blob : blob.slice(0, blob.size, 'application/pdf');
  }
  const record = await getDemoIntakeDocument(entry.id);
  if (!record || isDemoTombstoned('document_import', entry.id) || (record.site_id && isDemoTombstoned('site', record.site_id))) {
    throw new DocumentIntakeError('Il file originale non è disponibile.');
  }
  return record.blob;
}

export async function attachImportedEstimateExtraction(identity: Identity, id: string, value: DocumentExtraction): Promise<DocumentEntry> {
  const extraction = prepareExtraction('estimate', value);
  if (identity.demo) {
    const file = await getDemoEstimatePdf(id);
    if (!file || isDemoTombstoned('estimate_pdf', id) || isDemoTombstoned('site', file.site_id)) {
      throw new DocumentIntakeError('Il PDF non è disponibile nel browser.');
    }
    await saveDemoEstimateExtraction(id, extraction);
    notifyChange();
    return legacyEntry(file, extraction);
  }
  const { entry } = await write<{ entry: DocumentEntry }>(identity.org.id, { action: 'attach-estimate', id, extraction });
  const saved = decodeEntry(entry);
  notifyChange();
  return saved;
}
