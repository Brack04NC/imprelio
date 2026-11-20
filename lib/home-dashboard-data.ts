import { plusDays, type AgendaItem, type Client } from './domain.ts';
import { formatStockQuantity, getWarehouseAvailability, getTeamType, isBelowMinimum, stockMinimum } from './operation-resources.ts';
import type { OperationRecord, SiteOption } from './operation-types.ts';
import { vehicleMaintenance, vehicleMaintenanceState } from './vehicle-maintenance.ts';

export type DashboardAgendaItem = Omit<AgendaItem, 'notes'>;

export type DashboardRecord = Pick<OperationRecord, 'id' | 'kind' | 'title' | 'status' | 'site_id' | 'record_date'> & {
  detail: string;
  vehicle: boolean;
  availability?: { quantity: string; minimum: string; unit: string; low: boolean };
};

export type DashboardData = {
  calendar: DashboardAgendaItem[] | null;
  sites: SiteOption[] | null;
  clients: Client[] | null;
  records: DashboardRecord[] | null;
};

export function dashboardAgendaRange(today: string) {
  return { from: today, to: plusDays(today, 6), openOnly: false };
}

export function dashboardAgenda(items: AgendaItem[]): DashboardAgendaItem[] {
  return items.map(({ notes: _, ...item }) => item);
}

export function dashboardRecords(records: OperationRecord[], today: string): DashboardRecord[] {
  const balances = getWarehouseAvailability(records);
  return records.filter(record => !record.archived && record.kind !== 'movement')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.title.localeCompare(b.title, 'it') || a.id.localeCompare(b.id))
    .map(record => {
      const { id, kind, title, status, record_date, site_id, fields } = record;
      const vehicle = kind === 'article' && fields.category === 'vehicles';
      const base = { id, kind, title, status, record_date, site_id, vehicle };
      switch (kind) {
        case 'article': {
          const quantity = balances.get(id) ?? 0n;
          const maintenance = vehicleMaintenance(record);
          return {
            ...base, status: maintenance && vehicleMaintenanceState(maintenance, today) === 'active' ? 'inactive' : status,
            detail: [fields.plate || fields.serial_number || fields.code, fields.location].filter(Boolean).join(' · '),
            availability: { quantity: formatStockQuantity(quantity), minimum: formatStockQuantity(stockMinimum(record)),
              unit: fields.unit ?? '', low: isBelowMinimum(record, quantity) },
          };
        }
        case 'estimate': return { ...base, detail: fields.revision ? 'Revisione ' + fields.revision : '' };
        case 'employee': return { ...base, detail: fields.role ?? '' };
        case 'worker': return { ...base, detail: fields.qualification ?? '' };
        case 'crew': return { ...base, detail: getTeamType(fields) === 'internal' ? 'Squadra interna' : 'Squadra esterna' };
        default: return { ...base, detail: '' };
      }
    });
}
