import 'server-only';

import { z } from 'zod';
import type { database } from './backend';
import {
  blankDocumentFields, documentEntrySchema, documentExtractionSchema, type DocumentEntry, type DocumentExtraction,
} from './document-intake';

type Database = Awaited<ReturnType<typeof database>>;
type Source = DocumentEntry['source'];
type Reservation = Pick<DocumentEntry, 'id' | 'kind' | 'file_name' | 'mime_type' | 'size_bytes' | 'site_id'>;
const uploadedAt = z.iso.datetime({ offset: true }).nullable();
const importRowSchema = z.object({ ...documentEntrySchema.omit({ source: true, extraction: true }).shape,
  uploaded_at: uploadedAt, extraction: documentExtractionSchema.nullable() });
const estimateRowSchema = z.object({ ...documentEntrySchema.pick({ id: true, file_name: true, size_bytes: true, site_id: true, created_at: true }).shape,
  uploaded_at: uploadedAt, document_extraction: documentExtractionSchema.nullable() });
type ImportRow = z.infer<typeof importRowSchema>;
type EstimateRow = z.infer<typeof estimateRowSchema>;

const originals = 'document-originals';
const estimateOriginals = 'estimate-source-pdfs';
const names = { intake: originals, 'estimate-pdf': estimateOriginals };
const extensions = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
const intakeFields = 'id,kind,file_name,mime_type,size_bytes,site_id,created_at,uploaded_at,extraction';
const estimateFields = 'id,file_name,size_bytes,site_id,created_at,uploaded_at,document_extraction';
const pageSize = 250;
const signatureBytes = 1024;
const signedReadSeconds = 300;

export class DocumentIntakeError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

function failure(code: string, status: number, message: string) {
  return new DocumentIntakeError(message, status, code);
}

export function documentIntakeFailure(error: unknown) {
  if (error instanceof DocumentIntakeError) return error;
  const detail = error as { code?: string; statusCode?: string | number; message?: string } | null;
  const code = detail?.code || String(detail?.statusCode ?? '');
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205', 'NoSuchBucket'].includes(code)
    || detail?.message?.toLowerCase() === 'bucket not found') {
    return failure('migration_missing', 503, 'Archivio documenti da attivare su Supabase.');
  }
  if (['42501', 'AccessDenied', '403'].includes(code)) return failure('forbidden', 403, 'Archivio non accessibile.');
  if (['P0002', '23503', 'NoSuchKey', '404'].includes(code)) return failure('not_found', 404, 'Il documento o il cantiere non è disponibile.');
  if (code === '23505') return failure('conflict', 409, 'Il caricamento è già associato a un altro file.');
  if (['22023', '23514'].includes(code)) return failure('invalid_file', 422, 'Controlla il file e i dati del documento.');
  return failure('storage_unavailable', 500, 'Archivio documenti non disponibile. Riprova.');
}

function objectKey(org: string, id: string, mime: Reservation['mime_type']) {
  return `${org}/${id}.${extensions[mime]}`;
}

function intakeEntry(row: ImportRow): DocumentEntry {
  const { id, kind, file_name, mime_type, size_bytes, site_id, created_at, extraction } = row;
  return documentEntrySchema.parse({ id, kind, file_name, mime_type, size_bytes, site_id, created_at, extraction, source: 'intake' });
}

function estimateEntry(row: EstimateRow): DocumentEntry {
  const { id, file_name, size_bytes, site_id, document_extraction } = row;
  return documentEntrySchema.parse({ id, kind: 'estimate', file_name, mime_type: 'application/pdf',
    size_bytes, site_id, created_at: row.uploaded_at ?? row.created_at, source: 'estimate-pdf',
    extraction: document_extraction ?? {
      kind: 'estimate', status: 'unreadable',
      fields: blankDocumentFields(),
    } });
}

async function listImports(db: Database, org: string) {
  const entries: DocumentEntry[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('document_imports').select(intakeFields).eq('organization_id', org)
      .not('uploaded_at', 'is', null).order('created_at', { ascending: false }).order('id')
      .range(offset, offset + pageSize - 1).overrideTypes<ImportRow[], { merge: false }>();
    if (error) throw error;
    entries.push(...data.map(intakeEntry));
    if (data.length < pageSize) return entries;
  }
}

async function listEstimates(db: Database, org: string) {
  const entries: DocumentEntry[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('estimate_pdf_files').select(estimateFields).eq('organization_id', org)
      .not('uploaded_at', 'is', null).order('uploaded_at', { ascending: false }).order('id')
      .range(offset, offset + pageSize - 1).overrideTypes<EstimateRow[], { merge: false }>();
    if (error) throw error;
    entries.push(...data.map(estimateEntry));
    if (data.length < pageSize) return entries;
  }
}

export async function listDocuments(db: Database, org: string) {
  const [documents, estimates] = await Promise.all([listImports(db, org), listEstimates(db, org)]);
  return [...documents, ...estimates].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    || a.id.localeCompare(b.id) || a.source.localeCompare(b.source));
}

