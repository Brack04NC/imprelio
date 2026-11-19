import 'server-only';
import type { database } from './backend';
import type { AgendaRange } from './agenda';
import type { AgendaItem } from './domain';

export async function readAgenda(
  db: Awaited<ReturnType<typeof database>>,
  org: string,
  range: AgendaRange,
) {
  const items: AgendaItem[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    let query = db.from('interventions')
      .select('id,site_id,kind,zone,due_date,time,notes,status,site:sites!inner(id,name,city)')
      .eq('organization_id', org).lte('due_date', range.to);
    if (range.from) query = query.gte('due_date', range.from);
    if (range.openOnly) query = query.neq('status', 'done');
    const { data, error } = await query.order('due_date').order('time', { nullsFirst: false }).order('id')
      .range(offset, offset + pageSize - 1).overrideTypes<AgendaItem[], { merge: false }>();
    if (error) throw error;
    items.push(...data);
    if (data.length < pageSize) return items;
  }
}
