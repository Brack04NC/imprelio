import { NextResponse, type NextRequest } from 'next/server';
import { session } from '@/lib/backend';
import { clientSchema } from '@/lib/client-directory';

export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.startsWith('application/json') || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 });
  }
  try {
    const org = request.nextUrl.searchParams.get('azienda');
    const { identity, db } = await session(org);
    if (!identity || !db || identity.org.id !== org) {
      return NextResponse.json({ error: 'Accesso richiesto.' }, { status: 401 });
    }
    const parsed = clientSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Controlla i dati del cliente.' }, { status: 400 });

    const { error } = await db.rpc('imprelio_client_write', { org, payload: parsed.data });
    if (error?.code === '23505') return NextResponse.json({ error: 'Esiste già un cliente con questo nome.' }, { status: 409 });
    if (error?.code === 'P0002') return NextResponse.json({ error: 'Cliente non disponibile.' }, { status: 404 });
    if (error?.code === '42501') return NextResponse.json({ error: 'Accesso riservato.' }, { status: 403 });
    if (error?.code === 'PGRST202' || error?.code === '42883') {
      return NextResponse.json({ error: 'Il database va aggiornato con la migrazione Clienti.' }, { status: 503 });
    }
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Salvataggio non riuscito. Riprova.' }, { status: 500 });
  }
}
