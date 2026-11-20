import { compareJobs, PAGE_SIZE, plusDays } from './domain.ts';
import type { Access, Action, Client, Identity, Job, Row, Site, Workspace, WorkspaceInput } from './domain.ts';
import { inAgenda, type AgendaRange } from './agenda.ts';
import { isDemoTombstoned, readDemoTombstones } from './trash-storage.ts';

const key = (n: number) => '74b7f7a0-27a7-4cad-a670-' + String(n).padStart(12, '0');
const org = { id: key(1), name: 'Impresa Bellini', role: 'admin' as const };
export const demoIdentity: Identity = {
  name: 'Marco Bellini', email: 'marco@example.test', org, orgs: [org], demo: true,
};
type Demo = { sites: Site[]; jobs: Job[]; clients: Client[]; access: Access };

export function demoSeed(today: string): Demo {
  const clients = ['Studio Ferri', 'Edilnova S.r.l.', 'Condominio Verdi', 'Gruppo Armonia', 'Immobiliare Sole', 'Domus Costruzioni', 'Condominio Olmi', 'Studio Lodi'].map((name, i) => ({ id: key(20 + i), name }));
  const sites: Site[] = [
    { name: 'Palazzo Manzoni', city: 'Milano', address: 'Via Manzoni 24', manager: 'Luca Ferretti', status: 'active' },
    { name: 'Residenza Bosco', city: 'Monza', address: 'Via Libertà 18', manager: 'Sara Colombo', status: 'active' },
    { name: 'Condominio Verdi', city: 'Bergamo', address: 'Via Giuseppe Verdi 12', manager: 'Marco Bellini', status: 'planned' },
    { name: 'Corte San Marco', city: 'Milano', address: 'Via San Marco 9', manager: 'Luca Ferretti', status: 'active' },
    { name: 'Villa delle Magnolie', city: 'Como', address: 'Via delle Magnolie 7', manager: 'Sara Colombo', status: 'paused' },
    { name: 'Residenza Navigli', city: 'Milano', address: 'Ripa di Porta Ticinese 38', manager: 'Marco Bellini', status: 'closed' },
    { name: 'Corte degli Olmi', city: 'Monza', address: 'Via degli Olmi 8', manager: 'Luca Ferretti', status: 'active' },
    { name: 'Palazzo delle Arti', city: 'Bergamo', address: 'Via Tasso 19', manager: 'Sara Colombo', status: 'planned' },
  ].map((site, i) => ({ ...site, status: site.status as Site['status'], id: key(40 + i), code: 'CAN-' + String(i + 1).padStart(3, '0'), client_id: clients[i === 5 ? 0 : i].id }));
  const jobs: Job[] = [
    { site_id: key(40), due_date: today, time: '08:00', kind: 'assembly', zone: 'Facciata nord', status: 'progress' },
    { site_id: key(41), due_date: today, time: '11:30', kind: 'survey', zone: 'Cortile interno', status: 'scheduled' },
    { site_id: key(43), due_date: today, time: '14:00', kind: 'dismantling', zone: 'Lato est', status: 'scheduled' },
    { site_id: key(42), due_date: plusDays(today, 1), time: '09:00', kind: 'survey', zone: 'Facciata principale', status: 'scheduled' },
    { site_id: key(40), due_date: plusDays(today, 2), time: '08:00', kind: 'assembly', zone: 'Facciata sud', status: 'scheduled' },
    { site_id: key(44), due_date: plusDays(today, -2), time: null, kind: 'adjustment', zone: 'Ingresso', status: 'scheduled' },
    { site_id: key(46), due_date: plusDays(today, -1), time: null, kind: 'assembly', zone: 'Facciata ovest', status: 'scheduled' },
    { site_id: key(47), due_date: plusDays(today, 5), time: '10:00', kind: 'survey', zone: '', status: 'scheduled' },
    { site_id: key(45), due_date: plusDays(today, -8), time: '08:00', kind: 'dismantling', zone: 'Facciata nord', status: 'done' },
  ].map((job, i) => ({ ...job, id: key(60 + i), kind: job.kind as Job['kind'], status: job.status as Job['status'], notes: '' }));
  return { sites, clients, jobs, access: { members: [
    { user_id: key(2), email: demoIdentity.email, role: 'admin', active: true },
    { user_id: key(3), email: 'luca@example.test', role: 'coordinator', active: true },
  ], invitations: [] } };
}

export function demoAgenda(store: Demo, range: AgendaRange) {
  const sites = new Map(store.sites.map(site => [site.id, site]));
  const items = store.jobs.filter(job => inAgenda(job, range)).sort(compareJobs).flatMap(job => {
    const site = sites.get(job.site_id);
    return site ? [{ ...job, site: { id: site.id, name: site.name, city: site.city } }] : [];
  });
  return { items, sites: store.sites.map(({ id, name, city }) => ({ id, name, city })) };
}

