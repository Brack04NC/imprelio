'use client';

import { Download, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition, type FormEvent } from 'react';
import { buildBusinessReport, type ReportData, type ReportFilters, type ReportSite } from '@/lib/business-reports';
import { demoBusinessReportData } from '@/lib/business-reports-demo';
import { downloadCsv } from '@/lib/csv-download';
import { demoKey } from '@/lib/demo';
import { formatDate, jobKinds, kindLabels, type Identity } from '@/lib/domain';
import { estimatePricingKey } from '@/lib/estimate-pricing-demo';
import { centsToEuroInput } from '@/lib/finance';
import { operationsKey } from '@/lib/operations-demo';
import { vehicleAssignmentsKey } from '@/lib/vehicle-assignments';
import { BusinessReportView } from './business-report-view';
import { orgLink } from './shell';
import styles from './report-workspace.module.css';

type Report = ReturnType<typeof buildBusinessReport>;
type Mode = 'statistics' | 'balance';
const reportKeys = new Set([demoKey, operationsKey, estimatePricingKey, vehicleAssignmentsKey]);

export function ReportWorkspace({ identity, mode, initial, sites, filters, today }: {
  identity: Identity; mode: Mode; initial: Report; sites: ReportSite[]; filters: ReportFilters; today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState<ReportData | null>(null);
  const [filterError, setFilterError] = useState('');
  const report = useMemo(() => local ? buildBusinessReport(local, filters, today) : initial, [local, filters, today, initial]);
  const options = local?.sites ?? sites;
  const selected = options.find(site => site.id === filters.site);
  const path = mode === 'balance' ? '/gestione/bilanci' : '/gestione/statistiche';
  const dateLabel = (date: string) => formatDate(date, { day: 'numeric', month: 'long', year: 'numeric' });

  useEffect(() => {
    if (!identity.demo) return;
    const sync = () => setLocal(demoBusinessReportData(today, true));
    const storage = (event: StorageEvent) => { if (!event.key || reportKeys.has(event.key)) sync(); };
    sync();
    window.addEventListener('storage', storage);
    window.addEventListener('pageshow', sync);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('pageshow', sync);
    };
  }, [identity.demo, today]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const dal = String(values.get('dal') ?? '');
    const al = String(values.get('al') ?? '');
    if (dal > al) {
      setFilterError('La data iniziale deve precedere o coincidere con la data finale.');
      return;
    }
    setFilterError('');
    const params = new URLSearchParams({ dal, al });
    const cantiere = String(values.get('cantiere') ?? '');
    if (cantiere) params.set('cantiere', cantiere);
    startTransition(() => router.push(orgLink(path + '?' + params, identity), { scroll: false }));
  }

  function exportSummary() {
    const { summary, activity, monthly } = report;
    const euro = centsToEuroInput;
    downloadCsv('imprelio-riepilogo-' + filters.from + '.csv', [
      ['Dal', filters.from, 'Al', filters.to, 'Cantiere', selected?.name ?? 'Tutti'],
      ['Indicatore', 'Valore'],
      ['Ricavi imponibili (EUR)', euro(summary.revenue)],
      ['Costi imponibili (EUR)', euro(summary.cost)],
      ['Margine su fatture (EUR)', euro(summary.balance)],
      ['IVA fatture emesse (EUR)', euro(summary.revenueVat)],
      ['IVA fatture ricevute (EUR)', euro(summary.costVat)],
      ['Totale fatture emesse IVA inclusa (EUR)', euro(summary.revenueGross)],
      ['Totale fatture ricevute IVA inclusa (EUR)', euro(summary.costGross)],
      ['Da incassare IVA inclusa (EUR)', euro(summary.receivables)],
      ['Da pagare IVA inclusa (EUR)', euro(summary.payables)],
      ['Crediti scaduti IVA inclusa (EUR)', euro(summary.overdueReceivables)],
      ['Debiti scaduti IVA inclusa (EUR)', euro(summary.overduePayables)],
      ['Incassi registrati IVA inclusa (EUR)', euro(summary.collected)],
      ['Pagamenti registrati IVA inclusa (EUR)', euro(summary.paid)],
      ['Bozze fatture', summary.drafts], ['Fatture incomplete', summary.incomplete],
      ['Fatture saldate senza data di saldo', summary.missingPaidDate],
      ...(mode === 'statistics' ? [
        ['Cantieri totali', activity.sites], ['Cantieri attivi', activity.activeSites], ['Clienti collegati ai cantieri', activity.clients],
        ['Interventi nel periodo', activity.jobs], ['Interventi completati', activity.jobsCompleted],
        ['Interventi in ritardo', activity.jobsOverdue], ['Ordini', activity.orders],
        ['DDT', activity.ddt], ['Computi metrici', activity.estimates], ['Preventivi da PDF', activity.quotes],
        ['Dipendenti', activity.employees], ['Operai', activity.workers], ['Squadre', activity.crews],
        ['Veicoli assegnati', activity.vehiclesAssigned], ['Articoli di magazzino', activity.stockArticles],
        ['Articoli sotto scorta minima', activity.lowStock],
        ...jobKinds.map(kind => ['Interventi · ' + kindLabels[kind], activity.jobsByKind[kind]]),
      ] : []),
      [],
      ['Mese', 'Ricavi imponibili (EUR)', 'Costi imponibili (EUR)', 'Margine su fatture (EUR)'],
      ...monthly.map(month => [month.month, euro(month.revenue), euro(month.cost), euro(month.balance)]),
      [],
      ['Cantiere', 'Cliente', 'Ricavi imponibili (EUR)', 'Costi imponibili (EUR)', 'Margine su fatture (EUR)', 'Fatture', 'Interventi'],
      ...report.sites.map(site => [site.name, site.client, euro(site.revenue), euro(site.cost), euro(site.balance), site.invoiceCount, site.jobCount]),
    ]);
  }

  function exportInvoices() {
    const euro = (value: bigint | null) => value === null ? '' : centsToEuroInput(value);
    const stateLabels: Record<string, string> = { open: 'Da saldare', paid: 'Saldata', draft: 'Bozza' };
    downloadCsv('imprelio-resoconto-fatture-' + filters.from + '.csv', [
      ['Data fattura', 'Numero', 'Controparte', 'Tipo', 'Cantiere', 'Stato', 'Da completare', 'Scadenza', 'Data saldo', 'Imponibile (EUR)', 'IVA (EUR)', 'Totale (EUR)'],
      ...report.invoices.map(invoice => [
        invoice.date, invoice.title, invoice.party,
        invoice.direction === 'incoming' ? 'Ricevuta' : invoice.direction === 'outgoing' ? 'Emessa' : 'Da verificare',
        invoice.siteName, invoice.overdue ? 'Scaduta' : stateLabels[invoice.status ?? ''] ?? 'Da verificare',
        invoice.incomplete ? 'Sì' : '', invoice.dueDate, invoice.paidDate, euro(invoice.net), euro(invoice.vat), euro(invoice.gross),
      ]),
    ]);
  }

  return <section className={styles.report} aria-label="Riepilogo e resoconti">
    <div className={`panel ${styles.controls}`}>
      <form className={styles.filters} onSubmit={applyFilters} key={`${filters.from}/${filters.to}/${filters.site}`}>
        <label>Dal<input type="date" name="dal" defaultValue={filters.from} required/></label>
        <label>Al<input type="date" name="al" defaultValue={filters.to} required/></label>
        <label><span id="report-site-label">Cantiere</span><select aria-labelledby="report-site-label" name="cantiere" defaultValue={filters.site}>
          <option value="">Tutti i cantieri</option>
          {options.map(site => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}
        </select></label>
        <button type="submit" className="button primary" disabled={pending}>{pending ? 'Aggiornamento…' : 'Applica filtri'}</button>
      </form>
      {filterError && <p className="form-error" role="alert">{filterError}</p>}
      <div className={styles.exports}>
        <button type="button" className="button secondary" disabled={pending} onClick={exportSummary}><Download size={16}/> Riepilogo CSV</button>
        <button type="button" className="button secondary" disabled={pending || !report.invoices.length} onClick={exportInvoices}><Download size={16}/> Resoconto fatture CSV</button>
        <button type="button" className="button secondary" disabled={pending} onClick={() => window.print()}><Printer size={16}/> Stampa resoconto</button>
      </div>
    </div>
    <p className={styles.scope}>{dateLabel(filters.from)} – {dateLabel(filters.to)}{selected && ' · ' + selected.name}</p>
    <div aria-busy={pending}><BusinessReportView mode={mode} report={report} filters={filters} today={today}/></div>
  </section>;
}
