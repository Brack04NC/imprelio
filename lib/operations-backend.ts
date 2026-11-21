import 'server-only';
import type { database } from './backend';
import { vehicleStockConversionError, vehicleStockMovementError } from './operation-resources';
import { areas, type OperationArea, type OperationRecord, type OperationWrite, type SiteOption } from './operation-types';
import { maintenanceScheduleError, vehicleMaintenance } from './vehicle-maintenance';

type Database = Awaited<ReturnType<typeof database>>;
const pageSize = 500;

export async function readOperations(db: Database, organization: string, area: OperationArea): Promise<OperationRecord[]> {
  const records: OperationRecord[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('operation_records')
      .select('id,kind,site_id,title,status,record_date,fields,lines,archived,updated_at')
      .eq('organization_id', organization).in('kind', areas[area].kinds)
      .order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    records.push(...data as OperationRecord[]);
    if (data.length < pageSize) return records;
  }
}

export async function operationSites(db: Database, organization: string): Promise<SiteOption[]> {
  const sites: SiteOption[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('sites').select('id,name,city,client_id,clients(name)')
      .eq('organization_id', organization).order('name').order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const entry of data) {
      const client = entry.clients as unknown as {name: string} | null;
      sites.push({ id: entry.id, name: entry.name, city: entry.city, client_id: entry.client_id, client: client?.name ?? '' });
    }
    if (data.length < pageSize) return sites;
  }
}

export async function writeOperation(db: Database, organization: string, action: OperationWrite) {
  if (action.action === 'save' && vehicleMaintenance(action)) {
    const { error } = await db.from('vehicle_assignments').select('site_id').eq('organization_id', organization).limit(0);
    if (error && ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(error.code)) {
      throw new Error('Attiva la manutenzione con la migrazione 009 in Supabase.');
    }
    if (error) throw new Error('Impossibile verificare le assegnazioni. Riprova.');
  }
  const { error } = await db.rpc('imprelio_operation_write', { org: organization, payload: action });
  if (!error) return;
  if (error.code === '23P01' && error.message.includes('manutenzione')) throw new Error(maintenanceScheduleError);
  if (error.code === 'P0001') {
    if (error.message === 'I veicoli non hanno movimenti di magazzino') throw new Error(vehicleStockMovementError);
    if (error.message === 'Conversione in veicolo con movimenti attivi') throw new Error(vehicleStockConversionError);
    if (error.message.includes('Stock insufficiente')) throw new Error('La modifica porterebbe la giacenza sotto zero.');
    if (error.message.includes('Articolo con movimenti attivi')) throw new Error('Archivia prima i movimenti di questo articolo.');
  }
  if (error.code === 'P0002' || error.code === '23503') throw new Error('La scheda, il cantiere o l’articolo collegato non è più disponibile.');
  if (error.code === '42501') throw new Error('L’azienda non è accessibile con questo profilo.');
  if (error.code === '42P01' || error.code === 'PGRST202') throw new Error('Il database va aggiornato con la migrazione Operatività.');
  throw new Error('Salvataggio non riuscito. Riprova.');
}
