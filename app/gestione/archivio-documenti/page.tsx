import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { DocumentIntake } from '@/components/document-intake';
import { session } from '@/lib/backend';
import { documentKindSchema } from '@/lib/document-intake';
import { romeDate } from '@/lib/domain';
import { operationSites } from '@/lib/operations-backend';
import { demoSiteOptions } from '@/lib/operations-demo';

export const metadata: Metadata = { title: 'Archivio documenti' };

export default async function DocumentArchivePage({ searchParams }: {
  searchParams: Promise<{ azienda?: string; cantiere?: string; tipo?: string; importa?: string }>;
}) {
  const query = await searchParams;
  const { identity, db, signedIn } = await session(typeof query.azienda === 'string' ? query.azienda : null);
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  const sites = db ? await operationSites(db, identity.org.id) : demoSiteOptions(romeDate());
  const site = z.uuid().safeParse(query.cantiere);
  const kind = documentKindSchema.safeParse(query.tipo);
  const initialSite = site.success && (!db || sites.some(option => option.id === site.data)) ? site.data : undefined;
  const initialKind = kind.success ? kind.data : undefined;
  return <DocumentIntake key={JSON.stringify([identity.org.id, initialSite, initialKind, query.importa])}
    identity={identity} sites={sites} initialSite={initialSite} initialKind={initialKind} initialImport={query.importa === '1'}/>;
}