export async function prepareDocument(db: Database, org: string, reservation: Reservation) {
  const { data: result, error } = await db.rpc('imprelio_prepare_document', {
    org, file_id: reservation.id, document_kind: reservation.kind, original_name: reservation.file_name,
    mime: reservation.mime_type, bytes: reservation.size_bytes, site: reservation.site_id,
  });
  if (error) throw error;
  const row = importRowSchema.parse(result);
  if (row.uploaded_at) return { entry: intakeEntry(row) };

  const { data, error: uploadError } = await db.storage.from(originals)
    .createSignedUploadUrl(objectKey(org, row.id, row.mime_type), { upsert: false });
  if (uploadError) {
    const detail = uploadError as { code?: string; statusCode?: string | number };
    if (detail.code === 'KeyAlreadyExists' || String(detail.statusCode) === '409') return { uploadUrl: null };
    throw uploadError;
  }
  return { uploadUrl: data.signedUrl };
}

async function signatureOf(response: Response) {
  const reader = response.body?.getReader();
  const signature = new Uint8Array(signatureBytes);
  let offset = 0;
  if (!reader) return signature.subarray(0, offset);
  try {
    while (offset < signature.length) {
      const { done, value } = await reader.read();
      if (done) break;
      const block = value.subarray(0, signature.length - offset);
      signature.set(block, offset);
      offset += block.length;
    }
    return signature.subarray(0, offset);
  } finally { await reader.cancel().catch(() => {}); }
}

function hasSignature(bytes: Uint8Array, mime: Reservation['mime_type']) {
  switch (mime) {
    case 'application/pdf': return new TextDecoder().decode(bytes).trimStart().startsWith('%PDF-');
    case 'image/jpeg': return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case 'image/png': return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    case 'image/webp': {
      const header = new TextDecoder().decode(bytes.subarray(0, 12));
      return header.startsWith('RIFF') && header.endsWith('WEBP');
    }
  }
}

async function verifiedOriginal(db: Database, org: string, id: string, source: Source, mime: Reservation['mime_type']) {
  const { data, error } = await db.storage.from(names[source]).createSignedUrl(objectKey(org, id, mime), signedReadSeconds);
  if (error) throw error;
  const url = new URL(data.signedUrl);
  const response = await fetch(url, {
    headers: { Range: `bytes=0-${signatureBytes - 1}` },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 404) throw failure('not_found', 404, 'File originale non disponibile.');
    throw failure('storage_unavailable', 503, 'Impossibile aprire il file originale. Riprova.');
  }
  const bytes = await signatureOf(response);
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== mime || !hasSignature(bytes, mime)) {
    throw failure('invalid_file', 422, 'Il contenuto del file non corrisponde al formato selezionato.');
  }
  return url;
}

export async function finishDocument(db: Database, org: string, id: string, extraction: DocumentExtraction) {
  const { data: row, error } = await db.from('document_imports').select(intakeFields)
    .eq('organization_id', org).eq('id', id).maybeSingle().overrideTypes<ImportRow, { merge: false }>();
  if (error) throw error;
  if (!row) throw failure('not_found', 404, 'Caricamento non disponibile.');
  if (row.uploaded_at) return intakeEntry(row);
  if (row.kind !== extraction.kind) throw failure('invalid_file', 422, 'La categoria del documento non coincide con il caricamento.');

  try { await verifiedOriginal(db, org, id, 'intake', row.mime_type); }
  catch (verifyError) {
    if (documentIntakeFailure(verifyError).code === 'not_found') {
      throw failure('upload_incomplete', 409, 'Caricamento incompleto. Riprova.');
    }
    throw verifyError;
  }

  const { data: saved, error: finishError } = await db.rpc('imprelio_finish_document', {
    org, file_id: id, document_data: extraction,
  });
  if (finishError) throw finishError;
  if (!saved) throw failure('upload_incomplete', 409, 'Caricamento incompleto. Riprova.');
  return intakeEntry(importRowSchema.parse(saved));
}

export async function attachEstimateDocument(db: Database, org: string, id: string, extraction: DocumentExtraction) {
  const { data, error } = await db.rpc('imprelio_attach_estimate_document', {
    org, file_id: id, document_data: extraction,
  });
  if (error) throw error;
  return estimateEntry(estimateRowSchema.parse(data));
}

export async function openDocument(db: Database, org: string, id: string, source: Source) {
  const table = source === 'intake' ? 'document_imports' : 'estimate_pdf_files';
  const columns = source === 'intake' ? 'id,mime_type' : 'id';
  const { data, error } = await db.from(table).select(columns).eq('organization_id', org).eq('id', id)
    .not('uploaded_at', 'is', null).maybeSingle().overrideTypes<{ id: string; mime_type?: Reservation['mime_type'] }, { merge: false }>();
  if (error) throw error;
  if (!data) throw failure('not_found', 404, 'File originale non disponibile.');
  return verifiedOriginal(db, org, data.id, source, data.mime_type ?? 'application/pdf');
}
