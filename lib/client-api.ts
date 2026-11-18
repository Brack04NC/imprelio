import type { Action } from './domain';

export async function requestWorkspace<T>(query: URLSearchParams, signal?: AbortSignal, action?: Action): Promise<T> {
  const response = await fetch('/api/gestionale?' + query.toString(), {
    cache: 'no-store', signal,
    ...(action ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'Connessione non disponibile. Riprova.');
  return result as T;
}
