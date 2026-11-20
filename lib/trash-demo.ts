import { demoKey, getDemo } from './demo.ts';
import { romeDate } from './domain.ts';
import { estimatePricingKey, localPrices } from './estimate-pricing-demo.ts';
import type { TrashAction } from './trash.ts';

function archiveKey(kind: TrashAction['kind']) {
  return 'imprelio-cestino-v1-' + kind;
}

function readArchive<T extends { id: string }>(kind: TrashAction['kind']): T[] {
  try {
    const records: unknown = JSON.parse(localStorage.getItem(archiveKey(kind)) ?? '[]');
    if (Array.isArray(records) && records.every(record => record && typeof record.id === 'string')) return records as T[];
  } catch { /* Protect archived data from an overwrite when storage is unreadable. */ }
  throw new Error('Impossibile leggere il cestino della demo.');
}

export function isDemoTrashed(kind: TrashAction['kind'], id: string) {
  return readArchive(kind).some(record => record.id === id);
}

function moveRecord<T extends { id: string }>(
  { kind, id, action }: TrashAction,
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
    localStorage.setItem(key, JSON.stringify([...archive.filter(record => record.id !== id), active]));
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
  if (!active) writeLive([...live, deleted]);
  localStorage.setItem(key, JSON.stringify(archive.filter(record => record.id !== id)));
}

export function writeDemoTrash(action: TrashAction, today = romeDate()) {
  if (action.kind === 'intervention') {
    const data = getDemo(today);
    moveRecord(action, data.jobs, jobs => localStorage.setItem(demoKey, JSON.stringify({ ...data, jobs })));
  } else {
    const data = localPrices();
    moveRecord(action, data.quotes, quotes => localStorage.setItem(estimatePricingKey, JSON.stringify({ ...data, quotes })));
  }
}
