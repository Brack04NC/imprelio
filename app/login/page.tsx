import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { demoMode } from '@/lib/backend';
import { signIn, signOut } from './actions';

export const metadata: Metadata = { title: 'Accedi' };

const messages: Record<string, string> = {
  accesso: 'Il tuo account non ha accesso a un’azienda. Contatta il tuo amministratore.',
  link: 'Il link è scaduto o è già stato usato. Richiedine uno nuovo.',
  attivazione: 'L’attivazione dell’accesso non è riuscita. Richiedi un nuovo link e riprova.',
  email: 'Inserisci un indirizzo email valido.',
  attendi: 'Attendi un minuto prima di richiedere un altro link.',
  invio: 'Invio non riuscito. Riprova tra poco.',
  credenziali: 'Email o password non corretti.',
};

export default async function Login({ searchParams }: { searchParams: Promise<{ errore?: string }> }) {
  const { errore } = await searchParams;
  return <main className="login-screen">
    <section className="login-panel">
      <Image src="/brand/imprelio-simbolo-originale.png" alt="" width={64} height={64} className="login-logo" unoptimized/>
      <h1>Accedi a Imprelio</h1>
      {errore && messages[errore] && <p className="form-error" role="alert">{messages[errore]}</p>}
      {demoMode ? <Link className="button primary" href="/">Apri la demo <ArrowRight size={17} /></Link> :
        <form className="form-grid" action={signIn}>
          <label>Email aziendale<input required type="email" name="email" placeholder="nome@azienda.it" maxLength={254} autoComplete="email" /></label>
          <label>Password<input required type="password" name="password" minLength={8} maxLength={128} autoComplete="current-password" /></label>
          <button className="button primary">Accedi <ArrowRight size={17} /></button>
        </form>}
      {errore === 'accesso' && <form action={signOut}><button className="button secondary">Esci</button></form>}
    </section>
  </main>;
}
