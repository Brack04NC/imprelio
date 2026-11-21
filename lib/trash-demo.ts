import { demoKey, getDemoBacking } from './demo.ts';
import { kindLabels, romeDate, type Job } from './domain.ts';
import { getDemoIntakeDocument } from './document-intake-demo.ts';
import { getDemoEstimatePdf } from './estimate-pdf-archive-client.ts';
import { estimatePricingKey, localPrices } from './estimate-pricing-demo.ts';
import type { QuoteSummary } from './estimate-pricing.ts';
import { getWarehouseAvailability } from './operation-resources.ts';
import { demoOperationsBacking, localOperations } from './operations-demo.ts';
import { demoTrashKey, isDemoTombstoned, readDemoTombstones, writeDemoTombstones } from './trash-storage.ts';
import type { TrashAction, TrashEntry, TrashKind } from './trash.ts';
import { localWorkerDeadlineBacking } from './worker-deadlines-demo.ts';

type LegacyKind = Extract<TrashKind, 'intervention' | 'quote'>;
type ArchivedRecord = { id: string; deleted_at?: string };

function archiveKey(kind: LegacyKind) {
  return 'imprelio-cestino-v1-' + kind;
}

function readArchive<T extends { id: string }>(kind: LegacyKind): (T & ArchivedRecord)[] {
  try {
    const records: unknown = JSON.parse(localStorage.getItem(archiveKey(kind)) ?? '[]');
    if (Array.isArray(records) && records.every(record => record && typeof record.id === 'string')) return records;
  } catch { /* Protect archived data from an overwrite when storage is unreadable. */ }
  throw new Error('Impossibile leggere il cestino della demo.');
}

export function isDemoTrashed(kind: TrashKind, id: string) {
  return kind === 'intervention' || kind === 'quote' ? readArchive(kind).some(record => record.id === id) : isDemoTombstoned(kind, id);
}

export const demoTrashedQuotesKey = archiveKey('quote');
export const demoTrashedInterventionsKey = archiveKey('intervention');

export function demoTrashedQuotes() {
  return readArchive<QuoteSummary>('quote').filter(quote => typeof quote.source_name === 'string' && typeof quote.site_id === 'string');
}

function moveRecord<T extends { id: string; site_id: string }>(
  { kind, id, action }: { kind: LegacyKind; id: string; action: TrashAction['action'] },
  live: T[],
  writeLive: (records: T[]) => void,
) {
  const key = archiveKey(kind);
  const archive = readArchive<T>(kind);
  const active = live.find(record => record.id === id);
  const deleted = archive.find(record => record.id === id);

  if (action === 'delete') {
    if (!active) {
      if (deleted) return;
      throw new Error('L’elemento non è più disponibile.');
    }
    // Write the archive first so a storage failure cannot discard the only copy.
    localStorage.setItem(key, JSON.stringify([...archive.filter(record => record.id !== id), { ...active, deleted_at: new Date().toISOString() }]));
    try {
      writeLive(live.filter(record => record.id !== id));
    } catch (error) {
      localStorage.setItem(key, JSON.stringify(archive));
      throw error;
    }
    return;
  }

  if (!deleted) {
    if (active) return;
    throw new Error('L’elemento non è più disponibile.');
  }
  if (isDemoTombstoned('site', deleted.site_id)) throw new Error('Ripristina prima il cantiere collegato.');
  if (!active) {
    const { deleted_at: _, ...record } = deleted;
    writeLive([...live, record as T]);
  }
  localStorage.setItem(key, JSON.stringify(archive.filter(record => record.id !== id)));
}

export function readDemoTrash(today = romeDate()): TrashEntry[] {
  if (typeof localStorage === 'undefined') return [];
  const sites = new Map(getDemoBacking(today).sites.map(site => [site.id, site.name]));
  const deletedAt = (record: ArchivedRecord) => typeof record.deleted_at === 'string' && Number.isFinite(Date.parse(record.deleted_at)) ? record.deleted_at : '';
  const jobs = readArchive<Job>('intervention').map(record => ({
    kind: 'intervention' as const, id: record.id, deleted_at: deletedAt(record),
    label: [kindLabels[record.kind] ?? 'Intervento', record.zone, sites.get(record.site_id)].filter(Boolean).join(' · '),
  }));
  const quotes = readArchive<QuoteSummary>('quote').map(record => ({
    kind: 'quote' as const, id: record.id, deleted_at: deletedAt(record), label: record.title || 'Preventivo',
  }));
  return [...readDemoTombstones(), ...jobs, ...quotes].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at) || a.id.localeCompare(b.id));
}

