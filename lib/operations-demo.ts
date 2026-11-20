import { demoSeed, getDemo } from './demo.ts';
import { getWarehouseAvailability } from './operation-resources.ts';
import { areas, operationKinds, type OperationArea, type OperationKind, type OperationRecord, type OperationWrite, type SiteOption } from './operation-types.ts';
import { plusDays } from './domain.ts';
import { demoTombstoneIds } from './trash-storage.ts';

export const operationsKey = 'imprelio-operations-v1';
const id = (n: number) => '30638ab7-70df-485d-81da-' + String(n).padStart(12, '0');

export function operationSamples(today: string): OperationRecord[] {
  const [{ id: site }, { id: another }] = demoSeed(today).sites;
  const sample = (n: number, kind: OperationKind, title: string, status: string, site_id: string | null,
    fields: OperationRecord['fields'], lines: OperationRecord['lines'] = [], record_date: string | null = today): OperationRecord => ({
    id: id(n), kind, title, status, site_id, fields, lines, record_date, updated_at: today + 'T08:00:00Z', archived: false,
  });
  return [
    sample(1, 'article', 'Telaio ponteggio 105', 'active', null, { code: 'MAT-001', category: 'materials', unit: 'pz', stock_min: '20', location: 'Deposito A' }, [], null),
    sample(2, 'article', 'Autocarro con gru', 'active', null, { code: 'VEI-002', category: 'vehicles', unit: 'pz', stock_min: '1', location: 'Piazzale', revision_due_on: plusDays(today, 12) }, [], null),
    sample(3, 'movement', 'Carico iniziale telai', 'recorded', null, { article_id: id(1), direction: 'in', quantity: '120' }, [], plusDays(today, -2)),
    sample(4, 'movement', 'Telai per facciata nord', 'recorded', site, { article_id: id(1), direction: 'out', quantity: '36' }),
    sample(5, 'movement', 'Registrazione autocarro', 'recorded', null, { article_id: id(2), direction: 'in', quantity: '1' }),
    sample(6, 'employee', 'Sara Colombo', 'active', another, { code: 'DIP-002', role: 'Coordinatrice' }, [], null),
    sample(7, 'worker', 'Luca Ferretti', 'active', site, { code: 'OPE-004', qualification: 'Montaggio ponteggi' }, [], null),
    sample(8, 'crew', 'Squadra posa Nord', 'engaged', site, { company: 'Edilnova S.r.l.', specialty: 'Montaggio', headcount: '4' }, [], null),
    sample(9, 'invoice', '12/2026', 'open', site, { party: 'Studio Ferri', direction: 'outgoing', due_date: plusDays(today, 30), vat: '22' },
      [{ description: 'Montaggio facciata nord', unit: 'm²', quantity: '180', unit_price: '9.50' }]),
    sample(10, 'order', 'ORD-008', 'confirmed', another, { supplier: 'Forniture Lombarde', expected_date: plusDays(today, 3), vat: '22' },
      [{ description: 'Giunto ortogonale', unit: 'pz', quantity: '24', unit_price: '7.40' }]),
    sample(11, 'ddt', 'DDT-021', 'in_transit', site, { direction: 'outgoing', sender: 'Impresa Bellini', recipient: 'Studio Ferri', destination: 'Via Manzoni 24, Milano', reason: 'Consegna materiale', packages: '2' },
      [{ description: 'Telaio ponteggio 105', unit: 'pz', quantity: '36' }]),
    sample(12, 'estimate', 'Ponteggio facciate', 'review', site, { revision: '1' }, [
      { description: 'Facciata nord', unit: 'm²', quantity: '1', length: '20', height: '9', unit_price: '9.50' },
      { description: 'Facciata sud', unit: 'm²', quantity: '1', length: '16', height: '9', unit_price: '9.50' },
    ]),
  ];
}

function isRecord(value: unknown): value is OperationRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<OperationRecord>;
  return typeof record.id === 'string' && operationKinds.includes(record.kind as OperationKind)
    && typeof record.title === 'string' && typeof record.status === 'string' && typeof record.updated_at === 'string'
    && (record.site_id === null || typeof record.site_id === 'string')
    && (record.record_date === null || typeof record.record_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.record_date))
    && typeof record.archived === 'boolean' && isTextObject(record.fields)
    && Array.isArray(record.lines) && record.lines.every(isTextObject);
}

function isTextObject(value: unknown) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(member => typeof member === 'string');
}

export function demoOperationsBacking(today: string) {
  try {
    const stored = localStorage.getItem(operationsKey);
    const data: unknown = stored ? JSON.parse(stored) : null;
    if (Array.isArray(data) && data.every(isRecord)) return data;
  } catch { /* Use examples when stored data are unavailable. */ }
  return operationSamples(today);
}

export function forArea(records: OperationRecord[], area: OperationArea) {
  const kinds: readonly OperationKind[] = areas[area].kinds;
  return records.filter(record => kinds.includes(record.kind));
}

export function localOperations(today: string, area: OperationArea) {
  const deleted = demoTombstoneIds('operation');
  return forArea(demoOperationsBacking(today), area).filter(record => !deleted.has(record.id));
}

export function demoSiteOptions(today: string, persisted = false): SiteOption[] {
  const store = persisted ? getDemo(today) : demoSeed(today);
  return store.sites.map(site => ({
    id: site.id, name: site.name, city: site.city, client_id: site.client_id,
    client: store.clients.find(client => client.id === site.client_id)?.name ?? '',
  }));
}

export function updateLocalOperation(today: string, action: OperationWrite) {
  const deleted = demoTombstoneIds('operation');
  if (deleted.has(action.id)) throw new Error('La scheda è nel cestino. Ripristinala prima di modificarla.');
  const records = demoOperationsBacking(today);
  const old = records.find(record => record.id === action.id);
  if ((old && old.kind !== action.kind) || (!old && action.action !== 'save'))
    throw new Error('Questa scheda non è più disponibile.');
  const updated_at = new Date().toISOString();
  let value: OperationRecord;
  if (action.action === 'save') {
    if (old?.archived) throw new Error('Ripristina la scheda prima di modificarla.');
    const { action: _, ...rest } = action;
    if (rest.site_id && !demoSiteOptions(today, true).some(site => site.id === rest.site_id))
      throw new Error('Il cantiere selezionato non è più disponibile.');
    value = { ...rest, archived: false, updated_at };
  } else {
    value = { ...old!, archived: action.action === 'archive', updated_at };
  }

  const next = [value, ...records.filter(record => record.id !== value.id)];
  const visible = next.filter(record => !deleted.has(record.id));
  if (value.kind === 'article' && value.archived && visible.some(record =>
    record.kind === 'movement' && !record.archived && record.fields.article_id === value.id))
    throw new Error('Archivia prima i movimenti di questo articolo.');
  if (value.kind === 'movement') {
    if (!value.archived && !visible.some(record => record.kind === 'article' && !record.archived && record.id === value.fields.article_id))
      throw new Error('L’articolo selezionato non è più disponibile.');
    if ([...getWarehouseAvailability(visible).values()].some(balance => balance < 0n))
      throw new Error('La modifica porterebbe la giacenza sotto zero.');
  }
  localStorage.setItem(operationsKey, JSON.stringify(next));
  return value;
}
