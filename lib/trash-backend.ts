import 'server-only';

import type { database } from './backend';
import type { TrashEntry, TrashKind, TrashLabel } from './trash';

type Database = Awaited<ReturnType<typeof database>>;
const size = 300;

export function isTrashListMigrationMissing(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST202' || code === '42883' || code === '42P01';
}

export async function readTrashEntries(db: Database, org: string) {
  const entries: TrashEntry[] = [];
  for (let offset = 0; ; offset += size) {
    const { data, error } = await db.rpc('imprelio_trash_list', { org })
      .order('deleted_at', { ascending: false }).order('kind').order('id').range(offset, offset + size - 1);
    if (error) throw error;
    const page = data as TrashEntry[];
    entries.push(...page);
    if (page.length < size) return entries;
  }
}

export async function readTrashLabels(db: Database, org: string, kind: TrashKind, ids: string[]) {
  const labels: TrashLabel[] = [];
  const batchSize = 100;
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const { data, error } = await db.rpc('imprelio_trash_list', { org })
      .select('id,kind,label').eq('kind', kind).in('id', ids.slice(offset, offset + batchSize));
    if (error) throw error;
    labels.push(...data as TrashLabel[]);
  }
  return labels;
}
