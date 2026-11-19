'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { database, demoMode } from '@/lib/backend';

export async function signIn(form: FormData) {
  if (demoMode) redirect('/cantieri');
  const result = z.object({
    email: z.email(),
    password: z.string().min(8).max(128),
  }).safeParse({
    email: String(form.get('email') ?? '').trim().toLowerCase(),
    password: String(form.get('password') ?? ''),
  });
  if (!result.success) redirect('/login?errore=credenziali');

  const db = await database();
  const { error } = await db.auth.signInWithPassword(result.data);
  if (error) redirect('/login?errore=credenziali');
  redirect('/cantieri');
}

export async function signOut() {
  if (!demoMode) {
    const db = await database();
    await db.auth.signOut({ scope: 'local' });
  }
  redirect('/login');
}
