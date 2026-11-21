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
  const extended = kind !== 'intervention' && kind !== 'quote';
  if (error.code === 'PGRST202' || error.code === '42883' || (extended && error.code === '22023')) {
    if (kind === 'document_import') return failure('Attiva il cestino dei documenti importati con la migrazione 019 in Supabase.', 503);
    return failure(extended ? 'Attiva il cestino delle schede con le migrazioni 013 e 014 in Supabase.'
      : 'Attiva il cestino eseguendo la migrazione 008 in Supabase.', 503);
  }
  if (error.code === '42501') return failure('Azienda non accessibile.', 403);
  if (error.code === 'P0001') {
    if (error.message.includes('Cliente con cantieri')) return failure('Prima di eliminare il cliente, riassegna o elimina i cantieri collegati.', 409);
    if (error.message.includes('Articolo con movimenti')) return failure('Archivia o elimina i movimenti attivi di questo articolo.', 409);
    if (error.message.includes('Stock insufficiente')) return failure('L’operazione porterebbe la giacenza sotto zero.', 409);
  }
  if (error.code === 'P0002' && error.message.includes('Articolo non disponibile')) {
    return failure('Ripristina prima l’articolo a cui è collegato questo movimento.', 409);
  }
  if (error.code === 'P0002') return failure('L’elemento non è più disponibile.', 404);
  if (error.code === '23503') return failure(kind === 'site' ? 'Ripristina prima il cliente collegato.'
    : kind === 'document_import' ? 'Ripristina prima il cantiere collegato.' : 'Ripristina prima la scheda collegata.', 409);
  if (error.code === '23505') return failure('L’elemento è già presente.', 409);
  if (error.code === '22023') return failure('Richiesta non valida.', 400);
  return failure(action === 'delete' ? 'Eliminazione non riuscita. Riprova.' : 'Ripristino non riuscito. Riprova.', 500);
}
