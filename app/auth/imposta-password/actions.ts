'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { database, demoMode, needsInvitationPassword } from '@/lib/backend';

const path = '/auth/imposta-password';
const passwordForm = z.object({ password: z.string().min(8).max(128), confirmation: z.string().max(128) });

export async function setInvitationPassword(form: FormData) {
  if (demoMode) redirect('/');
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  if (!needsInvitationPassword(user)) redirect('/');

  const result = passwordForm.safeParse({ password: form.get('password'), confirmation: form.get('confirmation') });
  if (!result.success) redirect(`${path}?errore=lunghezza`);
  if (result.data.password !== result.data.confirmation) redirect(`${path}?errore=conferma`);

  const changed = await db.auth.updateUser({ password: result.data.password, data: { imprelio_password_pending: false } });
  if (changed.error?.code === 'weak_password') redirect(`${path}?errore=debole`);
  if (changed.error) redirect(`${path}?errore=salvataggio`);

  const { error } = await db.rpc('claim_imprelio_invitations');
  if (error) redirect('/login?errore=rientro');
  redirect('/');
}
