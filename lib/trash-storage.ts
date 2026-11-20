import { z } from 'zod';
import type { TrashEntry, TrashKind } from './trash.ts';

export const demoTrashKey = 'imprelio-cestino-schede-v1';
const kinds = ['operation', 'client', 'site', 'worker_deadline', 'estimate_pdf'] as const;
type TombstoneKind = Extract<TrashKind, typeof kinds[number]>;
type Tombstone = TrashEntry & { kind: TombstoneKind };
const tombstones = z.array(z.object({ kind: z.enum(kinds), id: z.uuid(), label: z.string(), deleted_at: z.iso.datetime() }));

export function readDemoTombstones(): Tombstone[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(demoTrashKey) ?? '[]');
    const result = tombstones.safeParse(value);
    if (result.success) return result.data;
  } catch { /* Keep the stored records intact when they cannot be read. */ }
  throw new Error('Impossibile leggere il cestino della demo.');
}

export function demoTombstoneIds(kind: TombstoneKind) {
  return new Set(readDemoTombstones().filter(entry => entry.kind === kind).map(entry => entry.id));
}

export function isDemoTombstoned(kind: TombstoneKind, id: string) {
  return readDemoTombstones().some(entry => entry.kind === kind && entry.id === id);
}

export function writeDemoTombstones(entries: Tombstone[]) {
  localStorage.setItem(demoTrashKey, JSON.stringify(entries));
}
