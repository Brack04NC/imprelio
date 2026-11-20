import { Activity, ArrowUpRight, ChartNoAxesColumnIncreasing, ChevronLeft, ChevronRight, HardHat, Layers3, PieChart, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import type { buildBusinessReport } from '@/lib/business-reports';
import { formatDate, jobKinds, kindLabels } from '@/lib/domain';
import styles from './statistics-charts.module.css';

type Report = ReturnType<typeof buildBusinessReport>;
type Trend = Report['activityTrend'];
type TrendPoint = Trend['points'][number];
type InterventionTotals = Pick<TrendPoint, 'total' | 'completed' | 'overdue'>;

const pageSize = 12;
const integer = new Intl.NumberFormat('it-IT');
const periodDate = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const statuses = [
  { key: 'completed', label: 'Completati' },
  { key: 'onTime', label: 'Aperti nei tempi' },
  { key: 'overdue', label: 'In ritardo' },
] as const;
const groupLabels: Record<Trend['granularity'], string> = { day: 'giorno', week: 'settimana', month: 'mese', year: 'anno' };

function statusValues({ total, completed, overdue }: InterventionTotals) {
  return { completed, onTime: total - completed - overdue, overdue };
}

function shortPeriod(point: TrendPoint, granularity: Trend['granularity']) {
  if (granularity === 'year') return point.from.slice(0, 4);
  if (granularity === 'month') return formatDate(point.from, { month: 'short', year: '2-digit' });
  return formatDate(point.from, { day: 'numeric', month: 'short' });
}

function fullPeriod({ from, to }: TrendPoint) {
  const start = periodDate.format(new Date(from + 'T12:00:00Z'));
  return from === to ? start : `${start} – ${periodDate.format(new Date(to + 'T12:00:00Z'))}`;
}

function percentage(value: number, total: number) {
  return total ? `${value / total * 100}%` : '0%';
}

function ChartPanel({ title, description, Icon, children, className }: {
  title: string; description: string; Icon: LucideIcon; children: ReactNode; className?: string;
}) {
  const heading = useId();
  return <section className={`panel ${styles.card}${className ? ` ${className}` : ''}`} aria-labelledby={heading}>
    <header className={styles.heading}>
      <span className={styles.icon}><Icon size={18} aria-hidden="true"/></span>
      <div><h2 id={heading}>{title}</h2><p>{description}</p></div>
    </header>
    {children}
  </section>;
}

function ChartEmpty({ children }: { children: ReactNode }) {
  return <p className={styles.empty}><Activity size={18} aria-hidden="true"/>{children}</p>;
}

function LegendMark({ status }: { status: typeof statuses[number]['key'] }) {
  return <span aria-hidden="true" className={styles.mark} data-status={status}/>;
}

function InterventionTrend({ trend, total }: { trend: Trend; total: number }) {
  const [page, setPage] = useState<number | null>(null);
  const [selected, setSelected] = useState('');
  const detail = useId();
  const pages = Math.max(1, Math.ceil(trend.points.length / pageSize));
  const firstWithActivity = trend.points.findIndex(point => point.total > 0);
  const currentPage = Math.min(page ?? Math.floor(Math.max(0, firstWithActivity) / pageSize), pages - 1);
  const offset = currentPage * pageSize;
  const points = trend.points.slice(offset, offset + pageSize);
  const active = points.find(point => point.key === selected) ?? points.find(point => point.total > 0) ?? points[0];
  const peak = trend.points.reduce((max, point) => Math.max(max, point.total), 0);
  const step = Math.max(1, Math.ceil(peak / 4));
  const ticks = [4, 3, 2, 1, 0].map(index => index * step);
  const values = active ? statusValues(active) : null;

  return <ChartPanel title="Andamento degli interventi" Icon={ChartNoAxesColumnIncreasing} className={styles.trend}
    description={`Interventi per data prevista. Raggruppamento per ${groupLabels[trend.granularity]}.`}>
    {total && active && values ? <>
      <div className={styles.screenTrend}>
        <ul className={styles.legend} aria-label="Legenda del grafico" role="list">
          {statuses.map(({ key, label }) => <li key={key}><LegendMark status={key}/>{label}</li>)}
        </ul>
        <div className={styles.plot}>
          <div className={styles.ticks} aria-hidden="true">{ticks.map(tick => <span key={tick}>{integer.format(tick)}</span>)}</div>
          <div className={styles.plotScroll}>
            <div className={styles.plotColumns} style={{ '--chart-columns': points.length } as CSSProperties}>
              {points.map(point => {
                const series = statusValues(point);
                const isActive = point.key === active.key;
                const caption = shortPeriod(point, trend.granularity);
                const period = fullPeriod(point);
                const periodName = period.startsWith(caption) ? period : `${caption}, ${period}`;
                return <button type="button" className={styles.column} key={point.key}
                  aria-label={`${periodName}, ${integer.format(point.total)} ${point.total === 1 ? 'intervento' : 'interventi'}`}
                  aria-pressed={isActive} aria-controls={detail} onClick={() => setSelected(point.key)}>
                  <span className={styles.columnMarks} aria-hidden="true">
                    {statuses.filter(({ key }) => series[key] > 0).map(({ key }) =>
                      <i key={key} data-status={key} style={{ height: percentage(series[key], ticks[0]) }}/>) }
                  </span>
                  <span className={styles.columnLabel}>{caption}</span>
                </button>;
              })}
            </div>
          </div>
        </div>
        <div id={detail} className={styles.trendDetail} aria-live="polite" aria-atomic="true">
          <p>{fullPeriod(active)} <span aria-hidden="true">·</span> <strong>{integer.format(active.total)} {active.total === 1 ? 'intervento' : 'interventi'}</strong></p>
          <dl>
            {statuses.map(({ key, label }) => <div key={key}>
              <dt><LegendMark status={key}/>{label}</dt><dd>{integer.format(values[key])}</dd>
            </div>)}
          </dl>
        </div>
        {pages > 1 && <div className={styles.paging} role="group" aria-label="Pagine del grafico">
          <span aria-live="polite">{integer.format(offset + 1)}–{integer.format(offset + points.length)} di {integer.format(trend.points.length)}</span>
          <div>
            <button type="button" className="icon-button" aria-label="Periodi precedenti" disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}><ChevronLeft size={19} aria-hidden="true"/></button>
            <button type="button" className="icon-button" aria-label="Periodi successivi" disabled={currentPage + 1 === pages}
              onClick={() => setPage(currentPage + 1)}><ChevronRight size={19} aria-hidden="true"/></button>
          </div>
        </div>}
      </div>
      {trend.omittedEmpty && <p className={styles.note}>Nei periodi più lunghi compaiono solo gli intervalli con interventi.</p>}
      <table className={styles.printTrend} aria-label="Andamento degli interventi per data prevista">
        <thead><tr><th scope="col">Periodo</th>{statuses.map(({ key, label }) => <th key={key} scope="col">{label}</th>)}</tr></thead>
        <tbody>{trend.points.map(point => {
          const series = statusValues(point);
          return <tr key={point.key}><th scope="row">{fullPeriod(point)}</th>
            {statuses.map(({ key }) => <td key={key}>{integer.format(series[key])}</td>)}
          </tr>;
        })}</tbody>
      </table>
    </> : <ChartEmpty>Nessun intervento previsto per questi filtri.</ChartEmpty>}
  </ChartPanel>;
}

