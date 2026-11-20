import { demoAgenda, demoSeed, getDemo } from './demo.ts';
import { dashboardAgenda, dashboardAgendaRange, dashboardRecords, type DashboardData } from './home-dashboard-data.ts';
import { demoOperationsBacking, operationSamples } from './operations-demo.ts';
import { demoTombstoneIds } from './trash-storage.ts';

export function readDemoDashboard(today: string, persisted = typeof window !== 'undefined'): DashboardData {
  const store = persisted ? getDemo(today) : demoSeed(today);
  const deletedOperations = persisted ? demoTombstoneIds('operation') : new Set<string>();
  const operations = persisted ? demoOperationsBacking(today) : operationSamples(today);
  const clients = [...store.clients].sort((a, b) => a.name.localeCompare(b.name, 'it'));
  const clientNames = new Map(clients.map(client => [client.id, client.name]));
  const sites = store.sites.map(({ id, name, city, client_id }) => ({
    id, name, city, client_id, client: clientNames.get(client_id ?? '') ?? '',
  })).sort((a, b) => a.name.localeCompare(b.name, 'it'));
  return {
    calendar: dashboardAgenda(demoAgenda(store, dashboardAgendaRange(today)).items),
    sites, clients, records: dashboardRecords(operations.filter(record => !deletedOperations.has(record.id)), today),
  };
}
