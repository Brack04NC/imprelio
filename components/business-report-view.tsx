import { ArrowDownLeft, ArrowUpRight, BarChart3, CalendarClock, HardHat, ReceiptText, Scale, Users, Wallet, type LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { buildBusinessReport, ReportFilters } from '@/lib/business-reports';
import { formatDate } from '@/lib/domain';
import { formatEuro } from '@/lib/operation-documents';
import styles from './business-report.module.css';

type Report = ReturnType<typeof buildBusinessReport>;
type Invoice = Report['invoices'][number];

const count = new Intl.NumberFormat('it-IT');

function dayLabel(day: string | null | undefined) {
  if (!day) return '—';
  return <time dateTime={day}>{formatDate(day, {day: '2-digit', month: '2-digit', year: 'numeric'})}</time>;
}

function money(value: bigint | null | undefined) {
  return value === null || value === undefined ? '—' : formatEuro(value);
}

function netTone(value: bigint) {
  return value < 0n ? styles.loss : value > 0n ? styles.gain : undefined;
}

function Panel({ id, title, description, Icon, children }: {
  id: string; title: string; description?: string; Icon: LucideIcon; children: ReactNode;
}) {
  return <section className={styles.panel} aria-labelledby={id}>
    <header className={styles.panelHeader}>
      <span className={styles.panelIcon}><Icon size={19} aria-hidden="true"/></span>
      <div><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div>
    </header>
    {children}
  </section>;
}

function Metric({ Icon, label, value, note, tone }: {
  Icon: LucideIcon; label: string; value: bigint; note: string; tone?: 'balance' | 'revenue' | 'cost';
}) {
  return <div className={styles.metric} data-tone={tone}>
    <dt><span className={styles.metricIcon}><Icon size={18} aria-hidden="true"/></span>{label}</dt>
    <dd><strong className={tone === 'balance' && value < 0n ? styles.balanceLoss : undefined}>{money(value)}</strong><small>{note}</small></dd>
  </div>;
}

function MonthlyReport({ monthly, omittedEmpty, summary }: {
  monthly: Report['monthly']; omittedEmpty: boolean; summary: Report['summary'];
}) {
  const max = monthly.reduce((highest, month) => [month.revenue, month.cost, highest].reduce((a, b) => a > b ? a : b), 0n);
  const barHeight = (value: bigint) => max > 0n && value > 0n ? (Number(value * 10000n / max) / 100) + '%' : '0%';
  return <Panel id="report-months" title="Ricavi e costi per mese" Icon={BarChart3}
    description={omittedEmpty ? 'Imponibili raggruppati per data fattura. Nei periodi oltre dieci anni compaiono i mesi con fatture valide.'
      : 'Imponibili raggruppati per data fattura.'}>
    <dl className={styles.monthlyTotals} aria-label="Totali fatturati, IVA esclusa">
      <div><dt>Ricavi fatturati</dt><dd>{money(summary.revenue)}</dd></div>
      <div><dt>Costi fatturati</dt><dd>{money(summary.cost)}</dd></div>
      <div><dt>Saldo fatturato</dt><dd className={netTone(summary.balance)}>{money(summary.balance)}</dd></div>
    </dl>
    {!monthly.length ? <p className={styles.empty}>Nessun importo fatturato nel periodo.</p> : <>
      {max > 0n ? <div className={styles.chartBlock}>
        <div className={styles.legend} aria-hidden="true">
          <span><i className={styles.revenueBar}/> Ricavi</span><span><i className={styles.costBar}/> Costi</span>
        </div>
        <div className={styles.chartScroll} role="region" aria-label="Grafico dei mesi, scorrimento orizzontale" tabIndex={0}>
          <div className={styles.chart} style={{ '--months': monthly.length } as CSSProperties} aria-hidden="true">
            {monthly.map(month => <div className={styles.month} key={month.month}>
              <div className={styles.barPair}>
                <span className={styles.revenueBar} style={{height: barHeight(month.revenue)}} title={money(month.revenue)}/>
                <span className={styles.costBar} style={{height: barHeight(month.cost)}} title={money(month.cost)}/>
              </div>
              <span className={styles.monthLabel}>{formatDate(month.month + '-01', {month: 'short', year: '2-digit'})}</span>
            </div>)}
          </div>
        </div>
      </div> : <p className={styles.empty}>Nessun importo fatturato nel periodo.</p>}
      <details className={styles.dataDetails}>
        <summary>Dati per mese</summary>
        <div className={styles.tableScroll} role="region" aria-label="Dati mensili" tabIndex={0}>
          <table className={styles.table}>
            <caption className="sr-only">Ricavi, costi e saldo per mese, IVA esclusa</caption>
            <thead><tr><th scope="col">Mese</th><th scope="col" className={styles.numeric}>Ricavi</th>
              <th scope="col" className={styles.numeric}>Costi</th><th scope="col" className={styles.numeric}>Saldo</th></tr></thead>
            <tbody>{monthly.map(month => <tr key={month.month}>
              <th scope="row" className={styles.capital}>{formatDate(month.month + '-01', {month: 'long', year: 'numeric'})}</th>
              <td className={styles.numeric}>{money(month.revenue)}</td><td className={styles.numeric}>{money(month.cost)}</td>
              <td className={`${styles.numeric} ${netTone(month.balance) ?? ''}`}>{money(month.balance)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>
    </>}
  </Panel>;
}

function SiteMargins({ sites }: { sites: Report['sites'] }) {
  return <Panel id="report-site-margins" title="Margini per cantiere" Icon={HardHat}
    description="Ricavi meno costi fatturati, IVA esclusa.">
    {!sites.length ? <p className={styles.empty}>Nessun cantiere in questo riepilogo.</p> :
      <div className={styles.tableScroll} role="region" aria-label="Margini per cantiere, scorrimento orizzontale" tabIndex={0}>
        <table className={`${styles.table} ${styles.siteTable}`}>
          <thead><tr><th scope="col">Cantiere</th><th scope="col" className={styles.numeric}>Ricavi</th>
            <th scope="col" className={styles.numeric}>Costi</th><th scope="col" className={styles.numeric}>Margine</th>
            <th scope="col" className={styles.numeric}>Fatture</th><th scope="col" className={styles.numeric}>Interventi</th></tr></thead>
          <tbody>{sites.map(site => <tr key={site.id || 'unassigned'}>
            <th scope="row"><strong>{site.name || 'Senza cantiere'}</strong>
              {(site.city || site.client) && <small>{[site.city, site.client].filter(Boolean).join(' · ')}</small>}</th>
            <td className={styles.numeric}>{money(site.revenue)}</td><td className={styles.numeric}>{money(site.cost)}</td>
            <td className={`${styles.numeric} ${netTone(site.balance) ?? ''}`}>{money(site.balance)}</td>
            <td className={styles.numeric}>{count.format(site.invoiceCount)}</td><td className={styles.numeric}>{count.format(site.jobCount)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
  </Panel>;
}

export function StatisticsResources({ figures }: { figures: Report['activity'] }) {
  const items = [
    { label: 'Clienti', value: figures.clients, hint: 'Collegati ai cantieri' },
    { label: 'Ordini', value: figures.orders }, { label: 'DDT', value: figures.ddt },
    { label: 'Computi metrici', value: figures.estimates }, { label: 'Preventivi da PDF', value: figures.quotes },
    { label: 'Dipendenti', value: figures.employees }, { label: 'Operai', value: figures.workers },
    { label: 'Squadre', value: figures.crews }, { label: 'Veicoli assegnati', value: figures.vehiclesAssigned,
      hint: figures.vehiclesAssigned === null ? 'Dati sulle assegnazioni non disponibili' : undefined },
    { label: 'Magazzino aziendale', value: figures.stockArticles, hint: `${count.format(figures.lowStock)} articoli sotto scorta minima` },
  ];
  return <Panel id="report-activity" title="Risorse e documenti" Icon={Users}
    description="Documenti del periodo. Anagrafiche, assegnazioni e magazzino allo stato attuale.">
    <dl className={styles.activityGrid}>
      {items.map(item => <div key={item.label}>
        <dt>{item.label}</dt><dd><strong>{item.value === null ? '—' : count.format(item.value)}</strong>{item.hint && <small>{item.hint}</small>}</dd>
      </div>)}
    </dl>
  </Panel>;
}

function CashStatus({ summary, today, settled }: { summary: Report['summary']; today: string; settled: Invoice[] }) {
  return <Panel id="report-cash" title="Incassi, pagamenti e scadenze" Icon={Wallet}
    description="Importi IVA inclusa. Incassi e pagamenti seguono la data di saldo. Crediti e debiti aperti si riferiscono alle fatture del periodo.">
    <dl className={styles.cashGrid}>
      <div><dt>Incassi registrati</dt><dd><strong>{money(summary.collected)}</strong><small>Fatture emesse con data di saldo nel periodo</small></dd></div>
      <div><dt>Pagamenti registrati</dt><dd><strong>{money(summary.paid)}</strong><small>Fatture ricevute con data di saldo nel periodo</small></dd></div>
      <div><dt>Crediti aperti</dt><dd><strong>{money(summary.receivables)}</strong>
        <small className={summary.overdueReceivables > 0n ? styles.overdue : undefined}>{money(summary.overdueReceivables)} scaduti</small></dd></div>
      <div><dt>Debiti aperti</dt><dd><strong>{money(summary.payables)}</strong>
        <small className={summary.overduePayables > 0n ? styles.overdue : undefined}>{money(summary.overduePayables)} scaduti</small></dd></div>
    </dl>
    <p className={styles.panelNote}><CalendarClock size={15} aria-hidden="true"/> Scadenze rilevate al {dayLabel(today)}.</p>
    {summary.missingPaidDate > 0 && <ul className={styles.quality} aria-label="Dati sui pagamenti da verificare">
      <li>Fatture saldate senza data di saldo · {count.format(summary.missingPaidDate)}</li>
    </ul>}
    {settled.length > 0 && <details className={styles.dataDetails}>
      <summary>Dettaglio incassi e pagamenti ({count.format(settled.length)})</summary>
      <InvoiceTable rows={settled} id="Incassi e pagamenti per data di saldo"/>
    </details>}
  </Panel>;
}

function Breakdown({ summary }: { summary: Report['summary'] }) {
  return <div className={styles.breakdown}>
    <div><h3>Fatture emesse</h3><dl>
      <div><dt>Imponibile</dt><dd>{money(summary.revenue)}</dd></div>
      <div><dt>IVA</dt><dd>{money(summary.revenueVat)}</dd></div>
      <div><dt>Totale lordo</dt><dd>{money(summary.revenueGross)}</dd></div>
    </dl></div>
    <div><h3>Fatture ricevute</h3><dl>
      <div><dt>Imponibile</dt><dd>{money(summary.cost)}</dd></div>
      <div><dt>IVA</dt><dd>{money(summary.costVat)}</dd></div>
      <div><dt>Totale lordo</dt><dd>{money(summary.costGross)}</dd></div>
    </dl></div>
  </div>;
}

function invoiceStatus(row: Invoice) {
  if (row.overdue) return 'Scaduta';
  if (row.status === 'paid') return 'Saldata';
  if (row.status === 'draft') return 'Bozza';
  return row.status === 'open' ? 'Da saldare' : 'Stato da verificare';
}

function InvoiceTable({ rows, id }: { rows: Invoice[]; id: string }) {
  return <div className={styles.tableScroll} role="region" aria-label={id} tabIndex={0}>
    <table className={`${styles.table} ${styles.invoiceTable}`}>
      <thead><tr><th scope="col">Fattura</th><th scope="col">Tipo e stato</th><th scope="col">Data fattura</th>
        <th scope="col">Scadenza</th><th scope="col">Data saldo</th><th scope="col" className={styles.numeric}>Imponibile</th>
        <th scope="col" className={styles.numeric}>IVA</th><th scope="col" className={styles.numeric}>Lordo</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <th scope="row"><strong>{row.title}</strong><small>{[row.party, row.siteName].filter(Boolean).join(' · ')}</small></th>
        <td><span>{row.direction === 'incoming' ? 'Ricevuta' : row.direction === 'outgoing' ? 'Emessa' : 'Tipo da verificare'}</span>
          <small className={`${styles.invoiceStatus} ${row.overdue ? styles.overdue : ''}`}>{invoiceStatus(row)}</small>
          {row.incomplete && <small className={styles.overdue}>Incompleta</small>}</td>
        <td>{dayLabel(row.date)}</td><td>{dayLabel(row.dueDate)}</td><td>{dayLabel(row.paidDate)}</td>
        <td className={styles.numeric}>{money(row.net)}</td><td className={styles.numeric}>{money(row.vat)}</td>
        <td className={styles.numeric}>{money(row.gross)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function Documents({ report, balance }: { report: Report; balance: boolean }) {
  const { invoices, summary } = report;
  const shown = 12;
  return <Panel id="report-documents" title="Fatture del periodo" Icon={ReceiptText}
    description="La tabella segue la data fattura e include le schede senza data da completare.">
    {balance && <Breakdown summary={summary}/>}
    {(summary.drafts > 0 || summary.incomplete > 0) && <ul className={styles.quality} aria-label="Dati da verificare">
      {summary.drafts > 0 && <li>Bozze · {count.format(summary.drafts)}</li>}
      {summary.incomplete > 0 && <li>Fatture incomplete · {count.format(summary.incomplete)}</li>}
    </ul>}
    {!invoices.length ? <p className={styles.empty}>Nessuna fattura trovata per questi filtri.</p> : <>
      <InvoiceTable rows={invoices.slice(0, shown)} id="Dettaglio fatture, scorrimento orizzontale"/>
      {invoices.length > shown && <details className={styles.dataDetails}>
        <summary>Altre fatture ({count.format(invoices.length - shown)})</summary>
        <InvoiceTable rows={invoices.slice(shown)} id="Altre fatture, scorrimento orizzontale"/>
      </details>}
    </>}
  </Panel>;
}

export function BusinessReportView({ mode, report, filters, today }: {
  mode: 'statistics' | 'balance'; report: Report; filters: ReportFilters; today: string;
}) {
  const { summary } = report;
  const limitations = <p className={styles.scope}><ReceiptText size={15} aria-hidden="true"/>
    {filters.site ? 'Riepilogo dalle fatture registrate per il cantiere selezionato.' : 'Riepilogo dalle fatture registrate in azienda.'}
    {' '}Bozze e importi incompleti sono riepilogati a parte.</p>;
  const details = <>
    {limitations}
    <CashStatus summary={summary} today={today} settled={report.settledInvoices}/>
    <SiteMargins sites={report.sites}/>
    <Documents report={report} balance={mode === 'balance'}/>
  </>;

  if (mode === 'statistics') return <div className={styles.report}>
    <MonthlyReport monthly={report.monthly} omittedEmpty={report.monthlyOmittedEmpty} summary={summary}/>
    <details className={`${styles.panel} ${styles.economicDetails}`}>
      <summary><ReceiptText size={18} aria-hidden="true"/> Dettaglio economico e fatture</summary>
      <div className={styles.report}>{details}</div>
    </details>
  </div>;

  return <div className={styles.report}>
    <dl className={styles.metrics} aria-label="Indicatori del fatturato, IVA esclusa">
      <Metric Icon={ArrowUpRight} label="Ricavi fatturati" value={summary.revenue} note="Imponibile delle fatture emesse" tone="revenue"/>
      <Metric Icon={ArrowDownLeft} label="Costi fatturati" value={summary.cost} note="Imponibile delle fatture ricevute" tone="cost"/>
      <Metric Icon={Scale} label="Saldo fatturato" value={summary.balance} note="Ricavi meno costi, IVA esclusa" tone="balance"/>
    </dl>
    {details}
  </div>;
}
