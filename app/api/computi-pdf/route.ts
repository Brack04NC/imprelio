import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { session } from '@/lib/backend';
import { estimatePdfMaxBytes } from '@/lib/estimate-pdf-archive';
import {
  downloadEstimatePdf, estimatePdfFailure, finishEstimatePdf, prepareEstimatePdf, readEstimatePdfFiles,
} from '@/lib/estimate-pdf-storage-backend';

const uploadAction = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('prepare'),
    id: z.uuid(),
    site_id: z.uuid(),
    file_name: z.string().trim().max(250).regex(/^[^\x00-\x1f\x7f/\\]+\.pdf$/i),
    size_bytes: z.number().int().min(1).max(estimatePdfMaxBytes),
  }),
  z.strictObject({ action: z.literal('finish'), id: z.uuid() }),
]);

const headers = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

function error(code: string, message: string, status: number) {
  return json({ code, error: message }, status);
}

function fromFailure(failure: unknown) {
  const result = estimatePdfFailure(failure);
  return error(result.code, result.message, result.status);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const org = z.uuid().safeParse(searchParams.get('azienda'));
  const site = z.uuid().optional().safeParse(searchParams.get('cantiere') ?? undefined);
  const id = z.uuid().optional().safeParse(searchParams.get('id') ?? undefined);
  if (!org.success || !site.success || !id.success) return error('invalid_request', 'Richiesta non valida.', 400);
  try {
    const { identity, db } = await session(org.data);
    if (!db || !identity || identity.org.id !== org.data) return error('forbidden', 'Azienda non accessibile.', 403);
    if (id.data) {
      const url = await downloadEstimatePdf(db, identity.org.id, id.data, site.data);
      return NextResponse.redirect(url, { status: 302, headers: { ...headers, 'Referrer-Policy': 'no-referrer' } });
    }
    return json({ files: await readEstimatePdfFiles(db, identity.org.id, site.data) });
  } catch (failure) {
    return fromFailure(failure);
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site' ||
    request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return error('invalid_request', 'Richiesta non valida.', 400);
  }
  const org = z.uuid().safeParse(request.nextUrl.searchParams.get('azienda'));
  if (!org.success) return error('invalid_request', 'Azienda non valida.', 400);
  try {
    const { identity, db } = await session(org.data);
    if (!db || !identity || identity.org.id !== org.data) return error('forbidden', 'Azienda non accessibile.', 403);
    const parsed = uploadAction.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return error('invalid_request', 'Controlla i dati del PDF e riprova.', 400);
    const operation = parsed.data;
    if (operation.action === 'prepare') return json(await prepareEstimatePdf(db, identity.org.id, operation));
    const file = await finishEstimatePdf(db, identity.org.id, operation.id);
    if (!file) return error('upload_incomplete', 'Caricamento non completato. Riprova.', 409);
    return json({ file });
  } catch (failure) {
    return fromFailure(failure);
  }
}
