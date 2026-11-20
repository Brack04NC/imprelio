import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { session } from '@/lib/backend';
import { validateWorkerDeadlineAction } from '@/lib/worker-deadlines';
import { isWorkerDeadlinesMigrationMissing, writeWorkerDeadline } from '@/lib/worker-deadlines-backend';

const headers = { 'Cache-Control': 'no-store' };

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers });
}

export async function POST(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site'
    || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return failure('Richiesta non valida.', 400);
  }
  const organization = z.uuid().safeParse(request.nextUrl.searchParams.get('azienda'));
  if (!organization.success) return failure('Azienda non valida.', 400);
  const { identity, db } = await session(organization.data);
  if (!identity || !db || identity.org.id !== organization.data) return failure('Azienda non accessibile.', 403);

  let action: ReturnType<typeof validateWorkerDeadlineAction>;
  try { action = validateWorkerDeadlineAction(await request.json()); }
  catch (error) {
    return failure(error instanceof Error && !(error instanceof SyntaxError) ? error.message : 'Controlla i dati della registrazione.', 400);
  }

  try {
    return NextResponse.json({ entry: await writeWorkerDeadline(db, identity.org.id, action) }, { headers });
  } catch (error) {
    if (isWorkerDeadlinesMigrationMissing(error)) return failure('Attiva le scadenze degli operai con la migrazione 011 in Supabase.', 503);
    const code = (error as { code?: string } | null)?.code;
    if (code === '22023') return failure('Controlla tipo, titolo e date.', 400);
    if (code === 'P0002' || code === '23503') return failure('Operaio o registrazione non disponibile per le modifiche.', 404);
    if (code === '42501') return failure('Azienda non accessibile.', 403);
    return failure('Impossibile salvare la registrazione. Riprova.', 500);
  }
}