function InterventionStatus({ totals }: { totals: InterventionTotals }) {
  const { total, completed, overdue } = totals;
  const values = statusValues(totals);
  const ring = { '--complete': percentage(completed, total), '--open-end': percentage(total - overdue, total) } as CSSProperties;
  return <ChartPanel title="Stato degli interventi" description="Stato attuale degli interventi previsti nel periodo." Icon={PieChart}>
    {total ? <div className={styles.statusBody}>
      <div className={styles.ring} style={ring}>
        <div className={styles.ringLabel}><strong>{integer.format(total)}</strong><span>Totale</span></div>
      </div>
      <dl className={styles.statusList}>
        {statuses.map(({ key, label }) => <div key={key}>
          <dt><LegendMark status={key}/>{label}</dt><dd>{integer.format(values[key])}</dd>
        </div>)}
      </dl>
    </div> : <ChartEmpty>Nessun intervento da riepilogare.</ChartEmpty>}
  </ChartPanel>;
}

function Bar({ value, scale }: { value: number; scale: number }) {
  return <span className={styles.track} aria-hidden="true"><span style={{ width: percentage(value, scale) }}/></span>;
}

function InterventionKinds({ byKind, total }: { byKind: Report['activity']['jobsByKind']; total: number }) {
  const scale = Math.max(...jobKinds.map(kind => byKind[kind]));
  return <ChartPanel title="Interventi per tipo" description="Numero di interventi previsti per lavorazione." Icon={Layers3}>
    {total ? <dl className={styles.bars}>
      {jobKinds.map(kind => <div key={kind} className={styles.kindRow}>
        <dt>{kindLabels[kind]}</dt>
        <dd><Bar value={byKind[kind]} scale={scale}/><strong>{integer.format(byKind[kind])}</strong></dd>
      </div>)}
    </dl> : <ChartEmpty>Nessuna lavorazione nel periodo.</ChartEmpty>}
  </ChartPanel>;
}

