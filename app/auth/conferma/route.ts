import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { authRedirect, database, demoMode } from '@/lib/backend';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const hash = query.get('token_hash');
  const type = query.get('type');
  if (!demoMode && hash && type && ['invite', 'magiclink', 'email'].includes(type)) {
    const db = await database();
    const { error } = await db.auth.verifyOtp({ token_hash: hash, type: type as EmailOtpType });
    if (!error) {
      const { error: activationError } = await db.rpc('claim_imprelio_invitations');
      if (activationError) return NextResponse.redirect(new URL('/login?errore=attivazione', authRedirect()));
      return NextResponse.redirect(new URL('/', authRedirect()));
    }
  }
  return NextResponse.redirect(new URL('/login?errore=link', authRedirect()));
}
