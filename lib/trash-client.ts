'use client';

import type { Identity } from './domain';
import type { TrashAction } from './trash';
import { writeDemoTrash } from './trash-demo';

export async function persistTrash(identity: Identity, action: TrashAction) {
  if (identity.demo) {
    await writeDemoTrash(action);
    return;
  }
  const response = await fetch('/api/cestino?' + new URLSearchParams({ azienda: identity.org.id }), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error ?? 'Operazione non riuscita. Riprova.');
}
