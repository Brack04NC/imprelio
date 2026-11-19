'use client';

import Link from 'next/link';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { calendarDays, calendarLabel, calendarPath, calendarViews, shiftCalendar, type CalendarSelection, type CalendarView } from '@/lib/calendar';
import type { AgendaItem, Identity } from '@/lib/domain';
import { CalendarGrid } from './calendar-grid';
import { orgLink } from './shell';
import styles from './calendar-panel.module.css';

const navigationLabels = {
  mese: { previous: 'Mese precedente', next: 'Mese successivo' },
  settimana: { previous: 'Settimana precedente', next: 'Settimana successiva' },
  giorno: { previous: 'Giorno precedente', next: 'Giorno successivo' },
};

export function CalendarPanel({ selection, today, items, identity, canCreate, onCreate, onEdit }: {
  selection: CalendarSelection; today: string; items: AgendaItem[]; identity: Identity; canCreate: boolean;
  onCreate: (date: string, time?: string) => void; onEdit: (event: AgendaItem) => void;
}) {
  const { view, date } = selection;
  const previous = shiftCalendar(selection, -1);
  const next = shiftCalendar(selection, 1);
  const href = (mode: CalendarView, day: string) => orgLink(calendarPath(mode, day), identity);
  return <section className={`panel ${styles.panel}`} aria-labelledby="calendar-period">
    <header className={styles.toolbar}>
      <div className={styles.period}>
        <span className="agenda-heading-icon"><CalendarDays size={20}/></span>
        <h2 id="calendar-period">{calendarLabel(selection)}</h2>
      </div>
      <div className={styles.controls}>
        <div className={styles.step} role="group" aria-label="Navigazione calendario">
          <Link className="button secondary" href={href(view, today)}>Oggi</Link>
          {previous && <Link className="icon-button" href={href(view, previous)} aria-label={navigationLabels[view].previous}><ChevronLeft size={19}/></Link>}
          {next && <Link className="icon-button" href={href(view, next)} aria-label={navigationLabels[view].next}><ChevronRight size={19}/></Link>}
        </div>
        <nav className={`period-control ${styles.views}`} aria-label="Vista calendario">
          {calendarViews.map(({ id, label }) => <Link key={id} href={href(id, date)}
            aria-current={view === id ? 'page' : undefined}>{label}</Link>)}
        </nav>
      </div>
    </header>
    <CalendarGrid view={view} date={date} today={today} days={calendarDays(selection)} items={items}
      dayHref={day => href('giorno', day)} canCreate={canCreate} onCreate={onCreate} onEdit={onEdit}/>
  </section>;
}
