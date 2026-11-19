import 'server-only';

import type { database } from './backend';
import type { EstimatePdfFile } from './estimate-pdf-archive';

type Database = Awaited<ReturnType<typeof database>>;
type PdfReservation = Pick<EstimatePdfFile, 'id' | 'site_id' | 'file_name' | 'size_bytes'>;

const bucket = 'estimate-source-pdfs';
const fields = 'id,site_id,file_name,size_bytes,created_at,uploaded_at';
const pageSize = 500;

export class EstimatePdfArchiveError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

function storagePath(org: string, id: string) {
  return `${org}/${id}.pdf`;
}

function finalizedFile(row: EstimatePdfFile): EstimatePdfFile {
  const { id, site_id, file_name, size_bytes, created_at, uploaded_at } = row;
  return { id, site_id, file_name, size_bytes, created_at, uploaded_at };
}

export function estimatePdfFailure(error: unknown) {
  if (error instanceof EstimatePdfArchiveError) return error;
  const failure = error as { code?: string; statusCode?: string; message?: string } | null;
  switch (failure?.code || failure?.statusCode) {
    case '42P01':
    case '42883':
    case 'PGRST202':
    case 'PGRST205':
    case 'NoSuchBucket':
      return new EstimatePdfArchiveError('Archivio PDF da attivare su Supabase.', 503, 'migration_missing');
    case '42501':
    case 'AccessDenied':
    case '403':
      return new EstimatePdfArchiveError('Archivio PDF non accessibile.', 403, 'forbidden');
    case 'P0002':
    case '23503':
    case 'NoSuchKey':
      return new EstimatePdfArchiveError('Il cantiere o il PDF non è disponibile.', 404, 'not_found');
    case '23505':
      return new EstimatePdfArchiveError('Il PDF è già associato a un altro caricamento.', 409, 'conflict');
    case '22023':
    case '23514':
      return new EstimatePdfArchiveError('Il PDF non corrisponde ai dati del caricamento.', 422, 'invalid_file');
  }
  // Older Storage releases only send a numerical status with "Bucket not found".
  if (failure?.statusCode === '404' && failure.message?.toLowerCase() === 'bucket not found') {
    return new EstimatePdfArchiveError('Archivio PDF da attivare su Supabase.', 503, 'migration_missing');
  }
  return new EstimatePdfArchiveError('Archivio PDF non disponibile. Riprova.', 500, 'storage_unavailable');
}

export async function readEstimatePdfFiles(db: Database, org: string, site?: string) {
  const files: EstimatePdfFile[] = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = db.from('estimate_pdf_files').select(fields).eq('organization_id', org)
      .not('uploaded_at', 'is', null);
    if (site) query = query.eq('site_id', site);
    const { data, error } = await query.order('uploaded_at', { ascending: false }).order('id')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    files.push(...data);
    if (data.length < pageSize) return files;
  }
}

export async function finishEstimatePdf(db: Database, org: string, id: string) {
  const { data, error } = await db.rpc('imprelio_finish_estimate_pdf', { org, file_id: id });
  if (error) throw error;
  return data ? finalizedFile(data) : null;
}

export async function prepareEstimatePdf(db: Database, org: string, reservation: PdfReservation) {
  const { error } = await db.rpc('imprelio_prepare_estimate_pdf', {
    org, site: reservation.site_id, file_id: reservation.id,
    original_name: reservation.file_name, bytes: reservation.size_bytes,
  });
  if (error) throw error;
  const file = await finishEstimatePdf(db, org, reservation.id);
  if (file) return { file };

  const { data, error: signError } = await db.storage.from(bucket)
    .createSignedUploadUrl(storagePath(org, reservation.id), { upsert: false });
  if (signError) throw signError;
  return { uploadUrl: data.signedUrl };
}

export async function downloadEstimatePdf(db: Database, org: string, id: string, site?: string) {
  let query = db.from('estimate_pdf_files').select('file_name').eq('organization_id', org)
    .eq('id', id).not('uploaded_at', 'is', null);
  if (site) query = query.eq('site_id', site);
  const { data: row, error } = await query.maybeSingle();
  if (error) throw error;
  if (!row) throw new EstimatePdfArchiveError('PDF non disponibile.', 404, 'not_found');

  const { data, error: signError } = await db.storage.from(bucket)
    .createSignedUrl(storagePath(org, id), 60, { download: true });
  if (signError) throw signError;
  const url = new URL(data.signedUrl);
  url.searchParams.set('download', row.file_name);
  return url;
}