export function demoWorkspace(store: Demo, input: WorkspaceInput, today: string): Workspace {
  const jobs = [...store.jobs].sort(compareJobs);
  const end = plusDays(today, 7);
  const openJobs = jobs.filter(job => job.status !== 'done');
  const rows: Row[] = store.sites.map(site => ({
    ...site, client: store.clients.find(client => client.id === site.client_id)?.name || '',
    nextJob: openJobs.find(job => job.site_id === site.id) ?? null,
  }));
  const query = input.q.toLocaleLowerCase('it');
  const results = rows.filter(row => (input.status === 'all' || row.status === input.status) &&
    [row.name, row.city, row.client, row.code].some(value => value.toLocaleLowerCase('it').includes(query)));
  const page = Math.min(input.page, Math.max(1, Math.ceil(results.length / PAGE_SIZE)));
  const current = rows.find(row => row.id === input.siteId);
  return {
    rows: results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    agenda: jobs.filter(job => (job.due_date >= today && job.due_date <= end) || (job.due_date < today && job.status !== 'done'))
      .flatMap(job => {
        const site = store.sites.find(site => site.id === job.site_id);
        return site ? [{ ...job, site }] : [];
      }),
    clients: [...store.clients].sort((a, b) => a.name.localeCompare(b.name, 'it')),
    current: current ? { site: current, jobs: jobs.filter(job => job.site_id === current.id) } : null,
    total: results.length, page,
    counts: {
      active: rows.filter(row => row.status === 'active').length,
      today: openJobs.filter(job => job.due_date === today).length,
      week: openJobs.filter(job => job.due_date > today && job.due_date <= end).length,
      overdue: openJobs.filter(job => job.due_date < today).length,
    },
  };
}

export function updateDemo(store: Demo, action: Action): Demo {
  const next = structuredClone(store);
  switch (action.action) {
    case 'site': {
      const { id, name, city, address, manager, status, new_client } = action;
      if (isDemoTombstoned('site', id)) throw new Error('Il cantiere è nel cestino. Ripristinalo prima di modificarlo.');
      let client_id = action.client_id;
      if (new_client) {
        const existing = next.clients.find(client => client.name.toLowerCase() === new_client.toLowerCase());
        client_id = existing?.id ?? crypto.randomUUID();
        if (!existing) next.clients.push({ id: client_id, name: new_client });
      }
      if (!client_id || !next.clients.some(client => client.id === client_id)) throw new Error('Seleziona il cliente del cantiere.');
      if (isDemoTombstoned('client', client_id)) throw new Error('Il cliente è nel cestino. Ripristinalo prima di collegarlo.');
      const existing = next.sites.find(site => site.id === id);
      const code = existing?.code ?? 'CAN-' + String(next.sites.length + 1).padStart(3, '0');
      const value = { id, name, city, address, manager, status, client_id, code };
      next.sites = existing ? next.sites.map(site => site.id === id ? value : site) : [value, ...next.sites];
      break;
    }
    case 'job': {
      const { id, site_id, kind, zone, due_date, time, notes, status } = action;
      if (!next.sites.some(site => site.id === site_id) || isDemoTombstoned('site', site_id)
        || next.jobs.some(job => job.id === id && job.site_id !== site_id))
        throw new Error('L’intervento o il cantiere collegato non è più disponibile.');
      const value = { id, site_id, kind, zone, due_date, time, notes, status };
      next.jobs = next.jobs.some(job => job.id === id)
        ? next.jobs.map(job => job.id === id && job.site_id === site_id ? value : job) : [...next.jobs, value];
      break;
    }
    case 'jobStatus':
      if (isDemoTombstoned('site', action.site_id) || !next.jobs.some(job => job.id === action.id && job.site_id === action.site_id))
        throw new Error('L’intervento non è più disponibile.');
      next.jobs = next.jobs.map(job => job.id === action.id && job.site_id === action.site_id ? { ...job, status: action.status } : job);
      break;
    case 'invite':
      if (next.access.members.some(item => item.email === action.email)) throw new Error('Questa persona ha già accesso all’azienda.');
      if (!next.access.invitations.some(item => item.email === action.email)) {
        next.access.invitations.push({ email: action.email, created_at: new Date().toISOString() });
      }
      break;
    case 'member':
      next.access.members = next.access.members.map(member => member.user_id === action.id && member.role === 'coordinator' ? { ...member, active: action.active } : member);
      break;
  }
  return next;
}

export const demoKey = 'imprelio-demo-v1';
export function getDemoBacking(today: string): Demo {
  try {
    const storage = localStorage.getItem(demoKey);
    const value = (storage ? JSON.parse(storage) : null) as Partial<Demo> | null;
    const validList = (items: unknown, fields: string[]) => Array.isArray(items) && items.every(item =>
      item && typeof item === 'object' && fields.every(field => typeof item[field] === 'string'));
    if (value && validList(value.sites, ['id', 'name', 'city', 'code'])
      && validList(value.jobs, ['id', 'site_id', 'due_date', 'kind', 'status'])
      && validList(value.clients, ['id', 'name'])
      && validList(value.access?.members, ['user_id', 'email', 'role'])
      && validList(value.access?.invitations, ['email', 'created_at'])) return value as Demo;
  } catch { /* Use sample data if storage is unreadable. */ }
  return demoSeed(today);
}

export function getDemo(today: string): Demo {
  const store = getDemoBacking(today);
  const trash = readDemoTombstones();
  const clients = new Set(trash.filter(entry => entry.kind === 'client').map(entry => entry.id));
  const sites = new Set(trash.filter(entry => entry.kind === 'site').map(entry => entry.id));
  return { ...store,
    clients: store.clients.filter(client => !clients.has(client.id)),
    sites: store.sites.filter(site => !sites.has(site.id)),
    jobs: store.jobs.filter(job => !sites.has(job.site_id)),
  };
}
