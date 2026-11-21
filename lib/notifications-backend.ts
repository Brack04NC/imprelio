import 'server-only';

import { readAgenda } from './agenda-backend';
import type { database } from './backend';
import { plusDays } from './domain';
import { readQuotes } from './estimate-pricing-backend';
import {
  buildNotifications, mergeNotificationHistory, notificationOccurrenceKey, notificationAgendaDays, notificationDeadlineDays, notificationReadyDays,
  vehicleNotificationDeadlines,
  type NotificationCategory, type NotificationFeed, type NotificationHistoryEntry, type NotificationItem, type NotificationSources,
} from './notifications';

type Database = Awaited<ReturnType<typeof database>>;
const pageSize = 500;
const vehicleDeadlineFilter = vehicleNotificationDeadlines.map(({ field }) => `fields->>${field}.not.is.null`).join(',');

async function readNotificationOperations(db: Database, org: string, type: 'documents' | 'estimates' | 'vehicles', since: string, history: boolean) {
  const records: NotificationSources['operations'] = [];
  for (let offset = 0; ; offset += pageSize) {
    const query = db.from('operation_records')
      .select('id,kind,site_id,title,status,record_date,fields,archived,updated_at')
      .eq('organization_id', org);
    if (!history) query.eq('archived', false);
    if (type === 'documents') {
      if (history) query.in('kind', ['invoice', 'order']);
      else query.or('and(kind.eq.invoice,status.eq.open),and(kind.eq.order,status.in.(sent,confirmed))');
    } else if (type === 'vehicles') {
      query.eq('kind', 'article').eq('fields->>category', 'vehicles').or(vehicleDeadlineFilter);
    } else {
      query.eq('kind', 'estimate');
      if (!history) query.or(`status.in.(draft,review),and(status.eq.approved,updated_at.gte.${since})`);
    }
    const { data, error } = await query.order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    records.push(...data as NotificationSources['operations']);
    if (data.length < pageSize) return records;
  }
}

async function readWorkerReminders(db: Database, org: string, until?: string) {
  type Entry = Omit<NotificationSources['workerDeadlines'][number], 'workerName'> & { worker: { title: string; archived: boolean } };
  const entries: NotificationSources['workerDeadlines'] = [];
  for (let offset = 0; ; offset += pageSize) {
    const query = db.from('worker_deadlines')
      .select('id,worker_id,category,title,due_on,archived,worker:operation_records!inner(title,archived)')
      .eq('organization_id', org).eq('worker.kind', 'worker');
    if (until) query.eq('archived', false).lte('due_on', until).eq('worker.archived', false);
    const { data, error } = await query
      .order('id').range(offset, offset + pageSize - 1).overrideTypes<Entry[], { merge: false }>();
    if (error) throw error;
    entries.push(...data.map(({ worker, ...entry }) => ({ ...entry, archived: entry.archived || worker.archived, workerName: worker.title })));
    if (data.length < pageSize) return entries;
  }
}

async function readPendingPdfs(db: Database, org: string) {
  const files: NotificationSources['pendingPdfs'] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.rpc('imprelio_pending_estimate_pdfs', { org })
      .order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = data as NotificationSources['pendingPdfs'];
    files.push(...rows);
    if (rows.length < pageSize) return files;
  }
}

async function readNotificationSources(db: Database, org: string, today: string, history: boolean) {
  // The full cutoff date in Rome is retained by allowing an extra UTC day before projection.
  const since = `${plusDays(today, -notificationReadyDays - 1)}T00:00:00Z`;
  const [agenda, documents, estimates, quotes, pendingPdfs, workers, vehicles] = await Promise.allSettled([
    readAgenda(db, org, { to: plusDays(today, notificationAgendaDays), openOnly: !history }),
    readNotificationOperations(db, org, 'documents', since, history),
    readNotificationOperations(db, org, 'estimates', since, history),
    readQuotes(db, org, history ? {} : { since }),
    readPendingPdfs(db, org),
    readWorkerReminders(db, org, history ? undefined : plusDays(today, notificationDeadlineDays)),
    readNotificationOperations(db, org, 'vehicles', since, history),
  ]);
  const unavailable = new Set<NotificationCategory>();
  function items<T>(result: PromiseSettledResult<T[]>, category: NotificationCategory): T[] {
    if (result.status === 'fulfilled') return result.value;
    unavailable.add(category);
    return [];
  }
  const sources: NotificationSources = {
    agenda: items(agenda, 'agenda'),
    operations: [...items(documents, 'deadlines'), ...items(estimates, 'estimates'), ...items(vehicles, 'vehicles')],
    quotes: items(quotes, 'estimates'),
    pendingPdfs: items(pendingPdfs, 'estimates'),
    workerDeadlines: items(workers, 'workers'),
  };
  return { sources, unavailable: [...unavailable] };
}

async function saveHistory(db: Database, org: string, entries: NotificationItem[]) {
  const unique = new Map(entries.map(item => [notificationOccurrenceKey(item), item]));
  const records = [...unique].map(([key, item]) => ({ key, item }));
  for (let offset = 0; offset < records.length; offset += 200) {
    const { error } = await db.rpc('imprelio_record_notifications', { org, reminders: records.slice(offset, offset + 200) });
    if (error) throw error;
  }
}

async function listHistory(db: Database, org: string) {
  const entries: NotificationHistoryEntry[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('notification_history').select('key,item,recorded_at').eq('organization_id', org)
      .order('recorded_at', { ascending: false }).order('key').range(offset, offset + pageSize - 1);
    if (error) throw error;
    entries.push(...data as NotificationHistoryEntry[]);
    if (data.length < pageSize) return entries;
  }
}

export async function readNotificationFeed(db: Database, org: string, today: string, history = false): Promise<NotificationFeed> {
  const { sources, unavailable } = await readNotificationSources(db, org, today, history);
  const items = buildNotifications(sources, today);
  const past = history ? buildNotifications(sources, today, true) : [];
  let historyUnavailable = false;
  let saved: NotificationHistoryEntry[] = [];
  try { await saveHistory(db, org, [...past, ...items]); }
  catch { historyUnavailable = true; }
  if (history) {
    try { saved = await listHistory(db, org); }
    catch { historyUnavailable = true; }
  }
  return { items, unavailable, historyUnavailable, ...(history && { history: mergeNotificationHistory(items, past, saved, unavailable) }) };
}
