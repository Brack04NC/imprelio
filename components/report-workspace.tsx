'use client';

import { CalendarCheck, Clock3, Download, HardHat, ListChecks, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import { attendanceKey, localAttendancePeople, localAttendanceRange } from '@/lib/attendance-demo';
import { buildAttendanceReport, type AttendanceReport as AttendanceSummary } from '@/lib/attendance-report';
import { buildBusinessReport, type ReportData, type ReportFilters, type ReportSite } from '@/lib/business-reports';
import { demoBusinessReportData } from '@/lib/business-reports-demo';
import { downloadCsv } from '@/lib/csv-download';
import { demoKey } from '@/lib/demo';
import { formatDate, jobKinds, kindLabels, type Identity } from '@/lib/domain';
import { estimatePricingKey } from '@/lib/estimate-pricing-demo';
import { centsToEuroInput } from '@/lib/finance';
import { operationsKey } from '@/lib/operations-demo';
import { demoTrashKey } from '@/lib/trash-storage';
import { vehicleAssignmentsKey } from '@/lib/vehicle-assignments';
import { AttendanceReport, formatWorkDuration } from './attendance-report';
import { BusinessReportView, StatisticsResources } from './business-report-view';
import { orgLink } from './shell';
import { StatisticsCharts } from './statistics-charts';
import styles from './report-workspace.module.css';

type Report = ReturnType<typeof buildBusinessReport>;
type Mode = 'statistics' | 'balance';
type AttendanceState = { state: 'ready'; report: AttendanceSummary } | { state: 'migration' | 'error' };
const reportKeys = new Set([demoKey, demoTrashKey, operationsKey, estimatePricingKey, vehicleAssignmentsKey]);
const count = new Intl.NumberFormat('it-IT');
const percent = new Intl.NumberFormat('it-IT', { style: 'percent' });

function StatisticsIndicators({ activity, workMinutes }: { activity: Report['activity']; workMinutes?: number }) {
  const completed = activity.jobsCompleted;
  const facts = [
    { label: 'Interventi nel periodo', value: count.format(activity.jobs), note: `${count.format(activity.jobsOverdue)} in ritardo`, Icon: ListChecks },
    { label: 'Completati', value: activity.jobs ? percent.format(completed / activity.jobs) : '—',
      note: activity.jobs ? `${count.format(completed)} su ${count.format(activity.jobs)}` : 'Nessun intervento', Icon: CalendarCheck },
    { label: 'Cantieri attivi', value: count.format(activity.activeSites), note: `${count.format(activity.sites)} in totale`, Icon: HardHat },
    { label: 'Ore lavorate', value: workMinutes === undefined ? '—' : formatWorkDuration(workMinutes), note: 'Da presenze registrate', Icon: Clock3 },
  ];
  return <dl className={styles.statisticsIndicators} aria-label="Indicatori operativi">
    {facts.map(({ label, value, note, Icon }) => <div key={label}>
      <dt><span><Icon size={17} aria-hidden="true"/></span>{label}</dt>
      <dd><strong>{value}</strong><small>{note}</small></dd>
    </div>)}
  </dl>;
}

export function ReportWorkspace({ identity, mode, initial, initialAttendance, sites, filters, today }: {
  identity: Identity; mode: Mode; initial: Report; sites: ReportSite[]; filters: ReportFilters; today: string;
  initialAttendance?: AttendanceState;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState<ReportData | null>(null);
  const [localAttendance, setLocalAttendance] = useState<{ scope: string; value: AttendanceState } | null>(null);
  const [retryAttendance, setRetryAttendance] = useState(0);
  const [filterError, setFilterError] = useState('');
  const scope = useRef<HTMLParagraphElement>(null);
  const focusResult = useRef(false);
  const report = useMemo(() => local ? buildBusinessReport(local, filters, today) : initial, [local, filters, today, initial]);
  const filterScope = `${filters.from}/${filters.to}/${filters.site}`;
  const attendance: AttendanceState | undefined = mode !== 'statistics' ? undefined : identity.demo
    ? localAttendance?.scope === filterScope ? localAttendance.value : undefined
    : initialAttendance;
  const options = local?.sites ?? sites;
  const selected = options.find(site => site.id === filters.site);
  const missingSite = Boolean(filters.site && !selected);
  const siteLabel = selected?.name ?? (missingSite ? 'Cantiere non disponibile' : '');
  const path = mode === 'balance' ? '/gestione/bilanci' : '/gestione/statistiche';
  const statistics = mode === 'statistics';
  const dateLabel = (date: string) => formatDate(date, { day: 'numeric', month: 'long', year: 'numeric' });

  useEffect(() => { setFilterError(''); }, [filters.from, filters.to, filters.site]);

  useEffect(() => {
    if (pending || !focusResult.current) return;
    focusResult.current = false;
    scope.current?.focus({ preventScroll: true });
  }, [pending, filters.from, filters.to, filters.site]);

  useEffect(() => {
    if (!identity.demo) return;
    const sync = () => {
      const data = demoBusinessReportData(today, true);
      setLocal(data);
      if (mode !== 'statistics') return;
      try {
        const report = buildAttendanceReport({
          entries: localAttendanceRange(today, filters.from, filters.to), people: localAttendancePeople(today),
        }, filters, data.sites);
        setLocalAttendance({ scope: filterScope, value: { state: 'ready', report } });
      } catch {
        setLocalAttendance({ scope: filterScope, value: { state: 'error' } });
      }
    };
    const storage = (event: StorageEvent) => {
      if (!event.key || reportKeys.has(event.key) || (mode === 'statistics' && event.key === attendanceKey)) sync();
    };
    sync();
    window.addEventListener('storage', storage);
    window.addEventListener('pageshow', sync);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('pageshow', sync);
    };
  }, [identity.demo, today, mode, filterScope, filters, retryAttendance]);

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
    if (dal === filters.from && al === filters.to && cantiere === filters.site) {
      scope.current?.focus({ preventScroll: true });
      return;
    }
    focusResult.current = true;
    startTransition(() => router.push(orgLink(path + '?' + params, identity), { scroll: false }));
  }

  function exportSummary() {
    const { summary, activity, monthly, activityTrend } = report;
    const euro = centsToEuroInput;
    downloadCsv('imprelio-riepilogo-' + filters.from + '.csv', [
      ['Dal', filters.from, 'Al', filters.to, 'Cantiere', siteLabel || 'Tutti'],
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
      ...(statistics ? [[], ['Interventi per data prevista'],
        ['Dal', 'Al', 'Interventi', 'Completati', 'Aperti nei tempi', 'In ritardo'],
        ...activityTrend.points.map(point => [point.from, point.to, point.total, point.completed,
          point.total - point.completed - point.overdue, point.overdue]),
      ] : []),
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

  const exportActions = <div className={styles.exports}>
    <button type="button" className="button secondary" disabled={pending} onClick={exportSummary}><Download size={16} aria-hidden="true"/> Riepilogo CSV</button>
    <button type="button" className="button secondary" disabled={pending || !report.invoices.length} onClick={exportInvoices}><Download size={16} aria-hidden="true"/> Resoconto fatture CSV</button>
    <button type="button" className="button secondary" disabled={pending} onClick={() => window.print()}><Printer size={16} aria-hidden="true"/> Stampa resoconto</button>
  </div>;

  const siteHref = (id: string) => orgLink(path + '?' + new URLSearchParams({ dal: filters.from, al: filters.to, cantiere: id }), identity);

  return <section className={styles.report} aria-label="Riepilogo e resoconti">
    <div className={`panel ${styles.controls}${statistics ? ` ${styles.statisticsControls}` : ''}`}>
      <form className={styles.filters} onSubmit={applyFilters} onChange={() => { if (filterError) setFilterError(''); }}
        key={`${filters.from}/${filters.to}/${filters.site}/${missingSite}`}>
        <label>Dal<input type="date" name="dal" defaultValue={filters.from} required
          aria-invalid={filterError ? true : undefined} aria-describedby={filterError ? 'report-filter-error' : undefined}/></label>
        <label>Al<input type="date" name="al" defaultValue={filters.to} required
          aria-invalid={filterError ? true : undefined} aria-describedby={filterError ? 'report-filter-error' : undefined}/></label>
        <label><span id="report-site-label">Cantiere</span><select aria-labelledby="report-site-label" name="cantiere" defaultValue={filters.site}>
          <option value="">Tutti i cantieri</option>
          {missingSite && <option value={filters.site} disabled>Cantiere non disponibile</option>}
          {options.map(site => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}
        </select></label>
        <button type="submit" className="button primary" disabled={pending}>{pending ? 'Aggiornamento…' : 'Applica filtri'}</button>
      </form>
      {filterError && <p className="form-error" id="report-filter-error" role="alert">{filterError}</p>}
      {!statistics && exportActions}
    </div>
    <p className={styles.scope} ref={scope} tabIndex={-1}>{dateLabel(filters.from)} – {dateLabel(filters.to)}{siteLabel && ' · ' + siteLabel}</p>
    <div aria-busy={pending} className={statistics ? styles.statistics : undefined}>
      {statistics && <>
        <StatisticsIndicators activity={report.activity} workMinutes={attendance?.state === 'ready' ? attendance.report.summary.workMinutes : undefined}/>
        <StatisticsCharts report={report} siteHref={siteHref}/>
        <StatisticsResources figures={report.activity}/>
      </>}
      {attendance?.state === 'ready' && <AttendanceReport report={attendance.report} filters={filters} siteLabel={siteLabel} pending={pending}/>}
      {attendance?.state === 'migration' && <section className="empty panel" aria-label="Presenze">
        <strong>Presenze in attesa dell’aggiornamento del database</strong><p>Applica in Supabase la migrazione Presenze.</p>
        <a className="button secondary" href="https://github.com/Brack04NC/imprelio/blob/main/supabase/migrations/202611180010_presenze.sql">Apri la migrazione 010</a>
      </section>}
      {attendance?.state === 'error' && <section className="empty panel" aria-label="Presenze">
        <strong>Presenze temporaneamente non disponibili</strong>
        <button type="button" className="button secondary" onClick={() => {
          if (identity.demo) setRetryAttendance(current => current + 1);
          else router.refresh();
        }}>Riprova a caricare le presenze</button>
      </section>}
      <BusinessReportView mode={mode} report={report} filters={filters} today={today}/>
      {statistics && <section className={`panel ${styles.statisticsExports}`} aria-labelledby="report-exports">
        <h2 id="report-exports">Esportazioni e stampa</h2>
        {exportActions}
      </section>}
    </div>
  </section>;
}
