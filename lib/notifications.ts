import { z } from 'zod';
import { kindLabels, plusDays, romeDate, type AgendaItem } from './domain.ts';
import type { EstimatePdfFile } from './estimate-pdf-archive.ts';
import type { QuoteSummary } from './estimate-pricing.ts';
import type { OperationRecord } from './operation-types.ts';
import { workerDeadlineCategoryLabels, workerDeadlineNoticeDays, type WorkerDeadline } from './worker-deadlines.ts';

export const notificationCategories = ['agenda', 'deadlines', 'estimates', 'workers', 'vehicles'] as const;
export type NotificationCategory = typeof notificationCategories[number];
export type NotificationPriority = 'urgent' | 'soon' | 'info';
export type NotificationItem = {
  id: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  detail: string;
  status: string;
  date: string | null;
  href: string;
  actionLabel: string;
  past?: boolean;
};
export type NotificationHistoryEntry = { key: string; item: NotificationItem; recorded_at: string };
export type NotificationFeed = { items: NotificationItem[]; unavailable: NotificationCategory[]; history?: NotificationItem[]; historyUnavailable?: boolean };

export type NotificationSources = {
  agenda: Pick<AgendaItem, 'id' | 'kind' | 'zone' | 'due_date' | 'time' | 'status' | 'site'>[];
  operations: Pick<OperationRecord, 'id' | 'kind' | 'site_id' | 'title' | 'status' | 'record_date' | 'fields' | 'archived' | 'updated_at'>[];
  quotes: Pick<QuoteSummary, 'id' | 'site_id' | 'title' | 'created_at'>[];
  pendingPdfs: Pick<EstimatePdfFile, 'id' | 'site_id' | 'file_name' | 'uploaded_at'>[];
  workerDeadlines: (Pick<WorkerDeadline, 'id' | 'worker_id' | 'category' | 'title' | 'due_on' | 'archived'> & { workerName: string })[];
};

export const notificationAgendaDays = 7;
export const notificationDeadlineDays = workerDeadlineNoticeDays;
export const notificationReadyDays = 30;
export const vehicleNotificationDeadlines = [
  { field: 'insurance_due_on', label: 'Assicurazione', id: 'vehicle-insurance' },
  { field: 'road_tax_due_on', label: 'Bollo', id: 'vehicle-road-tax' },
  { field: 'revision_due_on', label: 'Revisione', id: 'vehicle-review' },
  { field: 'service_due_on', label: 'Tagliando', id: 'vehicle-service' },
] as const;

const priorities: Record<NotificationPriority, number> = { urgent: 0, soon: 1, info: 2 };
const dateSchema = z.iso.date();

function isDate(date: string | null | undefined): date is string {
  return typeof date === 'string' && date >= '0001-01-01' && dateSchema.safeParse(date).success;
}

function activityDate(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? romeDate(date) : null;
}

function path(url: string, params: Record<string, string>) {
  return url + '?' + new URLSearchParams(params);
}

function compareNotifications(a: NotificationItem, b: NotificationItem) {
  const priority = priorities[a.priority] - priorities[b.priority];
  if (priority) return priority;
  if (a.date && b.date && a.date !== b.date) return a.priority === 'info'
    ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
  return Number(!a.date) - Number(!b.date) || a.title.localeCompare(b.title, 'it') || a.id.localeCompare(b.id);
}

