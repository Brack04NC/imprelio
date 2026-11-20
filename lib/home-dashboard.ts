import { z } from 'zod';
import type { Identity } from './domain.ts';

export const dashboardWidgetLabels = {
  calendar: 'Calendario',
  warehouse: 'Magazzino',
  estimates: 'Computi metrici',
  'site-interventions': 'Interventi di cantiere',
  sites: 'Cantieri',
  fleet: 'Veicoli',
  clients: 'Clienti',
  personnel: 'Personale e squadre',
  documents: 'Documenti',
} as const;

export type DashboardWidgetKind = keyof typeof dashboardWidgetLabels;

const widgetSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  kind: z.enum(Object.keys(dashboardWidgetLabels) as DashboardWidgetKind[]),
  target: z.uuid().nullable(),
  width: z.literal([1, 2]),
  height: z.literal([1, 2]),
});

export type DashboardWidget = z.infer<typeof widgetSchema>;
export const maxDashboardWidgets = 12;

const layoutSchema = z.array(widgetSchema).max(maxDashboardWidgets)
  .refine(widgets => new Set(widgets.map(widget => widget.id)).size === widgets.length);

export const defaultDashboardWidgets: readonly DashboardWidget[] = [
  { id: 'calendar', kind: 'calendar', target: null, width: 1, height: 1 },
  { id: 'warehouse', kind: 'warehouse', target: null, width: 1, height: 1 },
  { id: 'estimates', kind: 'estimates', target: null, width: 1, height: 1 },
  { id: 'site-interventions', kind: 'site-interventions', target: null, width: 1, height: 1 },
];

export function parseDashboardWidgets(value: unknown): DashboardWidget[] | null {
  const result = layoutSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function dashboardStorageKey(identity: Identity) {
  const account = identity.demo ? 'demo' : encodeURIComponent(identity.email.trim().toLowerCase());
  return `imprelio-dashboard-v1:${identity.org.id}:${account}`;
}
