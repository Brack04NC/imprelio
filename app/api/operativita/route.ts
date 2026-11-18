import { NextResponse, type NextRequest } from 'next/server';
import { session } from '@/lib/backend';
import { validateOperation } from '@/lib/operations';
import { writeOperation } from '@/lib/operations-backend';

export async function POST(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site' ||
    request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 });
  }
  const organization = request.nextUrl.searchParams.get('azienda');
  const { identity, db } = await session(organization);
  if (!db || !identity || identity.org.id !== organization)
    return NextResponse.json({ error: 'Azienda non accessibile.' }, { status: 403 });
  try {
    const raw: unknown = await request.json();
    const action = validateOperation(raw);
    await writeOperation(db, identity.org.id, action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyntaxError ? 'Richiesta non valida.' :
      error instanceof Error ? error.message : 'Salvataggio non riuscito.' }, { status: 400 });
  }
}
