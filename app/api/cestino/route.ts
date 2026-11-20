import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { session } from '@/lib/backend';
import { trashActionSchema } from '@/lib/trash';

const headers = { 'Cache-Control': 'no-store' };

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers });
}

export async function POST(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site'
    || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return failure('Richiesta non valida.', 400);
  }

  const org = z.uuid().safeParse(request.nextUrl.searchParams.get('azienda'));
  const parsed = trashActionSchema.safeParse(await request.json().catch(() => null));
  if (!org.success || !parsed.success) return failure('Richiesta non valida.', 400);

  const { db, identity } = await session(org.data);
  if (!db || !identity || identity.org.id !== org.data) return failure('Azienda non accessibile.', 403);

  const { kind, id, action } = parsed.data;
  const { error } = await db.rpc('imprelio_trash_write', {
    org: identity.org.id, entity: kind, target: id, operation: action,
  });
  if (!error) return NextResponse.json({ ok: true }, { headers });
  if (error.code === 'PGRST202' || error.code === '42883') {
    return failure('Attiva il cestino eseguendo la migrazione 008 in Supabase.', 503);
  }
  if (error.code === '42501') return failure('Azienda non accessibile.', 403);
  if (error.code === 'P0002') return failure('L’elemento non è più disponibile.', 404);
  if (error.code === '23503') return failure('Il cantiere collegato non è più disponibile.', 409);
  if (error.code === '23505') return failure('L’elemento è già presente.', 409);
  if (error.code === '22023') return failure('Richiesta non valida.', 400);
  return failure(action === 'delete' ? 'Eliminazione non riuscita. Riprova.' : 'Ripristino non riuscito. Riprova.', 500);
}
