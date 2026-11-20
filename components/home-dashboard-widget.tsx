'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { calendarPath } from '@/lib/calendar';
import { requestWorkspace } from '@/lib/client-api';
import { getDemo } from '@/lib/demo';
import { compareJobs, formatDate, jobLabels, kindLabels, plusDays, type Client, type Identity, type Job, type Workspace } from '@/lib/domain';
import type { DashboardWidget, DashboardWidgetKind } from '@/lib/home-dashboard';
import type { DashboardAgendaItem, DashboardData, DashboardRecord } from '@/lib/home-dashboard-data';
import { resourceDefinitions } from '@/lib/operation-resources';
import type { SiteOption } from '@/lib/operation-types';
import { orgLink } from './shell';
import styles from './home-dashboard-widget.module.css';

const recordKinds = {
  warehouse: ['article'],
  estimates: ['estimate'],
  fleet: ['article'],
  personnel: ['employee', 'worker', 'crew'],
  documents: ['invoice', 'order', 'ddt'],
} satisfies Record<string, DashboardRecord['kind'][]>;

type RecordWidget = keyof typeof recordKinds;

const recordAreas: Record<RecordWidget, string> = {
  warehouse: 'magazzino', estimates: 'computi-metrici', fleet: 'magazzino', personnel: 'personale', documents: 'amministrazione',
};

const targetLabels: Record<DashboardWidgetKind, string> = {
  calendar: 'Intervento', warehouse: 'Articolo', estimates: 'Computo', 'site-interventions': 'Cantiere',
  sites: 'Cantiere', fleet: 'Veicolo', clients: 'Cliente', personnel: 'Persona o squadra', documents: 'Documento',
};

const targetPlaceholders: Record<DashboardWidgetKind, string> = {
  calendar: 'Tutti gli interventi', warehouse: 'Tutti gli articoli', estimates: 'Tutti i computi',
  'site-interventions': 'Primo cantiere disponibile', sites: 'Tutti i cantieri', fleet: 'Tutti i veicoli', clients: 'Tutti i clienti',
  personnel: 'Tutto il personale e le squadre', documents: 'Tutti i documenti',
};

const fullModuleLabels: Record<RecordWidget, string> = {
  warehouse: 'Apri magazzino', estimates: 'Apri computi metrici', fleet: 'Apri magazzino',
  personnel: 'Apri personale e squadre', documents: 'Apri documenti',
};

const activeStatuses = new Set(['active', 'available', 'approved', 'paid', 'delivered', 'issued']);
const plannedStatuses = new Set(['planned', 'review', 'ordered']);
const attentionStatuses = new Set(['inactive', 'unpaid', 'paused']);

export function dashboardTargetLabel(kind: DashboardWidgetKind) {
  return targetLabels[kind];
}

export function dashboardTargetPlaceholder(kind: DashboardWidgetKind) {
  return targetPlaceholders[kind];
}

function recordsOf(kind: RecordWidget, records: DashboardRecord[] = []) {
  const kinds: DashboardRecord['kind'][] = recordKinds[kind];
  return records.filter(row => kinds.includes(row.kind) && (kind !== 'fleet' || row.vehicle));
}

function jobTitle(job: Pick<Job, 'kind' | 'zone'>) {
  return [kindLabels[job.kind], job.zone].filter(Boolean).join(' · ');
}

const shortDate = { weekday: 'short', day: 'numeric', month: 'short' } as const;
const longDate = { weekday: 'long', day: 'numeric', month: 'long' } as const;

export function dashboardTargetOptions(kind: DashboardWidgetKind, data: DashboardData) {
  switch (kind) {
    case 'calendar': return (data.calendar ?? []).map(item => ({ value: item.id,
      label: [jobTitle(item), item.site.name, formatDate(item.due_date, shortDate), item.time?.slice(0, 5)].filter(Boolean).join(' · ') }));
    case 'site-interventions':
    case 'sites': return (data.sites ?? []).map(site => ({ value: site.id, label: [site.name, site.city].filter(Boolean).join(' · ') }));
    case 'clients': return (data.clients ?? []).map(client => ({ value: client.id, label: client.name }));
    default: return recordsOf(kind, data.records ?? []).map(record => ({ value: record.id, label: record.title }));
  }
}

type BadgeTone = 'active' | 'planned' | 'late' | 'done' | 'neutral';
type WidgetRow = {
  id: string;
  title: string;
  detail?: string;
  date?: string | null;
  time?: string | null;
  href?: string;
  badge?: { label: string; tone: BadgeTone };
};

function Rows({ rows, identity }: { rows: WidgetRow[]; identity: Identity }) {
  return <ul className={styles.rows}>
    {rows.map(row => <li key={row.id} className={styles.row}>
      <div className={styles.rowMain}>
        {row.href ? <Link className={styles.rowLink} href={orgLink(row.href, identity)} prefetch={false}>{row.title}</Link>
          : <strong>{row.title}</strong>}
        {row.detail && <small>{row.detail}</small>}
        {row.date && <small><time dateTime={row.date}>{formatDate(row.date, shortDate)}</time>{row.time && ' · ' + row.time.slice(0, 5)}</small>}
      </div>
      {row.badge && <span className={`badge badge-${row.badge.tone} ${styles.state}`}>{row.badge.label}</span>}
    </li>)}
  </ul>;
}

