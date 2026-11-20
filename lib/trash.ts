import { z } from 'zod';

export const trashActionSchema = z.strictObject({
  kind: z.enum(['intervention', 'quote']),
  action: z.enum(['delete', 'restore']),
  id: z.uuid(),
});

export type TrashAction = z.infer<typeof trashActionSchema>;
