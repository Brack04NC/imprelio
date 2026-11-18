import { NextResponse, type NextRequest } from 'next/server';
import { readAccess, readWorkspace, session, write } from '@/lib/backend';
import { actionSchema, parseWorkspaceParams } from '@/lib/domain';

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams;
    const { identity, db } = await session(query.get('azienda'));
    if (!identity || !db || identity.org.id !== query.get('azienda')) return NextResponse.json({ error: 'Accesso richiesto.' }, { status: 401 });
    if (query.get('vista') === 'accessi') {
      if (identity.org.role !== 'admin') return NextResponse.json({ error: 'Accesso riservato.' }, { status: 403 });
      return NextResponse.json(await readAccess(db, identity.org.id));
    }
    return NextResponse.json(await readWorkspace(db, identity.org.id, parseWorkspaceParams(query)));
  } catch {
    return NextResponse.json({ error: 'Impossibile caricare i dati. Riprova.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.startsWith('application/json') || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 });
  }
  try {
    const query = request.nextUrl.searchParams;
    const { identity, db } = await session(query.get('azienda'));
    if (!identity || !db || identity.org.id !== query.get('azienda')) return NextResponse.json({ error: 'Accesso richiesto.' }, { status: 401 });
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Controlla i dati inseriti.' }, { status: 400 });
    if ((parsed.data.action === 'invite' || parsed.data.action === 'member') && identity.org.role !== 'admin') {
      return NextResponse.json({ error: 'Accesso riservato.' }, { status: 403 });
    }
    const error = await write(db, identity.org, parsed.data);
    if (error) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Salvataggio non riuscito. Riprova.' }, { status: 500 });
  }
}
