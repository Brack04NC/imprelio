import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { session } from '@/lib/backend';
import { isFinanceMigrationMissing, writeFinance } from '@/lib/finance-backend';
import { validateFinanceAction } from '@/lib/finance';

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
  if (!org.success) return failure('Azienda non valida.', 400);
  const { identity, db } = await session(org.data);
  if (!db || !identity || identity.org.id !== org.data) return failure('Azienda non accessibile.', 403);
  let action: ReturnType<typeof validateFinanceAction>;
  try { action = validateFinanceAction(await request.json()); }
  catch { return failure('Controlla nome, date e importi inseriti.', 400); }

  try {
    return NextResponse.json({ data: await writeFinance(db, identity.org.id, action) }, { headers });
  } catch (error) {
    if (isFinanceMigrationMissing(error)) return failure('Attiva Estratti conto eseguendo la migrazione 007 in Supabase.', 503);
    const { code } = (error ?? {}) as { code?: string };
    if (code === '42501') return failure('Azienda non accessibile.', 403);
    if (code === '23505') return failure('Esiste già un conto con questo nome.', 409);
    if (code === '23503' || code === 'P0002') return failure('Conto, movimento o cantiere non disponibile.', 404);
    if (code === '22023') return failure('Controlla i dati. La data dei movimenti deve essere uguale o successiva al saldo iniziale.', 400);
    return failure('Salvataggio non riuscito. Riprova.', 500);
  }
}
