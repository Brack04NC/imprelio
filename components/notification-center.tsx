'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  ArrowRight, Bell, BellOff, CalendarDays, Check, ChevronLeft, ChevronRight,
  Clock3, FileCheck2, Info, RefreshCw, Truck, Users,
} from 'lucide-react';
import { formatDate, type Identity } from '@/lib/domain';
import {
  notificationAgendaDays, notificationDeadlineDays,
  type NotificationCategory, type NotificationItem, type NotificationPriority,
} from '@/lib/notifications';
import { orgLink } from './shell';
import { notificationPriorities } from './notification-priority';
import tones from './notice-tones.module.css';
import styles from './notification-center.module.css';

const categories = {
  agenda: { label: 'Agenda', icon: CalendarDays },
  deadlines: { label: 'Scadenze', icon: Clock3 },
  estimates: { label: 'Computi e preventivi', icon: FileCheck2 },
  workers: { label: 'Operai', icon: Users },
  vehicles: { label: 'Veicoli', icon: Truck },
} satisfies Record<NotificationCategory, { label: string; icon: typeof Bell }>;

const priorityOrder = ['all', 'urgent', 'soon', 'info'] as const;
const dateOptions = { day: 'numeric', month: 'short', year: 'numeric' } as const;
const categoryList = new Intl.ListFormat('it', { style: 'long', type: 'conjunction' });
const pageSize = 12;

type Props = {
  identity: Identity;
  items: NotificationItem[];
  unavailable: NotificationCategory[];
  onRefresh: () => void;
  refreshing: boolean;
  history: boolean;
  historyUnavailable: boolean;
  error: string;
};