function WidgetContent({ children, href, label, identity }: {
  children: ReactNode; href: string; label: string; identity: Identity;
}) {
  return <div className={styles.content}>
    <div className={styles.preview} tabIndex={0}>{children}</div>
    <Link className={styles.moduleLink} href={orgLink(href, identity)} prefetch={false}>{label}<ArrowUpRight size={16} aria-hidden="true"/></Link>
  </div>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

function selectRows<T extends { id: string }>(rows: T[], target: string | null) {
  return target ? rows.filter(row => row.id === target) : rows;
}

function jobRow(job: Pick<Job, 'id' | 'kind' | 'zone' | 'due_date' | 'time' | 'status'>, today: string): WidgetRow {
  const late = job.status !== 'done' && job.due_date < today;
  return { id: job.id, title: jobTitle(job), date: job.due_date, time: job.time,
    badge: { label: late ? 'In ritardo' : jobLabels[job.status], tone: late ? 'late' : job.status === 'done' ? 'done' : 'planned' } };
}

function CalendarWidget({ widget, data, identity, today, limit }: WidgetProps & { limit: number }) {
  const [day, setDay] = useState('');
  const items = selectRows(data.calendar ?? [], widget.target);
  const days = Array.from({ length: 7 }, (_, offset) => plusDays(today, offset));
  const selected = widget.target ? items[0]?.due_date : days.includes(day) ? day : '';
  const daysWithEvents = new Set(items.map(item => item.due_date));
  const rows = (selected ? items.filter(item => item.due_date === selected) : items).slice(0, limit).map((item: DashboardAgendaItem) => ({
    ...jobRow(item, today), detail: item.site.name, href: `/cantieri/${item.site.id}`,
  }));

  return <WidgetContent identity={identity} href={calendarPath(selected ? 'giorno' : 'settimana', selected || today)} label="Apri calendario">
    {data.calendar === null ? <Empty>Calendario non disponibile.</Empty> : <>
      {(!widget.target || items.length > 0) && <>
        <p className={styles.caption}>{widget.target ? 'Intervento selezionato' : 'Prossimi sette giorni'}</p>
        {!widget.target && <div className={styles.week} role="group" aria-label="Filtra gli interventi per giorno">
          {days.map(date => {
            const weekday = formatDate(date, { weekday: 'short' }).slice(0, 2);
            const dayNumber = Number(date.slice(-2));
            return <button type="button" key={date} className={styles.day}
              aria-label={`${weekday} ${dayNumber}, ${formatDate(date, longDate)}`}
              aria-current={date === today ? 'date' : undefined} aria-pressed={date === selected}
              onClick={() => setDay(date === selected ? '' : date)}>
              <span>{weekday}{' '}</span><strong>{dayNumber}</strong><i data-booked={daysWithEvents.has(date)} aria-hidden="true"/>
            </button>;
          })}
        </div>}
      </>}
      {rows.length > 0 ? <Rows rows={rows} identity={identity}/>
        : <Empty>{widget.target ? 'L’intervento selezionato non è nei prossimi sette giorni.' : selected ? 'Nessun intervento per questo giorno.' : 'Nessun intervento nei prossimi sette giorni.'}</Empty>}
    </>}
  </WidgetContent>;
}

type SiteLoading = { siteId: string; jobs: Job[] | null; error: string };

function InterventionsWidget({ widget, data, identity, today, limit }: WidgetProps & { limit: number }) {
  const site = widget.target ? data.sites?.find(item => item.id === widget.target) : data.sites?.[0];
  const siteId = site?.id;
  const demoData = identity.demo ? data : null;
  const [result, setResult] = useState<SiteLoading | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!siteId) return;
    const controller = new AbortController();
    const id = siteId;
    async function read() {
      try {
        const jobs = demoData ? getDemo(today).jobs.filter(job => job.site_id === id)
          : (await requestWorkspace<Workspace>(new URLSearchParams({ azienda: identity.org.id, cantiere: id }), controller.signal)).current?.jobs;
        if (!controller.signal.aborted) setResult({ siteId: id, jobs: jobs ?? null, error: '' });
      } catch {
        if (!controller.signal.aborted) setResult({ siteId: id, jobs: null, error: 'Impossibile caricare gli interventi.' });
      }
    }
    void read();
    return () => controller.abort();
  }, [siteId, demoData, identity.org.id, today, attempt]);

  const current = result?.siteId === siteId ? result : null;
  const jobs = current?.jobs?.slice().sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done')
    || (a.status === 'done' ? compareJobs(b, a) : compareJobs(a, b)));
  return <WidgetContent identity={identity} href={site ? `/cantieri/${site.id}` : '/cantieri'} label={site ? 'Apri scheda cantiere' : 'Apri cantieri'}>
    {site ? <>
      <p className={styles.caption}><strong>{site.name}</strong>{site.city && ` · ${site.city}`}</p>
      {!current ? <p className={styles.empty} role="status">Caricamento interventi…</p>
        : current.error ? <div className={styles.error} role="alert"><p>{current.error}</p>
          <button type="button" className="button secondary" onClick={() => { setResult(null); setAttempt(value => value + 1); }}>Riprova</button></div>
          : jobs?.length ? <Rows rows={jobs.slice(0, limit).map(job => jobRow(job, today))} identity={identity}/>
            : <Empty>{jobs ? 'Nessun intervento registrato.' : 'Il cantiere selezionato non è disponibile.'}</Empty>}
    </> : <Empty>{data.sites === null ? 'Cantieri non disponibili.' : widget.target ? 'Il cantiere selezionato non è disponibile.' : 'Aggiungi un cantiere per visualizzarne gli interventi.'}</Empty>}
  </WidgetContent>;
}

