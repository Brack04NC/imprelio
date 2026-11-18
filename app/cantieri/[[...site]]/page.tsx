import { notFound, redirect } from 'next/navigation';
import { Dashboard } from '@/components/dashboard';
import { readWorkspace, session } from '@/lib/backend';
import { demoSeed, demoWorkspace } from '@/lib/demo';
import { parseWorkspaceParams, romeDate } from '@/lib/domain';

export default async function Cantieri({ params, searchParams }: {
  params: Promise<{ site?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ site }, rawQuery] = await Promise.all([params, searchParams]);
  if ((site?.length ?? 0) > 1) notFound();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(rawQuery)) if (typeof value === 'string') query.set(key, value);
  const { identity, db, signedIn } = await session(query.get('azienda'));
  if (!identity) redirect(signedIn ? '/login?errore=accesso' : '/login');
  const input = parseWorkspaceParams(query, site?.[0]);
  if (site?.[0] && !input.siteId) notFound();
  const today = romeDate();
  const workspace = db ? await readWorkspace(db, identity.org.id, input) : demoWorkspace(demoSeed(today), input, today);
  if (db && input.siteId && !workspace.current) notFound();
  return <Dashboard key={identity.org.id} identity={identity} initial={workspace} today={today} />;
}
