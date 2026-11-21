import type { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { database, demoMode, needsInvitationPassword } from '@/lib/backend';
import { setInvitationPassword } from './actions';

export const metadata: Metadata = { title: 'Imposta password' };
export const dynamic = 'force-dynamic';

const messages: Record<string, string> = {
  lunghezza: 'Scegli una password da 8 a 128 caratteri.',
  conferma: 'Le password inserite devono coincidere.',
  debole: 'Scegli una password più robusta e riprova.',
  salvataggio: 'Impossibile salvare la password. Riprova.',
};

export default async function ImpostaPassword({ searchParams }: { searchParams: Promise<{ errore?: string }> }) {
  if (demoMode) redirect('/');
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  if (!needsInvitationPassword(user)) redirect('/');
  const { errore } = await searchParams;

  return <main className="login-screen">
    <section className="login-panel">
      <Image src="/brand/imprelio-simbolo-originale.png" alt="" width={64} height={64} className="login-logo" unoptimized/>
      <h1>Imposta password</h1>
      <p>Crea la password per attivare l’accesso e rientrare in Imprelio.</p>
      {errore && messages[errore] && <p className="form-error" role="alert">{messages[errore]}</p>}
      <form className="form-grid" action={setInvitationPassword}>
        <label>Nuova password<input required type="password" name="password" minLength={8} maxLength={128} autoComplete="new-password" aria-describedby="password-length"/></label>
        <small id="password-length">Almeno 8 caratteri.</small>
        <label>Conferma password<input required type="password" name="confirmation" minLength={8} maxLength={128} autoComplete="new-password"/></label>
        <button className="button primary">Salva password e accedi <ArrowRight size={17} aria-hidden="true"/></button>
      </form>
    </section>
  </main>;
}
