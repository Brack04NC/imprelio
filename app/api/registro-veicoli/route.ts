import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { session } from '@/lib/backend';
import { romeDate } from '@/lib/domain';
import { validateVehicleLog } from '@/lib/vehicle-log';
import { isVehicleLogMigrationMissing, writeVehicleLog } from '@/lib/vehicle-log-backend';

const headers = { 'Cache-Control': 'no-store' };
function failure(error: string, status: number) { return NextResponse.json({ error }, { status, headers }); }

export async function POST(request: NextRequest) {
  const org = z.uuid().safeParse(request.nextUrl.searchParams.get('azienda'));
  if (!org.success || request.headers.get('sec-fetch-site') === 'cross-site'
    || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return failure('Richiesta non valida.', 400);
  const { db, identity } = await session(org.data);
  if (!db || identity?.org.id !== org.data) return failure('Azienda non accessibile.', 403);
  let input;
  try { input = validateVehicleLog(await request.json().catch(() => null), romeDate()); }
  catch (error) { return failure(error instanceof Error ? error.message : 'Dati non validi.', 400); }
  try { return NextResponse.json({ entry: await writeVehicleLog(db, org.data, input) }, { headers }); }
  catch (error) {
    if (isVehicleLogMigrationMissing(error)) return failure('Attiva il registro con la migrazione 016 in Supabase.', 503);
    const code = (error as { code?: string } | null)?.code;
    if (code === '42501') return failure('Azienda non accessibile.', 403);
    if (code === 'P0002') return failure('Scheda del veicolo o registrazione non disponibile per le modifiche.', 404);
    if (code === '23503') return failure('Il personale, la squadra o il cantiere selezionato non è più disponibile.', 409);
    if (code === '22023') return failure('Controlla le date e i dati della registrazione.', 400);
    return failure('Salvataggio non riuscito. Riprova.', 500);
  }
}
