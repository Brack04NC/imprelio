import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { session } from '@/lib/backend';
import { romeDate } from '@/lib/domain';
import { readNotificationFeed } from '@/lib/notifications-backend';

const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  const organization = z.uuid().safeParse(request.nextUrl.searchParams.get('azienda'));
  if (!organization.success || request.headers.get('sec-fetch-site') === 'cross-site'
    || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400, headers });
  }
  try {
    const { db, identity } = await session(organization.data);
    if (!db || identity?.org.id !== organization.data) {
      return NextResponse.json({ error: 'Azienda non accessibile.' }, { status: 403, headers });
    }
    const history = request.nextUrl.searchParams.get('vista') === 'cronologia';
    return NextResponse.json(await readNotificationFeed(db, identity.org.id, romeDate(), history), { headers });
  } catch {
    return NextResponse.json({ error: 'Impossibile aggiornare le notifiche.' }, { status: 500, headers });
  }
}
