import { z } from 'zod';

export const trashKinds = ['intervention', 'quote', 'operation', 'client', 'site', 'worker_deadline', 'estimate_pdf'] as const;
export type TrashKind = typeof trashKinds[number];

export const trashActionSchema = z.strictObject({
  kind: z.enum(trashKinds),
  action: z.enum(['delete', 'restore']),
  id: z.uuid(),
});

export type TrashAction = z.infer<typeof trashActionSchema>;
export type TrashEntry = { id: string; kind: TrashKind; label: string; deleted_at: string };

export const trashLabels: Record<TrashKind, { name: string; singular: string; deleted: string; restored: string }> = {
  intervention: { name: 'Interventi', singular: 'l’intervento', deleted: 'Intervento eliminato', restored: 'Intervento ripristinato' },
  quote: { name: 'Preventivi', singular: 'il preventivo', deleted: 'Preventivo eliminato', restored: 'Preventivo ripristinato' },
  operation: { name: 'Schede operative', singular: 'la scheda', deleted: 'Scheda eliminata', restored: 'Scheda ripristinata' },
  client: { name: 'Clienti', singular: 'il cliente', deleted: 'Cliente eliminato', restored: 'Cliente ripristinato' },
  site: { name: 'Cantieri', singular: 'il cantiere', deleted: 'Cantiere eliminato', restored: 'Cantiere ripristinato' },
  worker_deadline: { name: 'Scadenze operai', singular: 'la scadenza', deleted: 'Scadenza eliminata', restored: 'Scadenza ripristinata' },
  estimate_pdf: { name: 'PDF originali', singular: 'il PDF', deleted: 'PDF eliminato', restored: 'PDF ripristinato' },
};
