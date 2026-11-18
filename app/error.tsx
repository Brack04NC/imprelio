'use client';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="login-screen"><section className="login-panel">
    <h1>Impossibile caricare la pagina</h1>
    <p>Controlla la connessione e riprova.</p>
    <button className="button primary" onClick={reset}>Riprova</button>
  </section></main>;
}
