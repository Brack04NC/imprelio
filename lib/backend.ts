import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient, type User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { demoIdentity } from './demo';
import type { Access, Action, Client, Identity, Organization, Workspace, WorkspaceInput } from './domain';

export const demoMode = !process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && !process.env.SUPABASE_SECRET_KEY;

export async function database() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Configurazione Supabase incompleta');
  const jar = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: entries => {
        try {
          for (const { name, value, options } of entries) jar.set(name, value, options);
        } catch { /* The proxy persists refreshed cookies when rendering a page. */ }
      },
    },
  });
}

type Database = Awaited<ReturnType<typeof database>>;

export async function session(preferred: string | null = null, claim = false) {
  if (demoMode) return { identity: demoIdentity, db: null, signedIn: true };
  const db = await database();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { identity: null, db, signedIn: false };
  if (claim) {
    const { error } = await db.rpc('claim_imprelio_invitations');
    if (error) throw error;
  }
  const { data, error } = await db.from('organization_members')
    .select('role, organizations!inner(id,name)').eq('user_id', user.id).eq('active', true)
    .order('organization_id');
  if (error) throw error;
  const orgs: Organization[] = (data ?? []).map(member => {
    const entry = member.organizations as unknown as Pick<Organization, 'id' | 'name'>;
    return { ...entry, role: member.role };
  });
  const org = orgs.find(item => item.id === preferred) ?? orgs[0];
  const email = user.email ?? '';
  const identity: Identity | null = org ? { email, name: email.split('@')[0], org, orgs, demo: false } : null;
  return { identity, db, signedIn: true };
}

export async function readWorkspace(db: Database, org: string, filters: WorkspaceInput): Promise<Workspace> {
  const { data, error } = await db.rpc('imprelio_workspace', {
    org, needle: filters.q, state: filters.status, requested_page: filters.page, selected: filters.siteId,
  });
  if (error) throw error;
  return data as Workspace;
}

export async function readClientOptions(db: Database, org: string): Promise<Client[]> {
  const clients: Client[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('clients').select('id,name')
      .eq('organization_id', org).order('name').order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    clients.push(...data);
    if (data.length < pageSize) return clients;
  }
}

export async function readAccess(db: Database, org: string): Promise<Access> {
  const [members, invites] = await Promise.all([
    db.from('organization_members').select('user_id,email,role,active').eq('organization_id', org).order('email'),
    db.from('invitations').select('email,created_at').eq('organization_id', org).order('created_at', { ascending: false }),
  ]);
  if (members.error || invites.error) throw members.error ?? invites.error;
  return { members: members.data as Access['members'], invitations: invites.data };
}

export function authRedirect() {
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const siteUrl = process.env.IMPRELIO_SITE_URL || (vercelHost ? `https://${vercelHost}` : 'http://localhost:3000');
  const url = new URL('/auth/conferma', siteUrl);
  return url.href;
}

export function needsInvitationPassword(user: User) {
  return user.user_metadata.imprelio_password_pending === true;
}

export async function write(db: Database, org: Organization, action: Action) {
  const { error } = await db.rpc('imprelio_write', { org: org.id, payload: action });
  if (error) {
    if (error.code === '23505' && action.action === 'invite') return 'Questa persona ha già accesso all’azienda.';
    if (error.code === 'P0002' || error.code === '23503') return 'Il dato collegato non è più disponibile.';
    return 'Salvataggio non riuscito. Riprova.';
  }
  if (action.action !== 'invite') return null;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return 'Invito registrato. Configura l’invio email e riprova.';
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await admin.auth.admin.inviteUserByEmail(action.email, {
    redirectTo: authRedirect(), data: { imprelio_password_pending: true },
  });
  if (result.error?.code === 'email_exists' || result.error?.code === 'user_already_exists') {
    const existing = await db.auth.signInWithOtp({
      email: action.email, options: { shouldCreateUser: false, emailRedirectTo: authRedirect() },
    });
    if (!existing.error) return null;
  }
  return result.error ? 'Invito registrato. L’email non è partita: riprova tra poco.' : null;
}