function operationLabel(today: string, id: string, action: TrashAction['action'] | null) {
  const record = demoOperationsBacking(today).find(row => row.id === id);
  if (!record || record.archived || !action) return record?.title;
  const restore = action === 'restore';
  const warehouse = localOperations(today, 'magazzino');
  if (!restore && record.kind === 'article' && warehouse.some(row => row.kind === 'movement' && !row.archived && row.fields.article_id === id)) {
    throw new Error('Archivia o elimina prima i movimenti attivi di questo articolo.');
  }
  if (record.kind === 'movement') {
    if (restore && !warehouse.some(row => row.id === record.fields.article_id && row.kind === 'article' && !row.archived)) {
      throw new Error('Ripristina prima l’articolo collegato.');
    }
    const next = restore ? [...warehouse.filter(row => row.id !== id), record] : warehouse.filter(row => row.id !== id);
    if ([...getWarehouseAvailability(next).values()].some(balance => balance < 0n)) {
      throw new Error('La modifica porterebbe la giacenza sotto zero.');
    }
  }
  return record.title;
}

async function mutateDemoTrash(action: TrashAction, today: string) {
  if (action.kind === 'intervention') {
    const data = getDemoBacking(today);
    moveRecord({ ...action, kind: 'intervention' }, data.jobs, jobs => localStorage.setItem(demoKey, JSON.stringify({ ...data, jobs })));
    return;
  }
  if (action.kind === 'quote') {
    const data = localPrices();
    moveRecord({ ...action, kind: 'quote' }, data.quotes, quotes => localStorage.setItem(estimatePricingKey, JSON.stringify({ ...data, quotes })));
    return;
  }

  const { kind, id } = action;
  const file = kind === 'estimate_pdf' ? await getDemoEstimatePdf(id) : null;
  const document = kind === 'document_import' ? await getDemoIntakeDocument(id) : null;
  const trash = readDemoTombstones();
  const found = trash.some(entry => entry.kind === kind && entry.id === id);
  const restore = action.action === 'restore';
  if (!restore && found) return;
  let label: string | undefined;
  switch (kind) {
    case 'operation':
      label = operationLabel(today, id, restore && !found ? null : action.action);
      break;
    case 'client': {
      const store = getDemoBacking(today);
      label = store.clients.find(client => client.id === id)?.name;
      const removedSites = new Set(trash.filter(entry => entry.kind === 'site').map(entry => entry.id));
      if (!restore && label && store.sites.some(site => site.client_id === id && !removedSites.has(site.id))) {
        throw new Error('Sposta o elimina prima i cantieri collegati a questo cliente.');
      }
      break;
    }
    case 'site': {
      const site = getDemoBacking(today).sites.find(record => record.id === id);
      label = site?.name;
      if (restore && found && site?.client_id && isDemoTombstoned('client', site.client_id)) {
        throw new Error('Ripristina prima il cliente collegato.');
      }
      break;
    }
    case 'worker_deadline': {
      const entry = localWorkerDeadlineBacking(today).find(row => row.id === id);
      label = entry?.title;
      if (restore && found && entry && isDemoTombstoned('operation', entry.worker_id)) {
        throw new Error('Ripristina prima l’operaio collegato.');
      }
      break;
    }
    case 'estimate_pdf':
      label = file?.file_name;
      break;
    case 'document_import':
      label = document?.file_name;
      if (restore && found && document?.site_id && isDemoTombstoned('site', document.site_id)) {
        throw new Error('Ripristina prima il cantiere collegato.');
      }
  }
  if (!label) throw new Error('L’elemento non è più disponibile.');
  if (restore && !found) return;
  writeDemoTombstones(restore ? trash.filter(entry => entry.kind !== kind || entry.id !== id)
    : [...trash, { id, kind, label, deleted_at: new Date().toISOString() }]);
}

export async function writeDemoTrash(action: TrashAction, today = romeDate()) {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(demoTrashKey, () => mutateDemoTrash(action, today));
  }
  return mutateDemoTrash(action, today);
}
