'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { compareJobs, formatDate, jobLabels, kindLabels, type AgendaItem } from '@/lib/domain';
import styles from './calendar-grid.module.css';

type CalendarProps = {
  view: 'mese' | 'settimana' | 'giorno';
  days: string[];
  date: string;
  today: string;
  items: AgendaItem[];
  dayHref: (day: string) => string;
  canCreate: boolean;
  onCreate: (date: string, time?: string) => void;
  onEdit: (event: AgendaItem) => void;
};

const hours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
const monthEventLimit = 2;

function longDate(day: string) {
  return formatDate(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function eventTime(item: AgendaItem) {
  return item.time?.slice(0, 5) ?? '';
}

function eventLabel(item: AgendaItem) {
  return [kindLabels[item.kind], item.site.name, item.zone, eventTime(item), jobLabels[item.status]].filter(Boolean).join(' · ');
}

function addLabel(dayLabel: string, hour?: string) {
  return `Aggiungi intervento il ${dayLabel}${hour ? ` alle ${hour}:00` : ''}`;
}

function CalendarEvent({ item, onEdit, compact = false }: {
  item: AgendaItem; onEdit: CalendarProps['onEdit']; compact?: boolean;
}) {
  const time = eventTime(item);
  const label = eventLabel(item);
  const detail = [kindLabels[item.kind], item.zone, item.status === 'done' ? jobLabels[item.status] : '']
    .filter(Boolean).join(' · ');
  const assistiveText = [
    'Modifica intervento', compact ? detail : '',
    item.status !== 'done' ? jobLabels[item.status] : '',
  ].filter(Boolean).join(' · ');
  return <button type="button" className={`${styles.event} ${compact ? styles.compactEvent : ''}`}
    data-kind={item.kind} data-status={item.status} title={label} onClick={() => onEdit(item)}>
    {time && <time className={styles.eventTime} dateTime={`${item.due_date}T${time}`}>{time}</time>}
    <span className={styles.eventSite}>{item.site.name}</span>
    {!compact && <span className={styles.eventDetail}>{detail}</span>}
    <span className="sr-only">{assistiveText}</span>
  </button>;
}

function MonthGrid({ days, date, today, dayHref, canCreate, onCreate, onEdit, jobs }: CalendarProps & {
  jobs: Map<string, AgendaItem[]>;
}) {
  return <section className={styles.month} aria-label="Calendario mensile">
    <div className={styles.weekdays}>
      {days.slice(0, 7).map(day => <span key={day}>{formatDate(day, { weekday: 'short' })}</span>)}
    </div>
    <ul className={styles.monthDays}>
      {days.map(day => {
        const entries = jobs.get(day) ?? [];
        const more = entries.length - monthEventLimit;
        const fullDay = longDate(day);
        const createLabel = addLabel(fullDay);
        return <li key={day} className={styles.monthDay} data-date={day} data-outside={day.slice(0, 7) !== date.slice(0, 7)}>
          <div className={styles.monthDayHeader}>
            <Link href={dayHref(day)} prefetch={false} className={styles.monthDate}
              aria-label={`Apri ${fullDay}`} aria-current={day === today ? 'date' : undefined}>
              <time dateTime={day}>{Number(day.slice(-2))}</time>
            </Link>
            {canCreate && <button type="button" className={styles.monthAdd} aria-label={createLabel}
              title={createLabel} onClick={() => onCreate(day)}><Plus size={15}/></button>}
          </div>
          <div className={styles.monthEvents}>
            {entries.slice(0, monthEventLimit).map(item => <CalendarEvent key={item.id} item={item} onEdit={onEdit} compact/>)}
            {more > 0 && <Link href={dayHref(day)} prefetch={false} className={styles.more}
              aria-label={`+${more} ${more === 1 ? 'altro intervento' : 'altri interventi'} il ${fullDay}`}>
              +{more}<span> {more === 1 ? 'altro' : 'altri'}</span>
            </Link>}
          </div>
        </li>;
      })}
    </ul>
  </section>;
}

function slotKey(day: string, hour?: string) {
  return `${day}/${hour ?? ''}`;
}

function TimeSlot({ day, dayLabel, hour, entries, canCreate, keyboardSlot, onSlotFocus, onCreate, onEdit }: {
  day: string; dayLabel: string; hour?: string; entries?: AgendaItem[]; canCreate: boolean;
  keyboardSlot: string; onSlotFocus: (key: string) => void;
  onCreate: CalendarProps['onCreate']; onEdit: CalendarProps['onEdit'];
}) {
  const label = addLabel(dayLabel, hour);
  const key = slotKey(day, hour);
  return <div className={styles.timeSlot} data-date={day} data-hour={hour} data-has-events={!!entries?.length}>
    {entries?.map(item => <CalendarEvent key={item.id} item={item} onEdit={onEdit}/>)}
    {canCreate && <button type="button" className={styles.slotAdd} aria-label={label} title={label}
      data-calendar-slot={key} tabIndex={key === keyboardSlot ? 0 : -1} onFocus={() => onSlotFocus(key)}
      onClick={() => onCreate(day, hour ? `${hour}:00` : undefined)}><Plus size={15}/></button>}
  </div>;
}

function ScheduleGrid({ view, date, today, days, items, dayHref, canCreate, onCreate, onEdit }: CalendarProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const firstRow = useRef<HTMLDivElement>(null);
  const instructionsId = useId();
  const [focusedSlot, setFocusedSlot] = useState<{ date: string; view: CalendarProps['view']; key: string }>();
  const dayLabels = useMemo(() => new Map(days.map(day => [day, longDate(day)])), [days]);
  const { slots, firstHour } = useMemo(() => {
    const visible = new Set(days);
    const slots = new Map<string, AgendaItem[]>();
    let firstHour = 7;
    for (const item of [...items].sort(compareJobs)) {
      if (!visible.has(item.due_date)) continue;
      const hour = item.time?.slice(0, 2);
      const key = slotKey(item.due_date, hour);
      const group = slots.get(key) ?? [];
      group.push(item);
      slots.set(key, group);
      if (hour) firstHour = Math.min(firstHour, Number(hour));
    }
    return { slots, firstHour: hours[firstHour] };
  }, [days, items]);
  const week = view === 'settimana';
  const keyboardSlot = focusedSlot?.date === date && focusedSlot.view === view ? focusedSlot.key : slotKey(date, firstHour);

  useEffect(() => {
    const scroll = scroller.current;
    const row = firstRow.current;
    if (scroll && row && heading.current) {
      const top = row.getBoundingClientRect().top - scroll.getBoundingClientRect().top
        + scroll.scrollTop - heading.current.offsetHeight;
      const day = heading.current.querySelector<HTMLElement>(`[data-calendar-day="${date}"]`);
      const timeWidth = heading.current.querySelector<HTMLElement>('[data-calendar-hours]')?.offsetWidth ?? 0;
      const left = week && day ? day.getBoundingClientRect().left - scroll.getBoundingClientRect().left
        + scroll.scrollLeft - timeWidth - scroll.clientLeft : 0;
      scroll.scrollTo({ top, left });
    }
  }, [date, firstHour, week]);

  function handleSlotKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !(event.target instanceof HTMLButtonElement)) return;
    const source = event.target.dataset.calendarSlot;
    if (!source) return;
    const [day, hour] = source.split('/');
    let dayIndex = days.indexOf(day);
    let hourIndex = hour ? Number(hour) : -1;
    switch (event.key) {
      case 'ArrowLeft': if (!week) return; dayIndex = Math.max(0, dayIndex - 1); break;
      case 'ArrowRight': if (!week) return; dayIndex = Math.min(days.length - 1, dayIndex + 1); break;
      case 'ArrowUp': hourIndex = Math.max(-1, hourIndex - 1); break;
      case 'ArrowDown': hourIndex = Math.min(hours.length - 1, hourIndex + 1); break;
      default: return;
    }
    event.preventDefault();
    const target = slotKey(days[dayIndex], hours[hourIndex]);
    if (target !== source) scroller.current?.querySelector<HTMLButtonElement>(`[data-calendar-slot="${target}"]`)?.focus();
  }

  const slot = (day: string, hour?: string) => <TimeSlot key={day} day={day} dayLabel={dayLabels.get(day) ?? day} hour={hour}
    entries={slots.get(slotKey(day, hour))} canCreate={canCreate} keyboardSlot={keyboardSlot}
    onSlotFocus={key => setFocusedSlot({date, view, key})} onCreate={onCreate} onEdit={onEdit}/>;

  return <div ref={scroller} className={`${styles.scheduleScroll} ${week ? styles.week : styles.day}`}
    role="region" aria-label={week ? 'Calendario settimanale' : 'Calendario del giorno'} tabIndex={0}
    aria-describedby={canCreate ? instructionsId : undefined} onKeyDown={handleSlotKeys}>
    {canCreate && <p id={instructionsId} className="sr-only">Quando il pulsante per aggiungere un intervento è a fuoco, usa le frecce per cambiare fascia e premi Invio per aprire il modulo.</p>}
    <div className={styles.scheduleHeading} ref={heading}>
      <div className={`${styles.slotLine} ${styles.scheduleDays}`}>
        <span className={styles.hourLabel} data-calendar-hours aria-hidden="true"/>
        {days.map(day => {
          const label = formatDate(day, { weekday: week ? 'short' : 'long', day: 'numeric', month: week ? undefined : 'long' });
          return week
            ? <Link key={day} className={styles.scheduleDayLabel} href={dayHref(day)} prefetch={false} data-calendar-day={day}
                aria-label={`${label}, ${formatDate(day, { month: 'long', year: 'numeric' })} · Apri la vista del giorno`}
                aria-current={day === today ? 'date' : undefined}>
                <time dateTime={day}>{label}</time>
              </Link>
            : <span key={day} className={styles.scheduleDayLabel} aria-current={day === today ? 'date' : undefined}>
                <time dateTime={day}>{label}</time>
              </span>;
        })}
      </div>
      <div className={`${styles.slotLine} ${styles.untimed}`}>
        <span className={styles.hourLabel}>Senza orario</span>
        {days.map(day => slot(day))}
      </div>
    </div>
    {hours.map(hour => <div key={hour} ref={hour === firstHour ? firstRow : undefined} className={styles.slotLine}>
      <time className={styles.hourLabel} dateTime={`${hour}:00`}>{hour}:00</time>
      {days.map(day => slot(day, hour))}
    </div>)}
  </div>;
}

export function CalendarGrid(props: CalendarProps) {
  const { view, items } = props;
  const byDay = useMemo(() => {
    const result = new Map<string, AgendaItem[]>();
    if (view !== 'mese') return result;
    for (const item of [...items].sort(compareJobs)) {
      const entries = result.get(item.due_date) ?? [];
      entries.push(item);
      result.set(item.due_date, entries);
    }
    return result;
  }, [items, view]);
  return view === 'mese' ? <MonthGrid {...props} jobs={byDay}/> : <ScheduleGrid {...props}/>;
}