export function NotificationCenter({ identity, items, unavailable, onRefresh, refreshing, history, historyUnavailable, error }: Props) {
  const [category, setCategory] = useState<NotificationCategory | 'all'>('all');
  const [priority, setPriority] = useState<NotificationPriority | 'all'>('all');
  const [page, setPage] = useState(1);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const categoryItems = category === 'all' ? items : items.filter(item => item.category === category);
  const counts = { all: categoryItems.length, urgent: 0, soon: 0, info: 0 };
  for (const item of categoryItems) counts[item.priority] += 1;
  const filtered = priority === 'all' ? categoryItems : categoryItems.filter(item => item.priority === priority);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const activePage = Math.min(page, pageCount);
  const visible = filtered.slice((activePage - 1) * pageSize, activePage * pageSize);
  const hasFilters = category !== 'all' || priority !== 'all';
  const incomplete = Boolean(error || (history && historyUnavailable) ||
    (category === 'all' ? unavailable.length > 0 : unavailable.includes(category)));
  const unknownTotal = incomplete || (refreshing && !items.length);
  const countText = filtered.length === 1 ? '1 notifica' : `${filtered.length} notifiche`;
  const resultText = !filtered.length && unknownTotal ? (refreshing ? 'Aggiornamento in corso' : 'Conteggio non disponibile')
    : countText + (incomplete ? (filtered.length === 1 ? ' visibile' : ' visibili') : '');
  const EmptyIcon = incomplete ? Info : BellOff;

  function changePage(next: number) {
    setPage(next);
    listHeading.current?.focus();
  }

  return <>
    <header className={`page-header ${styles.header}`}>
      <div>
        <h1>Centro notifiche</h1>
        <p>{history ? 'Avvisi attivi e passati, con accesso alle schede collegate.'
          : <>Interventi dei prossimi {notificationAgendaDays} giorni, scadenze entro {notificationDeadlineDays} giorni e ritardi ancora aperti.</>}</p>
      </div>
      <button type="button" className={`button secondary ${styles.refresh}`} aria-disabled={refreshing}
        onClick={() => { if (!refreshing) onRefresh(); }}>
        <RefreshCw size={16} aria-hidden="true"/> {refreshing ? 'Aggiornamento…' : 'Aggiorna'}
      </button>
    </header>

    <nav className={styles.views} aria-label="Viste delle notifiche">
      <Link className="button secondary" href={orgLink('/notifiche', identity)} aria-current={!history ? 'page' : undefined}>Attive</Link>
      <Link className="button secondary" href={orgLink('/notifiche?vista=cronologia', identity)} aria-current={history ? 'page' : undefined}>Cronologia</Link>
    </nav>

    {error && <p className="form-error" role="alert">{error} Usa Aggiorna per riprovare.</p>}
    {history && historyUnavailable && <aside role="status" className={`${styles.unavailable} ${tones.warning}`}>
      <Info size={18} aria-hidden="true"/>
      <p>{identity.demo ? 'Cronologia salvata nel browser non disponibile.' : 'Cronologia salvata non disponibile. In Supabase la attiva la migrazione 015.'}</p>
    </aside>}

    {unavailable.length > 0 && <aside role="status" className={`${styles.unavailable} ${tones.warning}`}>
      <Info size={18} aria-hidden="true"/>
      <p><strong>Aggiornamento parziale.</strong> Alcuni avvisi potrebbero mancare in {categoryList.format(unavailable.map(key => categories[key].label))}.</p>
    </aside>}

    <fieldset className={styles.priorities}>
      <legend className="sr-only">Filtra per priorità</legend>
      {priorityOrder.map(id => {
        const { label, icon: Icon, tone } = notificationPriorities[id];
        return <button type="button" key={id} className={`${styles.priorityCard} ${tone}`} data-priority={id}
          aria-pressed={priority === id} aria-controls="notifiche-risultati"
          onClick={() => { setPriority(id); setPage(1); }}>
          <span className={styles.priorityIcon}><Icon size={19} aria-hidden="true"/></span>
          <span className={styles.priorityCount}><small>{label}</small><strong>{unknownTotal && !counts[id] ? '—' : counts[id]}</strong></span>
          {priority === id && <Check size={15} className={styles.selected} aria-hidden="true"/>}
        </button>;
      })}
    </fieldset>

    <section className="panel" id="notifiche-risultati" aria-labelledby="notifiche-elenco">
      <header className={`panel-header ${styles.toolbar}`}>
        <div>
          <h2 id="notifiche-elenco" tabIndex={-1} ref={listHeading}>{history ? 'Tutti gli avvisi' : 'Avvisi'}</h2>
          <p role="status" aria-atomic="true">{resultText}</p>
        </div>
        <div className={styles.categoryFilter}>
          <label htmlFor="notifiche-categoria">Categoria</label>
          <select id="notifiche-categoria" value={category} onChange={event => {
            setCategory(event.target.value as NotificationCategory | 'all');
            setPage(1);
          }} aria-controls="notifiche-risultati">
            <option value="all">Tutte le categorie</option>
            {Object.entries(categories).map(([key, { label }]) => <option value={key} key={key}>{label}</option>)}
          </select>
        </div>
      </header>

      {visible.length > 0 ? <ul className={styles.list} role="list">{visible.map(item => <NotificationRow key={item.id} item={item} identity={identity}/>)}</ul>
        : <div className={`empty ${styles.empty}`}>
          <span className={styles.emptyIcon}><EmptyIcon size={22} aria-hidden="true"/></span>
          <strong>{refreshing ? 'Caricamento avvisi…' : incomplete ? 'Elenco degli avvisi incompleto' :
            hasFilters ? 'Nessun avviso per questi filtri' : 'Nessun avviso da mostrare'}</strong>
          {hasFilters && <button type="button" className="button secondary" onClick={() => {
            setCategory('all'); setPriority('all'); changePage(1);
          }}>Azzera i filtri</button>}
        </div>}

      {pageCount > 1 && <nav className={styles.pagination} aria-label="Pagine delle notifiche">
        <span>Pagina {activePage} di {pageCount}</span>
        <div>
          <button type="button" className="icon-button" aria-label="Pagina precedente" disabled={activePage === 1}
            onClick={() => changePage(activePage - 1)}><ChevronLeft size={19} aria-hidden="true"/></button>
          <button type="button" className="icon-button" aria-label="Pagina successiva" disabled={activePage === pageCount}
            onClick={() => changePage(activePage + 1)}><ChevronRight size={19} aria-hidden="true"/></button>
        </div>
      </nav>}
    </section>
  </>;
}

function NotificationRow({ item, identity }: { item: NotificationItem; identity: Identity }) {
  const { label: category, icon: Icon } = categories[item.category];
  const { badge, icon: PriorityIcon, tone } = notificationPriorities[item.priority];
  return <li className={`${styles.row} ${tone}`} data-priority={item.priority}>
    <span className={styles.rowIcon}><Icon size={20} aria-hidden="true"/></span>
    <div className={styles.rowBody}>
      <div className={styles.summary}>
        <span className={styles.priorityBadge}><PriorityIcon size={13} aria-hidden="true"/>{badge}</span>
        <span>{category}</span>
        {item.past && <span className={styles.past}>Passata</span>}
      </div>
      <h3>{item.title}</h3>
      {item.detail && <p>{item.detail}</p>}
      <div className={styles.meta}>
        <strong>{item.status}</strong>
        {item.date && <time dateTime={item.date}>{formatDate(item.date, dateOptions)}</time>}
      </div>
    </div>
    <Link href={orgLink(item.href, identity)} prefetch={false} className={`button text-button ${styles.action}`}>
      <span>{item.actionLabel}<span className="sr-only"> per {item.title}</span></span><ArrowRight size={16} aria-hidden="true"/>
    </Link>
  </li>;
}