function SiteRanking({ sites, scoped, siteHref }: {
  sites: Report['sites']; scoped: boolean; siteHref: (id: string) => string;
}) {
  const ranked = sites.filter(site => site.id && site.jobCount > 0)
    .sort((a, b) => b.jobCount - a.jobCount || a.name.localeCompare(b.name, 'it') || a.id.localeCompare(b.id));
  const top = ranked.slice(0, 5);
  return <ChartPanel title="Interventi per cantiere" Icon={HardHat} description={ranked.length > top.length
    ? 'I cinque cantieri con più interventi previsti.' : 'Numero di interventi previsti nei cantieri del riepilogo.'}>
    {top.length ? <ol className={styles.ranking} role="list">{top.map(site => {
      const label = <>
        <span className={styles.siteName}>{!scoped && <span className="sr-only">Statistiche di </span>}
          {site.name}{site.city && <> <small>{site.city}</small></>}</span>
        <strong className={styles.siteCount}>{integer.format(site.jobCount)}
          {!scoped && <span className="sr-only"> {site.jobCount === 1 ? 'intervento' : 'interventi'}</span>}</strong>
        {!scoped && <ArrowUpRight size={15} aria-hidden="true"/>}
        <Bar value={site.jobCount} scale={top[0].jobCount}/>
      </>;
      return <li key={site.id}>
        {scoped ? <div className={styles.siteRow}>{label}</div> :
          <Link className={styles.siteRow} href={siteHref(site.id)}>{label}</Link>}
      </li>;
    })}</ol> : <ChartEmpty>Nessun cantiere con interventi nel periodo.</ChartEmpty>}
  </ChartPanel>;
}

export function StatisticsCharts({ report, siteHref }: { report: Report; siteHref: (id: string) => string }) {
  const { activity, activityTrend, sites, filters } = report;
  return <div className={styles.dashboard} aria-label="Grafici operativi" role="group">
    <div className={styles.primaryGrid}>
      <InterventionTrend key={`${filters.from}/${filters.to}/${filters.site}`} trend={activityTrend} total={activity.jobs}/>
      <InterventionStatus totals={{ total: activity.jobs, completed: activity.jobsCompleted, overdue: activity.jobsOverdue }}/>
    </div>
    <div className={styles.secondaryGrid}>
      <InterventionKinds total={activity.jobs} byKind={activity.jobsByKind}/>
      <SiteRanking sites={sites} scoped={Boolean(filters.site)} siteHref={siteHref}/>
    </div>
  </div>;
}
