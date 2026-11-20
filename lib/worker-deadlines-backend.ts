import 'server-only';
import type { database } from './backend';
import type { DeadlineWorker, WorkerDeadline, WorkerDeadlineAction } from './worker-deadlines';

type Database = Awaited<ReturnType<typeof database>>;
const pageSize = 500;

export function isWorkerDeadlinesMigrationMissing(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205';
}

export async function readDeadlineWorker(db: Database, organization: string, workerId: string): Promise<DeadlineWorker | null> {
  const { data, error } = await db.from('operation_records').select('id,title,archived')
    .eq('organization_id', organization).eq('kind', 'worker').eq('id', workerId).maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, name: data.title, archived: data.archived } : null;
}

export async function readWorkerDeadlines(db: Database, organization: string, workerId: string) {
  const entries: WorkerDeadline[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('worker_deadlines')
      .select('id,worker_id,category,title,completed_on,due_on,archived,updated_at')
      .eq('organization_id', organization).eq('worker_id', workerId)
      .order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    entries.push(...data as WorkerDeadline[]);
    if (data.length < pageSize) return entries;
  }
}

export async function writeWorkerDeadline(db: Database, organization: string, action: WorkerDeadlineAction): Promise<WorkerDeadline> {
  const { data, error } = await db.rpc('imprelio_worker_deadline_write', { org: organization, payload: action });
  if (error) throw error;
  return data as WorkerDeadline;
}
