import { demoSeed, getDemo } from './demo.ts';
import { localPrices } from './estimate-pricing-demo.ts';
import { localOperations, operationSamples } from './operations-demo.ts';
import { areas, type OperationArea } from './operation-types.ts';
import { localVehicleAssignments, vehicleAssignmentSamples } from './vehicle-assignments.ts';
import type { ReportData } from './business-reports';

export function demoBusinessReportData(today: string, current = false): ReportData {
  const store = current ? getDemo(today) : demoSeed(today);
  const clients = new Map(store.clients.map(client => [client.id, client.name]));
  const sites = store.sites.map(({ id, name, city, client_id, status }) => ({
    id, name, city, client_id, status, client: clients.get(client_id ?? '') ?? '',
  }));
  const records = current ? (Object.keys(areas) as OperationArea[]).flatMap(area => localOperations(today, area))
    : operationSamples(today);
  return {
    sites, jobs: store.jobs, records,
    quotes: current ? localPrices().quotes : [],
    assignments: current ? localVehicleAssignments(today) : vehicleAssignmentSamples(today),
  };
}