function recordHref(kind: RecordWidget, record?: DashboardRecord) {
  const path = `/gestione/${recordAreas[kind]}`;
  if (!record) return path;
  const params = kind === 'fleet' ? [['veicolo', record.id]] : [['tipo', record.kind], ['scheda', record.id]];
  return `${path}?${new URLSearchParams(params)}`;
}

function recordRow(kind: RecordWidget, record: DashboardRecord, selected: boolean, data: DashboardData): WidgetRow {
  const definition = resourceDefinitions.find(item => item.kind === record.kind);
  const status = definition?.statuses.find(item => item.value === record.status)?.label;
  const availability = kind === 'warehouse' ? record.availability : undefined;
  const site = record.site_id && data.sites?.find(item => item.id === record.site_id)?.name;
  const tone = activeStatuses.has(record.status) ? 'active' : plannedStatuses.has(record.status) ? 'planned' : attentionStatuses.has(record.status) ? 'late' : 'neutral';
  return { id: record.id, title: record.title, date: kind === 'estimates' || kind === 'documents' ? record.record_date : null,
    href: selected ? undefined : recordHref(kind, record),
    detail: [kind === 'documents' ? definition?.singular : undefined, record.detail, site,
      availability && ['Disponibili ' + availability.quantity, availability.unit].filter(Boolean).join(' '),
      availability && selected && ['Minimo ' + availability.minimum, availability.unit].filter(Boolean).join(' '),
    ].filter(Boolean).join(' · '),
    badge: availability?.low ? { label: 'Sotto scorta', tone: 'late' } : status ? { label: status, tone } : undefined,
  };
}

type WidgetProps = { widget: DashboardWidget; data: DashboardData; identity: Identity; today: string };

export function HomeDashboardWidget({ widget, data, identity, today }: WidgetProps) {
  const limit = widget.height === 2 ? 8 : 4;
  if (widget.kind === 'calendar') return <CalendarWidget key={widget.target} widget={widget} data={data} identity={identity} today={today} limit={limit}/>;
  if (widget.kind === 'site-interventions') return <InterventionsWidget widget={widget} data={data} identity={identity} today={today} limit={limit}/>;
  if (widget.kind === 'sites' || widget.kind === 'clients') {
    const sites = widget.kind === 'sites';
    const items = sites ? data.sites : data.clients;
    const path = sites ? '/cantieri' : '/clienti';
    const itemHref = (id: string) => sites ? `${path}/${id}` : `${path}?${new URLSearchParams({ cliente: id })}`;
    const rows = selectRows<Client | SiteOption>(items ?? [], widget.target).slice(0, limit).map(item => ({ id: item.id, title: item.name,
      href: widget.target ? undefined : itemHref(item.id), detail: 'city' in item ? [item.city, item.client].filter(Boolean).join(' · ') : '',
    }));
    const chosen = widget.target && rows[0];
    return <WidgetContent identity={identity} href={chosen ? itemHref(chosen.id) : path}
      label={chosen ? sites ? 'Apri scheda cantiere' : 'Apri scheda cliente' : sites ? 'Apri cantieri' : 'Apri clienti'}>
      {rows.length ? <Rows rows={rows} identity={identity}/>
        : <Empty>{items === null ? 'Modulo non disponibile.' : widget.target ? 'La scheda selezionata non è disponibile.' : sites ? 'Nessun cantiere registrato.' : 'Nessun cliente registrato.'}</Empty>}
    </WidgetContent>;
  }
  const kind = widget.kind;
  const records = selectRows(recordsOf(kind, data.records ?? []), widget.target);
  const chosen = widget.target ? records[0] : undefined;
  return <WidgetContent identity={identity} href={recordHref(kind, chosen)} label={chosen ? 'Apri scheda' : fullModuleLabels[kind]}>
    {records.length ? <Rows rows={records.slice(0, limit).map(record => recordRow(kind, record, Boolean(chosen), data))} identity={identity}/>
      : <Empty>{data.records === null ? 'Modulo non disponibile.' : widget.target ? 'La scheda selezionata non è disponibile.' : 'Nessuna scheda disponibile.'}</Empty>}
  </WidgetContent>;
}