export function buildNotifications(sources: NotificationSources, today: string, past = false): NotificationItem[] {
  const agendaUntil = plusDays(today, notificationAgendaDays);
  const deadlineUntil = plusDays(today, notificationDeadlineDays);
  const readySince = plusDays(today, -notificationReadyDays);
  const entries: NotificationItem[] = [];
  const urgency = (date: string) => date <= today ? 'urgent' : 'soon';
  const recent = (date: string | null): date is string => date !== null && date >= readySince && date <= today;

  for (const job of sources.agenda) {
    const date = job.due_date;
    if (!isDate(date) || (past ? job.status !== 'done' : job.status === 'done' || date > agendaUntil)) continue;
    entries.push({
      id: `agenda:${job.id}`, category: 'agenda', priority: past ? 'info' : urgency(date), date,
      title: [kindLabels[job.kind], job.zone].filter(Boolean).join(' · '),
      detail: [job.site.name, job.time && `Ore ${job.time.slice(0, 5)}`].filter(Boolean).join(' · '),
      status: past ? 'Completato' : date < today ? 'In ritardo' : date === today ? 'Oggi' : 'In programma',
      href: path('/agenda', { data: date }), actionLabel: 'Apri agenda',
    });
  }

  for (const record of sources.operations) {
    if (record.archived && !past) continue;
    if (record.kind === 'article' && record.fields.category === 'vehicles') {
      for (const { field, label, id } of vehicleNotificationDeadlines) {
        const date = record.fields[field];
        if (!isDate(date) || (past ? !record.archived || date > today : date > deadlineUntil)) continue;
        entries.push({
          id: `${id}:${record.id}`, category: 'vehicles', priority: past ? 'info' : urgency(date), date,
          title: `${label} · ${record.title}`, detail: record.fields.code || 'Veicolo',
          status: past ? 'Veicolo archiviato' : date < today ? 'Scaduta' : date === today ? 'Scade oggi' : 'In scadenza',
          href: path('/gestione/magazzino', { veicolo: record.id }), actionLabel: 'Apri veicolo',
        });
      }
    }
    if (record.kind === 'estimate') {
      const ready = record.status === 'approved';
      const date = ready ? activityDate(record.updated_at) : null;
      if (past ? !(ready && date && (record.archived || date < readySince))
        : ready ? !recent(date) : record.status !== 'draft' && record.status !== 'review') continue;
      entries.push({
        id: `estimate:${record.id}`, category: 'estimates', priority: ready ? 'info' : 'soon', date,
        title: record.title, detail: 'Computo metrico',
        status: ready ? 'Approvato' : record.status === 'review' ? 'In revisione' : 'Bozza',
        href: path('/gestione/computi-metrici', { scheda: record.id }), actionLabel: 'Apri computo',
      });
    }
    if (record.kind === 'invoice' && (past ? record.status === 'paid' || (record.archived && record.status === 'open') : record.status === 'open')) {
      const date = record.fields.due_date;
      if (!isDate(date) || (!past && date > deadlineUntil)) continue;
      entries.push({
        id: `invoice:${record.id}`, category: 'deadlines', priority: past ? 'info' : urgency(date), date,
        title: `Fattura ${record.title}`, detail: record.fields.party || 'Scadenza di pagamento',
        status: past ? record.status === 'paid' ? 'Saldata' : 'Archiviata' : date < today ? 'Scaduta' : date === today ? 'Scade oggi' : 'In scadenza',
        href: path('/gestione/amministrazione', { tipo: record.kind, scheda: record.id }), actionLabel: 'Apri fattura',
      });
    }
    const awaitingDelivery = record.status === 'sent' || record.status === 'confirmed';
    if (record.kind === 'order' && (past ? record.status === 'delivered' || record.status === 'cancelled' || (record.archived && awaitingDelivery) : awaitingDelivery)) {
      const date = record.fields.expected_date;
      if (!isDate(date) || (!past && date > deadlineUntil)) continue;
      entries.push({
        id: `order:${record.id}`, category: 'deadlines', priority: past ? 'info' : urgency(date), date,
        title: `Ordine ${record.title}`, detail: record.fields.supplier || 'Consegna',
        status: past ? (record.status === 'delivered' ? 'Consegnato' : record.status === 'cancelled' ? 'Annullato' : 'Archiviato')
          : date < today ? 'Consegna in ritardo' : date === today ? 'Consegna oggi' : 'Consegna prevista',
        href: path('/gestione/amministrazione', { tipo: record.kind, scheda: record.id }), actionLabel: 'Apri ordine',
      });
    }
  }

  for (const quote of sources.quotes) {
    const date = activityDate(quote.created_at);
    if (!date || (past ? date >= readySince : !recent(date))) continue;
    entries.push({
      id: `quote:${quote.id}`, category: 'estimates', priority: 'info', date,
      title: quote.title, detail: 'Preventivo da PDF', status: 'Pronto',
      href: path('/gestione/preventivi-computo', { cantiere: quote.site_id, preventivo: quote.id }), actionLabel: 'Apri preventivo',
    });
  }

  for (const pdf of past ? [] : sources.pendingPdfs) {
    entries.push({
      id: `pdf:${pdf.id}`, category: 'estimates', priority: 'soon', date: null,
      title: pdf.file_name, detail: 'Computo PDF archiviato', status: 'Preventivo in attesa',
      href: path('/gestione/preventivi-computo', { cantiere: pdf.site_id, pdf: pdf.id }) + '#archivio-pdf', actionLabel: 'Apri archivio PDF',
    });
  }

  for (const entry of sources.workerDeadlines) {
    const date = entry.due_on;
    if (!isDate(date) || (past ? !entry.archived : entry.archived || date > deadlineUntil)) continue;
    const label = workerDeadlineCategoryLabels[entry.category];
    entries.push({
      id: `worker:${entry.worker_id}:${entry.id}`, category: 'workers', priority: past ? 'info' : urgency(date), date,
      title: entry.category === 'medical' ? label : entry.title,
      detail: entry.category === 'medical' ? entry.workerName : `${entry.workerName} · ${label}`,
      status: past ? 'Archiviata' : date < today ? 'Scaduta' : date === today ? 'Scade oggi' : 'In scadenza',
      href: '/gestione/operai/' + encodeURIComponent(entry.worker_id) + '/scadenze', actionLabel: 'Apri scadenze operaio',
    });
  }

  return entries.sort(compareNotifications);
}

export function notificationOccurrenceKey(item: NotificationItem) {
  return `${item.id}|${item.id.startsWith('estimate:') ? item.status : item.date ?? ''}`;
}

export function mergeNotificationHistory(current: NotificationItem[], past: NotificationItem[], saved: NotificationHistoryEntry[], unavailable: NotificationCategory[] = []) {
  const activeKeys = new Set(current.map(notificationOccurrenceKey));
  const timeline = new Map(saved.map(entry => [entry.key, entry]));
  for (const item of [...past, ...current]) {
    const key = notificationOccurrenceKey(item);
    timeline.set(key, { key, item, recorded_at: timeline.get(key)?.recorded_at ?? '' });
  }
  return [...timeline.values()].sort((a, b) => (b.item.date ?? b.recorded_at).localeCompare(a.item.date ?? a.recorded_at)
    || b.recorded_at.localeCompare(a.recorded_at) || a.key.localeCompare(b.key))
    .map(({ key, item }) => ({ ...item, id: key, past: !activeKeys.has(key) && !unavailable.includes(item.category) }));
}
