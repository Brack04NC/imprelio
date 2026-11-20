import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { session } from '@/lib/backend';
import { pricingAction } from '@/lib/estimate-pricing';
import { readRates } from '@/lib/estimate-pricing-backend';

const json = NextResponse.json;

export async function GET(request: NextRequest) {
  try {
    const org = request.nextUrl.searchParams.get('azienda');
    const isRateList = request.nextUrl.searchParams.get('vista') === 'listino';
    const { identity, db } = await session(org);
    if (!db || !identity || identity.org.id !== org) return json({ error: 'Azienda non accessibile.' }, { status: 403 });
    if (isRateList) return json(await readRates(db, identity.org.id), { headers: { 'Cache-Control': 'no-store' } });
    const id = z.uuid().safeParse(request.nextUrl.searchParams.get('id'));
    if (!id.success) return json({ error: 'Preventivo non valido.' }, { status: 400 });
    const { data, error } = await db.from('estimate_quotes').select('id,site_id,title,source_name,created_at,lines')
      .eq('organization_id', identity.org.id).eq('id', id.data).maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: 'Preventivo non disponibile.' }, { status: 404 });
    return json(data);
  } catch {
    return json({ error: 'Impossibile aprire il preventivo.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site' ||
    request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'Richiesta non valida.' }, { status: 400 });
  try {
    const org = request.nextUrl.searchParams.get('azienda');
    const { identity, db } = await session(org);
    if (!db || !identity || identity.org.id !== org) return json({ error: 'Azienda non accessibile.' }, { status: 403 });
    const parsed = pricingAction.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Controlla i dati prima di salvare.' }, { status: 400 });
    const operation = parsed.data;
    if (operation.action === 'save_rate') {
      const { error } = await db.from('estimate_rates').upsert({ ...operation.rate, organization_id: identity.org.id });
      if (error) throw error;
      return json({ ok: true });
    }
    if (operation.action === 'remove_rate') {
      const { error } = await db.from('estimate_rates').delete().eq('organization_id', identity.org.id).eq('id', operation.id);
      if (error) throw error;
      return json({ ok: true });
    }
    const { data, error } = await db.from('estimate_quotes').upsert({ ...operation.quote, organization_id: identity.org.id })
      .select('id,site_id,title,source_name,created_at').single();
    if (error) throw error;
    return json(data);
  } catch (failure) {
    const code = (failure as { code?: string } | null)?.code;
    if (code === '23503') return json({ error: 'Il cantiere selezionato non è disponibile.' }, { status: 400 });
    if (code === 'P0002') return json({ error: 'Il preventivo è stato eliminato.' }, { status: 409 });
    return json({ error: 'Salvataggio non riuscito. Riprova.' }, { status: 500 });
  }
}
