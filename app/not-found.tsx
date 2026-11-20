import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = { title: 'Pagina non disponibile' };

export default function NotFound() {
  return <main className="login-screen"><section className="login-panel">
    <h1>Pagina non disponibile</h1>
    <p>La pagina potrebbe essere stata spostata o non essere accessibile con il tuo profilo.</p>
    <Link className="button primary" href="/cantieri"><ArrowLeft size={17} /> Torna ai cantieri</Link>
  </section></main>;
}
