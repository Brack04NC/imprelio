import { z } from 'zod';
import type { database } from './backend';
import type { demoSeed } from './demo';
import type { Client, Site } from './domain';

export type ClientSite = Pick<Site, 'id' | 'code' | 'name' | 'city' | 'address' | 'status'>;
export type ClientContact = { contact_name: string; email: string; phone: string; address: string; notes: string };
export type ClientEntry = Client & ClientContact & { sites: ClientSite[] };

export const clientSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(140),
  contact_name: z.string().trim().max(140),
  email: z.string().trim().max(254).toLowerCase().pipe(z.union([z.literal(''), z.email()])),
  phone: z.string().trim().max(50),
  address: z.string().trim().max(200),
  notes: z.string().trim().max(2000),
});

export function demoClientDirectory(store: ReturnType<typeof demoSeed>): ClientEntry[] {
  const sitesByClient = new Map<string, ClientSite[]>();
  for (const { client_id, id, code, name, city, address, status } of store.sites) {
    if (!client_id) continue;
    const sites = sitesByClient.get(client_id) ?? [];
    sites.push({ id, code, name, city, address, status });
    sitesByClient.set(client_id, sites);
  }
  return store.clients.map((client: Client & Partial<ClientContact>) => ({
    id: client.id, name: client.name, contact_name: client.contact_name ?? '', email: client.email ?? '',
    phone: client.phone ?? '', address: client.address ?? '', notes: client.notes ?? '',
    sites: sitesByClient.get(client.id) ?? [],
  }));
}

export async function readClientDirectory(db: Awaited<ReturnType<typeof database>>, org: string): Promise<ClientEntry[]> {
  const { data, error } = await db.rpc('imprelio_client_directory', { org });
  if (error) throw error;
  return data as ClientEntry[];
}
