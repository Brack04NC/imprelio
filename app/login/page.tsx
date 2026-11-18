import Link from 'next/link';
import { ArrowRight, Building2 } from 'lucide-react';
import { demoMode } from '@/lib/backend';
import { signIn, signOut } from './actions';

const messages: Record<string, string> = {
  accesso: 'Il tuo account non ha accesso a un’azienda. Contatta il tuo amministratore.',
  link: 'Il link è scaduto o è già stato usato. Richiedine uno nuovo.',
  attivazione: 'L’attivazione dell’accesso non è riuscita. Richiedi un nuovo link e riprova.',
  email: 'Inserisci un indirizzo email valido.',
  attendi: 'Attendi un minuto prima di richiedere un altro link.',
  invio: 'Invio non riuscito. Riprova tra poco.',
};

export default async function Login({ searchParams }: { searchParams: Promise<{ errore?: string; inviato?: string }> }) {
  const { errore, inviato } = await searchParams;
  return <main className="login-screen">
    <section className="login-panel">
      <span className="brand-icon"><Building2 size={23} /></span>
      <h1>Accedi a Imprelio</h1>
      {errore && messages[errore] && <p className="form-error" role="alert">{messages[errore]}</p>}
      {inviato && <p role="status">Se l’indirizzo è abilitato, riceverai un link per accedere.</p>}
      {demoMode ? <Link className="button primary" href="/cantieri">Apri la demo <ArrowRight size={17} /></Link> :
        <form className="form-grid" action={signIn}>
          <label>Email aziendale<input required type="email" name="email" placeholder="nome@azienda.it" maxLength={254} autoComplete="email" /></label>
          <button className="button primary">Invia link di accesso <ArrowRight size={17} /></button>
        </form>}
      {errore === 'accesso' && <form action={signOut}><button className="button secondary">Esci</button></form>}
    </section>
  </main>;
}
