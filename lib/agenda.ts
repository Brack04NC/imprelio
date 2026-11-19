import { z } from 'zod';
import { plusDays, type Job } from './domain.ts';

export const agendaPeriods = [
  { id: 'oggi', label: 'Oggi' },
  { id: 'settimana', label: 'Prossimi 7 giorni' },
  { id: 'ritardo', label: 'In ritardo' },
] as const;

export type AgendaView =
  | { period: typeof agendaPeriods[number]['id'] }
  | { period: 'data'; date: string };

export type AgendaRange = { from?: string; to: string; openOnly: boolean };

export function agendaView(period: unknown, date: unknown): AgendaView {
  const day = z.iso.date().safeParse(date);
  if (day.success && day.data >= '0001-01-01') return { period: 'data', date: day.data };
  return { period: agendaPeriods.find(item => item.id === period)?.id ?? 'oggi' };
}

export function agendaRange(view: AgendaView, today: string): AgendaRange {
  if (view.period === 'ritardo') return { to: plusDays(today, -1), openOnly: true };
  if (view.period === 'settimana') return { from: plusDays(today, 1), to: plusDays(today, 7), openOnly: false };
  const day = view.period === 'data' ? view.date : today;
  return { from: day, to: day, openOnly: false };
}

export function inAgenda(job: Pick<Job, 'due_date' | 'status'>, range: AgendaRange) {
  return (!range.from || job.due_date >= range.from) && job.due_date <= range.to
    && (!range.openOnly || job.status !== 'done');
}
