import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, CircleAlert, Info } from 'lucide-react';
import { demoMode } from '@/lib/backend';
import { signIn, signOut } from './actions';
import tones from '@/components/notice-tones.module.css';

export const metadata: Metadata = { title: 'Accedi' };

const messages: Record<string, string> = {
  accesso: 'Il tuo account non ha accesso a un’azienda. Contatta il tuo amministratore.',
  link: 'Il link è scaduto o è già stato usato. Se hai già scelto una password, accedi qui sotto. Per il primo accesso chiedi un nuovo invito all’amministratore.',
  attivazione: 'Impossibile attivare l’accesso all’azienda. Riprova ad accedere. Se il problema persiste, contatta il tuo amministratore.',
  rientro: 'Password salvata. Accedi con la nuova password per completare l’attivazione.',
  email: 'Inserisci un indirizzo email valido.',
  attendi: 'Attendi un minuto prima di richiedere un altro link.',
  invio: 'Invio non riuscito. Riprova tra poco.',
  credenziali: 'Email o password non corretti.',
};

export default async function Login({ searchParams }: { searchParams: Promise<{ errore?: string }> }) {
  const { errore } = await searchParams;
  const message = typeof errore === 'string' && Object.hasOwn(messages, errore) ? messages[errore] : '';
  const passwordSaved = errore === 'rientro';
  const MessageIcon = passwordSaved ? Info : CircleAlert;
  return <main className="login-screen">
    <section className="login-panel">
      <Image src="/brand/imprelio-simbolo-originale.png" alt="" width={64} height={64} className="login-logo" unoptimized/>
      <h1>Accedi a Imprelio</h1>
      {message && <p className={`login-feedback ${passwordSaved ? tones.info : tones.danger}`} role={passwordSaved ? 'status' : 'alert'}>
        <MessageIcon size={19} aria-hidden="true"/>{message}
      </p>}
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
