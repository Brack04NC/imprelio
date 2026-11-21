import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { authRedirect, database, demoMode, needsInvitationPassword } from '@/lib/backend';

function goTo(path: string) {
  return NextResponse.redirect(new URL(path, authRedirect()), {
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const hash = query.get('token_hash');
  const type = query.get('type');
  if (!demoMode && hash && type && ['invite', 'magiclink', 'email'].includes(type)) {
    const db = await database();
    const { data, error } = await db.auth.verifyOtp({ token_hash: hash, type: type as EmailOtpType });
    if (!error && data.user) {
      const pending = needsInvitationPassword(data.user);
      if (type === 'invite' && !pending) {
        const result = await db.auth.updateUser({ data: { imprelio_password_pending: true } });
        if (result.error) return goTo('/login?errore=attivazione');
      }
      if (type === 'invite' || pending) return goTo('/auth/imposta-password');
      const { error: activationError } = await db.rpc('claim_imprelio_invitations');
      if (activationError) return goTo('/login?errore=attivazione');
      return goTo('/');
    }
  }
  return goTo('/login?errore=link');
}
