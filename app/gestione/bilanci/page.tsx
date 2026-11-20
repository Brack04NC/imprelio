import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, ReceiptText } from 'lucide-react';
import { redirect } from 'next/navigation';
import { BusinessReportSection } from '@/components/business-report-section';
import { FinanceLedger } from '@/components/finance-ledger';
import { Shell } from '@/components/shell';
import styles from '@/components/report-workspace.module.css';
import { session } from '@/lib/backend';
import { romeDate } from '@/lib/domain';
import { financeSamples } from '@/lib/finance';
import { isFinanceMigrationMissing, readFinance } from '@/lib/finance-backend';
import { operationSites } from '@/lib/operations-backend';
import { demoSiteOptions } from '@/lib/operations-demo';

type BilanciProps = {
  searchParams: Promise<{ azienda?: string; vista?: string; dal?: string; al?: string; cantiere?: string }>;
};

export async function generateMetadata({ searchParams }: BilanciProps): Promise<Metadata> {
  const { vista } = await searchParams;
  return { title: vista === 'estratti' ? 'Estratti conto' : 'Bilancio gestionale' };
}

export default async function Bilanci({ searchParams }: BilanciProps) {
  const query = await searchParams;
  const { identity, db, signedIn } = await session(typeof query.azienda === 'string' ? query.azienda : null);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  const today = romeDate();
  const statement = query.vista === 'estratti';
  const scope = new URLSearchParams(identity.orgs.length > 1 ? { azienda: identity.org.id } : {});
  for (const key of ['dal', 'al', 'cantiere'] as const) {
    if (typeof query[key] === 'string') scope.set(key, query[key]);
  }
  const balanceHref = '/gestione/bilanci' + (scope.size ? '?' + scope : '');
  scope.set('vista', 'estratti');
  const statementHref = '/gestione/bilanci?' + scope;
  const [ledger, sites] = statement ? (db ? await Promise.all([
    readFinance(db, identity.org.id).catch((error: unknown) => {
      if (isFinanceMigrationMissing(error)) return null;
      throw error;
    }),
    operationSites(db, identity.org.id),
  ]) : [financeSamples(today), demoSiteOptions(today)]) : [null, []];

  return <Shell identity={identity} section="bilanci">
    <header className="page-header">
      <div><h1>Bilanci e conti</h1><p>Consulta il bilancio gestionale e registra i movimenti dei conti.</p></div>
    </header>
    <nav className={styles.financeNavigation} aria-label="Schede di contabilità">
      <Link className="button secondary" href={balanceHref} aria-current={statement ? undefined : 'page'}><BookOpen size={17}/> Bilancio gestionale</Link>
      <Link className="button secondary" href={statementHref} aria-current={statement ? 'page' : undefined}><ReceiptText size={17}/> Estratti conto</Link>
    </nav>
    {statement ? ledger ? <FinanceLedger key={identity.org.id} identity={identity} initial={ledger} sites={sites} today={today}/>
      : <section className="empty panel">
        <strong>Attiva Estratti conto su Supabase</strong>
        <p>Esegui la migrazione 007 nel SQL Editor per creare il registro privato di conti e movimenti aziendali.</p>
        <Link href="https://github.com/Brack04NC/imprelio/blob/main/supabase/migrations/202611180007_contabilita.sql" className="button secondary">Apri la migrazione 007</Link>
      </section> : <BusinessReportSection identity={identity} db={db} today={today} mode="balance" query={query}/>}
  </Shell>;
}
