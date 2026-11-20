import { z } from 'zod';
import { plusDays } from './domain.ts';
import { localOperations, operationSamples } from './operations-demo.ts';
import { validateWorkerDeadlineAction, workerDeadlineEntrySchema,
  type DeadlineWorker, type WorkerDeadline, type WorkerDeadlineAction } from './worker-deadlines.ts';
import { demoTombstoneIds } from './trash-storage.ts';

export const workerDeadlinesKey = 'imprelio-worker-deadlines-v1';
const stored = z.array(workerDeadlineEntrySchema);

function findWorker(records: ReturnType<typeof operationSamples>, workerId: string): DeadlineWorker | null {
  const person = records.find(record => record.kind === 'worker' && record.id === workerId);
  return person ? { id: person.id, name: person.title, archived: person.archived } : null;
}

export function sampleDeadlineWorker(today: string, workerId: string) {
  return findWorker(operationSamples(today), workerId);
}

export function localDeadlineWorker(today: string, workerId: string) {
  return findWorker(localOperations(today, 'personale'), workerId);
}

export function workerDeadlineDemoSamples(today: string): WorkerDeadline[] {
  const worker = operationSamples(today).find(record => record.kind === 'worker');
  if (!worker) return [];
  const defaults = { worker_id: worker.id, archived: false, updated_at: today + 'T08:00:00Z' };
  return [
    { ...defaults, id: '43d52564-19cd-4b38-b94b-0c5564030011', category: 'medical', title: 'Visita medica',
      completed_on: null, due_on: plusDays(today, 7) },
    { ...defaults, id: '43d52564-19cd-4b38-b94b-0c5564030012', category: 'certificate', title: 'Formazione ponteggi',
      completed_on: plusDays(today, -300), due_on: plusDays(today, 65) },
  ];
}

export function workerDeadlineSamples(today: string, workerId: string) {
  return workerDeadlineDemoSamples(today).filter(entry => entry.worker_id === workerId);
}

export function localWorkerDeadlineBacking(today: string): WorkerDeadline[] {
  try {
    const source = localStorage.getItem(workerDeadlinesKey);
    if (source === null) return workerDeadlineDemoSamples(today);
    const result = stored.safeParse(JSON.parse(source));
    if (result.success) return result.data;
  } catch { /* Keep stored records intact when they cannot be read. */ }
  throw new Error('Impossibile leggere le scadenze della demo.');
}

export function localWorkerDeadlineEntries(today: string): WorkerDeadline[] {
  const deleted = demoTombstoneIds('worker_deadline');
  return localWorkerDeadlineBacking(today).filter(entry => !deleted.has(entry.id));
}

export function localWorkerDeadlines(today: string, workerId: string) {
  return localWorkerDeadlineEntries(today).filter(entry => entry.worker_id === workerId);
}

export function writeLocalWorkerDeadline(today: string, input: WorkerDeadlineAction): WorkerDeadline {
  const action = validateWorkerDeadlineAction(input);
  const worker = localDeadlineWorker(today, action.worker_id);
  if (!worker || worker.archived) throw new Error('La scheda operaio non è disponibile per le modifiche.');
  if (demoTombstoneIds('worker_deadline').has(action.id)) throw new Error('La scadenza è nel cestino. Ripristinala prima di modificarla.');
  const entries = localWorkerDeadlineBacking(today);
  const previous = entries.find(entry => entry.id === action.id);
  if (previous && previous.worker_id !== worker.id) throw new Error('La registrazione non è disponibile.');
  const updated_at = new Date().toISOString();
  let saved: WorkerDeadline;
  if (action.action === 'save') {
    if (previous?.archived) throw new Error('Ripristina la registrazione prima di modificarla.');
    const { action: _, ...data } = action;
    saved = { ...data, archived: false, updated_at };
  } else {
    if (!previous) throw new Error('La registrazione non è disponibile.');
    const archived = action.action === 'archive';
    if (previous.archived === archived) return previous;
    saved = { ...previous, archived, updated_at };
  }
  localStorage.setItem(workerDeadlinesKey, JSON.stringify([saved, ...entries.filter(entry => entry.id !== saved.id)]));
  return saved;
}
