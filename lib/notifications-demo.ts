import { demoAgenda, demoKey, getDemo } from './demo';
import { z } from 'zod';
import { plusDays } from './domain';
import { estimatePdfFileName } from './estimate-pdf-archive';
import { listEstimatePdfs } from './estimate-pdf-archive-client';
import { estimatePricingKey, localPrices } from './estimate-pricing-demo';
import { buildNotifications, mergeNotificationHistory, notificationOccurrenceKey, notificationCategories, notificationAgendaDays,
  type NotificationCategory, type NotificationFeed, type NotificationItem, type NotificationSources } from './notifications';
import { localOperations, operationsKey } from './operations-demo';
import { demoTrashedQuotes, demoTrashedQuotesKey } from './trash-demo';
import { demoTrashKey } from './trash-storage';
import { localWorkerDeadlineEntries, workerDeadlinesKey } from './worker-deadlines-demo';
import type { WorkerDeadline } from './worker-deadlines';

export const notificationDemoStorageKeys = new Set([demoKey, operationsKey, estimatePricingKey, demoTrashKey, demoTrashedQuotesKey, workerDeadlinesKey, null]);

function workerReminders(entries: WorkerDeadline[], operations: NotificationSources['operations']) {
  const workers = new Map(operations.filter(record => record.kind === 'worker').map(record => [record.id, record]));
  return entries.flatMap(entry => {
    const worker = workers.get(entry.worker_id);
    return worker ? [{ ...entry, archived: entry.archived || worker.archived, workerName: worker.title }] : [];
  });
}

function agendaReminders(store: ReturnType<typeof getDemo>, today: string, history = false) {
  return demoAgenda(store, { to: plusDays(today, notificationAgendaDays), openOnly: !history }).items;
}

const historySchema = z.array(z.object({ key: z.string(), recorded_at: z.iso.datetime(), item: z.object({
  id: z.string(), category: z.enum(notificationCategories), priority: z.enum(['urgent', 'soon', 'info']),
  title: z.string(), detail: z.string(), status: z.string(), actionLabel: z.string(), date: z.iso.date().nullable(),
  href: z.string().regex(/^\/(agenda|gestione\/(amministrazione|computi-metrici|preventivi-computo|magazzino|operai\/[0-9a-f-]{36}\/scadenze))(\?[a-zA-Z0-9_=&%-]+)?(#archivio-pdf)?$/),
}) }));

function saveDemoHistory(organization: string, notices: NotificationItem[]) {
  const key = 'imprelio-cronologia-notifiche-v1:' + organization;
  const saved = historySchema.parse(JSON.parse(localStorage.getItem(key) ?? '[]'));
  const entries = new Map(saved.map(entry => [entry.key, entry]));
  const recorded = new Date().toISOString();
  for (const item of notices) {
    const key = notificationOccurrenceKey(item);
    entries.set(key, { key, item, recorded_at: entries.get(key)?.recorded_at ?? recorded });
  }
  const next = [...entries.values()];
  localStorage.setItem(key, JSON.stringify(next));
  return next;
}

export async function readDemoNotificationFeed(today: string, organization: string, signal: AbortSignal, history = false): Promise<NotificationFeed> {
  const store = getDemo(today);
  const operations = [...localOperations(today, 'amministrazione'), ...localOperations(today, 'computi-metrici'), ...localOperations(today, 'magazzino')];
  const { quotes } = localPrices();
  const unavailable: NotificationCategory[] = [];
  let workerDeadlines: NotificationSources['workerDeadlines'] = [];
  let pendingPdfs: NotificationSources['pendingPdfs'] = [];
  try {
    workerDeadlines = workerReminders(localWorkerDeadlineEntries(today), localOperations(today, 'personale'));
  } catch { unavailable.push('workers'); }
  try {
    const files = await listEstimatePdfs(organization, true, '', signal);
    // Archived originals use their own identifier. Active and deleted quotes both count as handled.
    const sourceKey = (site: string, name: string) => `${site}:${name}`;
    const handled = new Set([...quotes, ...demoTrashedQuotes()].map(quote => sourceKey(quote.site_id, estimatePdfFileName(quote.source_name))));
    const sites = new Set(store.sites.map(site => site.id));
    pendingPdfs = files.filter(file => sites.has(file.site_id) && !handled.has(sourceKey(file.site_id, file.file_name)));
  } catch { unavailable.push('estimates'); }
  const sources = { agenda: agendaReminders(store, today, history), operations, quotes, pendingPdfs, workerDeadlines };
  const items = buildNotifications(sources, today);
  const past = history ? buildNotifications(sources, today, true) : [];
  try {
    const saved = signal.aborted ? [] : await (navigator.locks
      ? navigator.locks.request('imprelio-notifiche:' + organization, () => signal.aborted ? [] : saveDemoHistory(organization, [...past, ...items]))
      : saveDemoHistory(organization, [...past, ...items]));
    return { items, unavailable, ...(history && { history: mergeNotificationHistory(items, past, saved, unavailable) }) };
  } catch {
    return { items, unavailable, historyUnavailable: true, ...(history && { history: mergeNotificationHistory(items, past, [], unavailable) }) };
  }
}
