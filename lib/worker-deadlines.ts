import { z } from 'zod';

const categories = ['medical', 'certificate', 'other'] as const;
export type WorkerDeadlineCategory = typeof categories[number];
export type WorkerDeadlineState = 'expired' | 'due' | 'future' | 'undated';
export type DeadlineWorker = { id: string; name: string; archived: boolean };

export const workerDeadlineCategoryLabels: Record<WorkerDeadlineCategory, string> = {
  medical: 'Visita medica',
  certificate: 'Certificazione',
  other: 'Altra scadenza',
};
export const workerDeadlineStateLabels: Record<WorkerDeadlineState, string> = {
  expired: 'Scaduta', due: 'In scadenza', future: 'Scadenza futura', undated: 'Senza scadenza',
};
export const workerDeadlineNoticeDays = 30;

const date = z.iso.date().refine(value => value >= '0001-01-01').nullable().default(null);
const identifiers = { id: z.uuid(), worker_id: z.uuid() };
const fields = {
  ...identifiers, category: z.enum(categories), title: z.string().trim().max(160).default(''),
  completed_on: date, due_on: date,
};
const actionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('save'), ...fields }),
  z.strictObject({ action: z.enum(['archive', 'restore']), ...identifiers }),
]);
export const workerDeadlineEntrySchema = z.object({ ...fields, archived: z.boolean(), updated_at: z.iso.datetime({ offset: true }) });
export type WorkerDeadline = z.infer<typeof workerDeadlineEntrySchema>;
export type WorkerDeadlineAction = z.infer<typeof actionSchema>;

export function validateWorkerDeadlineAction(raw: unknown): WorkerDeadlineAction {
  const result = actionSchema.safeParse(raw);
  if (!result.success) throw new Error('Controlla tipo, titolo e date prima di salvare.');
  const entry = result.data;
  if (entry.action !== 'save') return entry;
  const title = entry.category === 'medical' ? workerDeadlineCategoryLabels.medical : entry.title;
  if (!title) throw new Error('Inserisci il titolo della certificazione o scadenza.');
  if (!entry.completed_on && !entry.due_on) throw new Error('Inserisci almeno una data.');
  if (entry.completed_on && entry.due_on && entry.due_on < entry.completed_on) {
    throw new Error('La scadenza deve coincidere con la data registrata o essere successiva.');
  }
  return { ...entry, title };
}

export function workerDeadlineState({ due_on }: Pick<WorkerDeadline, 'due_on'>, today: string): WorkerDeadlineState {
  if (!due_on) return 'undated';
  if (due_on < today) return 'expired';
  const days = (Date.parse(due_on) - Date.parse(today)) / 86_400_000;
  return days <= workerDeadlineNoticeDays ? 'due' : 'future';
}
