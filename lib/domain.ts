import { z } from 'zod';

export const siteStates = ['active', 'planned', 'paused', 'closed'] as const;
export const jobStates = ['scheduled', 'progress', 'done'] as const;
export const jobKinds = ['survey', 'assembly', 'adjustment', 'dismantling', 'other'] as const;

export type SiteState = typeof siteStates[number];
export type JobState = typeof jobStates[number];
export type JobKind = typeof jobKinds[number];

export const siteLabels: Record<SiteState, string> = {
  active: 'In corso', planned: 'Da avviare', paused: 'In pausa', closed: 'Concluso',
};
export const jobLabels: Record<JobState, string> = {
  scheduled: 'Programmato', progress: 'In corso', done: 'Completato',
};
export const kindLabels: Record<JobKind, string> = {
  survey: 'Sopralluogo', assembly: 'Montaggio', adjustment: 'Modifica', dismantling: 'Smontaggio', other: 'Altro',
};

export type Client = { id: string; name: string };
export type Site = {
  id: string; code: string; name: string; city: string; address: string;
  client_id: string | null; manager: string; status: SiteState;
};
export type Job = {
  id: string; site_id: string; kind: JobKind; zone: string; due_date: string;
  time: string | null; notes: string; status: JobState;
};
export type Row = Site & { client: string; nextJob: Job | null };
export type AgendaItem = Job & { site: Pick<Site, 'id' | 'name' | 'city'> };
export type Organization = { id: string; name: string; role: 'admin' | 'coordinator' };
export type Identity = { name: string; email: string; org: Organization; orgs: Organization[]; demo: boolean };
export type Workspace = {
  rows: Row[]; agenda: AgendaItem[]; clients: Client[]; current: { site: Row; jobs: Job[] } | null;
  total: number; page: number; counts: { active: number; week: number; overdue: number; today: number };
};
export type WorkspaceInput = {
  q: string; status: SiteState | 'all'; page: number; siteId: string | null;
};
export type Member = { user_id: string; email: string; role: 'admin' | 'coordinator'; active: boolean };
export type Invitation = { email: string; created_at: string };
export type Access = { members: Member[]; invitations: Invitation[] };

const id = z.uuid();
const text = (max: number) => z.string().trim().max(max);
const date = z.iso.date();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable();

export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('site'), id, name: text(120).min(1), city: text(100).min(1),
    address: text(200), manager: text(100), status: z.enum(siteStates), client_id: id.nullable(),
    new_client: text(140) }).refine(data => Boolean(data.client_id || data.new_client), { message: 'Seleziona il cliente.' }),
  z.object({ action: z.literal('job'), id, site_id: id, kind: z.enum(jobKinds), zone: text(120),
    due_date: date, time, notes: text(2000), status: z.enum(jobStates) }),
  z.object({ action: z.literal('jobStatus'), id, site_id: id, status: z.enum(jobStates) }),
  z.object({ action: z.literal('invite'), email: z.email().max(254).transform(email => email.toLowerCase()) }),
  z.object({ action: z.literal('member'), id, active: z.boolean() }),
]);
export type Action = z.infer<typeof actionSchema>;

export const PAGE_SIZE = 6;

const romeDayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
export function romeDate(now = new Date()) {
  return romeDayFormatter.format(now);
}

export function plusDays(date: string, days: number) {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('it-IT', { ...options, timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
}

export function compareJobs(a: Job, b: Job) {
  return a.due_date.localeCompare(b.due_date) || (a.time || '24:00').localeCompare(b.time || '24:00') || a.id.localeCompare(b.id);
}

export function parseWorkspaceParams(params: URLSearchParams, siteId: string | null = null): WorkspaceInput {
  const status = z.enum(siteStates).safeParse(params.get('stato'));
  const page = Number(params.get('pagina'));
  const selected = id.safeParse(siteId ?? params.get('cantiere'));
  return {
    q: (params.get('q') || '').trim().slice(0, 120), status: status.success ? status.data : 'all',
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1,
    siteId: selected.success ? selected.data : null,
  };
}
