import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { session } from '@/lib/backend';
import { documentExtractionSchema, documentKindSchema, documentMaxBytes, documentMimeSchema } from '@/lib/document-intake';
import { attachEstimateDocument, documentIntakeFailure, finishDocument, listDocuments, openDocument, prepareDocument } from '@/lib/document-intake-backend';

const identifier = z.uuid().transform(id => id.toLowerCase());
const source = z.enum(['intake', 'estimate-pdf']);
const action = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('prepare'), id: identifier, kind: documentKindSchema, file_name: z.string().trim()
      .min(5).max(250).regex(/^[^\x00-\x1f\x7f/\\]+$/), mime_type: documentMimeSchema,
    size_bytes: z.number().int().min(1).max(documentMaxBytes), site_id: identifier.nullable(),
  }),
  z.strictObject({ action: z.literal('finish'), id: identifier, extraction: documentExtractionSchema }),
  z.strictObject({ action: z.literal('attach-estimate'), id: identifier, extraction: documentExtractionSchema }),
]);

const headers = { 'Cache-Control': 'no-store' };
function json(body: unknown, status = 200) { return NextResponse.json(body, { headers, status }); }
function invalid() { return json({ code: 'invalid_request', error: 'Richiesta non valida.' }, 400); }
function forbidden() { return json({ code: 'forbidden', error: 'Azienda non accessibile.' }, 403); }
function handleError(error: unknown) {
  const result = documentIntakeFailure(error);
  return json({ code: result.code, error: result.message }, result.status);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const org = identifier.safeParse(params.get('azienda'));
  const id = identifier.optional().safeParse(params.get('id') ?? undefined);
  const bucket = source.optional().safeParse(params.get('source') ?? undefined);
  if (!org.success || !id.success || !bucket.success || Boolean(id.data) !== Boolean(bucket.data)) return invalid();
  try {
    const { db, identity } = await session(org.data);
    if (!db || identity?.org.id !== org.data) return forbidden();
    if (id.data && bucket.data) {
      const url = await openDocument(db, org.data, id.data, bucket.data);
      return NextResponse.redirect(url, { status: 302, headers: { ...headers, 'Referrer-Policy': 'no-referrer' } });
    }
    return json({ entries: await listDocuments(db, org.data) });
  } catch (error) { return handleError(error); }
}

export async function POST(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site'
    || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return invalid();
  const org = identifier.safeParse(request.nextUrl.searchParams.get('azienda'));
  if (!org.success) return invalid();
  try {
    const { db, identity } = await session(org.data);
    if (!db || identity?.org.id !== org.data) return forbidden();
    const parsed = action.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const operation = parsed.data;
    switch (operation.action) {
      case 'prepare': return json(await prepareDocument(db, org.data, operation));
      case 'finish': return json({ entry: await finishDocument(db, org.data, operation.id, operation.extraction) });
      case 'attach-estimate': return json({ entry: await attachEstimateDocument(db, org.data, operation.id, operation.extraction) });
    }
  } catch (error) { return handleError(error); }
}
