'use server';

import { createClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { authRedirect, database, demoMode } from '@/lib/backend';

export async function signIn(form: FormData) {
  if (demoMode) redirect('/cantieri');
  const result = z.email().safeParse(String(form.get('email') ?? '').trim().toLowerCase());
  if (!result.success) redirect('/login?errore=email');
  // Email links use token_hash, allowing them to open on any device without a local PKCE verifier.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await db.auth.signInWithOtp({ email: result.data, options: {
    shouldCreateUser: false, emailRedirectTo: authRedirect(),
  } });
  if (error?.status === 429) redirect('/login?errore=attendi');
  if (error && (!error.status || error.status >= 500)) redirect('/login?errore=invio');
  redirect('/login?inviato=1');
}

export async function signOut() {
  if (!demoMode) {
    const db = await database();
    await db.auth.signOut({ scope: 'local' });
  }
  redirect('/login');
}
