import { z } from 'zod';
import { formatDate, plusDays } from './domain.ts';

export const calendarViews = [
  { id: 'mese', label: 'Mese' },
  { id: 'settimana', label: 'Settimana' },
  { id: 'giorno', label: 'Giorno' },
] as const;

export type CalendarView = typeof calendarViews[number]['id'];
export type CalendarSelection = { view: CalendarView; date: string };

const firstDate = '0001-01-01';
const lastDate = '9999-12-31';

export function calendarSelection(view: unknown, date: unknown, today: string): CalendarSelection | null {
  const mode = calendarViews.find(item => item.id === view);
  if (!mode) return null;
  const parsed = z.iso.date().safeParse(date);
  return { view: mode.id, date: parsed.success && parsed.data >= firstDate ? parsed.data : today };
}

function readDate(date: string) {
  return new Date(date + 'T12:00:00Z');
}

function weekIndex(date: string) {
  return (readDate(date).getUTCDay() + 6) % 7;
}

function shiftDay(date: string, offset: number) {
  const day = readDate(date);
  day.setUTCDate(day.getUTCDate() + offset);
  return calendarDate(day);
}

function calendarDate(date: Date) {
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null;
  return date.toISOString().slice(0, 10);
}

export function calendarRange({ view, date }: CalendarSelection) {
  if (view === 'giorno') return { from: date, to: date, openOnly: false };
  if (view === 'settimana') {
    const day = weekIndex(date);
    return { from: shiftDay(date, -day) ?? firstDate, to: shiftDay(date, 6 - day) ?? lastDate, openOnly: false };
  }
  const first = date.slice(0, 7) + '-01';
  const end = readDate(first);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const last = end.toISOString().slice(0, 10);
  return {
    from: shiftDay(first, -weekIndex(first)) ?? firstDate,
    to: shiftDay(last, 6 - weekIndex(last)) ?? lastDate,
    openOnly: false,
  };
}

export function calendarDays(selection: CalendarSelection) {
  const { from, to } = calendarRange(selection);
  const count = Math.round((readDate(to).valueOf() - readDate(from).valueOf()) / 86_400_000) + 1;
  return Array.from({ length: count }, (_, index) => plusDays(from, index));
}

export function shiftCalendar({ view, date }: CalendarSelection, direction: -1 | 1) {
  if (view !== 'mese') return shiftDay(date, (view === 'settimana' ? 7 : 1) * direction);
  const month = readDate(date);
  month.setUTCDate(1);
  month.setUTCMonth(month.getUTCMonth() + direction);
  return calendarDate(month);
}

export function calendarPath(view: CalendarView, date: string) {
  return '/agenda?' + new URLSearchParams({ calendario: view, data: date });
}

export function calendarLabel(selection: CalendarSelection) {
  const { view, date } = selection;
  if (view === 'mese') return formatDate(date, { month: 'long', year: 'numeric' });
  if (view === 'giorno') return formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const { from, to } = calendarRange(selection);
  const start = formatDate(from, from.slice(0, 7) === to.slice(0, 7) ? { day: 'numeric' }
    : { day: 'numeric', month: 'long', ...(from.slice(0, 4) !== to.slice(0, 4) ? { year: 'numeric' } : {}) });
  return start + ' – ' + formatDate(to, { day: 'numeric', month: 'long', year: 'numeric' });
}
