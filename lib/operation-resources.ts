import type { Definition, Field, OperationRecord, Option } from './operation-types.ts';

const THOUSAND = 1000n;
const stockLimit = 999_999_999.999;
const wholeQuantity = new Intl.NumberFormat('it-IT');

export function parseStockQuantity(input: string): bigint | null {
  const match = /^(\d{1,9})(?:[.,](\d{1,3}))?$/.exec(input.trim());
  if (!match) return null;
  const [, whole, fraction = ''] = match;
  return BigInt(whole) * THOUSAND + BigInt(fraction.padEnd(3, '0'));
}

export function formatStockQuantity(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  const fraction = (magnitude % THOUSAND).toString().padStart(3, '0').replace(/0+$/, '');
  const sign = value < 0n ? '−' : '';
  return sign + wholeQuantity.format(magnitude / THOUSAND) + (fraction ? ',' + fraction : '');
}

export function getWarehouseAvailability(records: readonly OperationRecord[]): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  for (const record of records) {
    if (record.kind !== 'movement' || record.archived) continue;
    const { article_id, direction, quantity } = record.fields;
    if (!article_id || !quantity || (direction !== 'in' && direction !== 'out')) continue;
    const amount = parseStockQuantity(quantity);
    if (amount === null) continue;
    const delta = direction === 'in' ? amount : -amount;
    balances.set(article_id, (balances.get(article_id) ?? 0n) + delta);
  }
  return balances;
}

export function isBelowMinimum(article: OperationRecord, available: bigint): boolean {
  const minimum = parseStockQuantity(article.fields.stock_min || '0') ?? 0n;
  return !article.archived && available < minimum;
}

const materialCategories: Option[] = [
  { value: 'materials', label: 'Materiali' },
  { value: 'equipment', label: 'Attrezzature' },
  { value: 'vehicles', label: 'Veicoli' },
  { value: 'consumables', label: 'Consumabili' },
  { value: 'protective', label: 'Dispositivi di protezione' },
  { value: 'other', label: 'Altro' },
];

const stockUnits: Option[] = [
  { value: 'pz', label: 'pz · Pezzi' },
  { value: 'm', label: 'm · Metri' },
  { value: 'm²', label: 'm² · Metri quadrati' },
  { value: 'm³', label: 'm³ · Metri cubi' },
  { value: 'kg', label: 'kg · Chilogrammi' },
  { value: 'l', label: 'l · Litri' },
  { value: 'conf', label: 'conf · Confezioni' },
];

const directionOptions: Option[] = [
  { value: 'in', label: 'Carico' },
  { value: 'out', label: 'Scarico' },
];

const peopleStatuses: Option[] = [
  { value: 'active', label: 'In servizio' },
  { value: 'on_leave', label: 'Assente' },
  { value: 'inactive', label: 'Non in servizio' },
];

const contactFields: Field[] = [
  { key: 'phone', label: 'Telefono di lavoro', type: 'tel', placeholder: '+39' },
  { key: 'email', label: 'Email di lavoro', type: 'email' },
  { key: 'notes', label: 'Note', type: 'textarea' },
];

export const resourceDefinitions: Definition[] = [
  {
    kind: 'article', plural: 'Articoli', singular: 'Articolo',
    description: 'Organizza materiali e attrezzature e controlla le scorte aggiornate dai movimenti.',
    titleLabel: 'Nome articolo', site: 'none',
    statuses: [{ value: 'active', label: 'Attivo' }, { value: 'inactive', label: 'Fuori uso' }],
    defaultStatus: 'active',
    fields: [
      { key: 'code', label: 'Codice articolo', placeholder: 'Es. PNT-100' },
      { key: 'category', label: 'Categoria', type: 'select', options: materialCategories, initial: 'materials', required: true },
      { key: 'unit', label: 'Unità di misura', type: 'select', options: stockUnits, initial: 'pz', required: true },
      { key: 'stock_min', label: 'Scorta minima', type: 'number', decimals: 3, min: 0, max: stockLimit, initial: '0' },
      { key: 'location', label: 'Posizione in magazzino', placeholder: 'Es. Scaffale B2' },
      { key: 'notes', label: 'Note', type: 'textarea' },
    ],
    summary: (record, _records, stock) => {
      const available = stock.get(record.id) ?? 0n;
      const { code, unit, location } = record.fields;
      const balance = formatStockQuantity(available) + (unit ? ` ${unit}` : '');
      return [code, location, `${balance} disponibili`].filter(Boolean);
    },
  },
  {
    kind: 'movement', plural: 'Movimenti', singular: 'Movimento',
    description: 'Registra carichi e scarichi di magazzino e collega le movimentazioni al cantiere.',
    titleLabel: 'Descrizione movimento', dateLabel: 'Data movimento', dateRequired: true, site: 'optional',
    statuses: [{ value: 'recorded', label: 'Registrato' }], defaultStatus: 'recorded',
    fields: [
      { key: 'article_id', label: 'Articolo', type: 'article', required: true },
      { key: 'direction', label: 'Tipo movimento', type: 'select', options: directionOptions, initial: 'in', required: true },
      { key: 'quantity', label: 'Quantità', type: 'number', decimals: 3, min: 0.001, max: stockLimit, required: true },
      { key: 'notes', label: 'Note', type: 'textarea' },
    ],
    summary: (record, records) => {
      const { article_id, direction, quantity } = record.fields;
      const article = records.find(item => item.id === article_id && item.kind === 'article');
      const amount = parseStockQuantity(quantity || '0');
      const movement = directionOptions.find(option => option.value === direction)?.label;
      const measure = amount === null ? quantity : formatStockQuantity(amount);
      const detail = [movement, [measure, article?.fields.unit].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
      return [article?.title || 'Articolo', detail].filter(Boolean);
    },
  },
  {
    kind: 'employee', plural: 'Dipendenti', singular: 'Dipendente',
    description: 'Gestisci l’anagrafica del personale interno, le mansioni e i recapiti di lavoro.',
    titleLabel: 'Nome e cognome', dateLabel: 'In forza dal', site: 'optional',
    statuses: peopleStatuses, defaultStatus: 'active',
    fields: [
      { key: 'code', label: 'Matricola' },
      { key: 'role', label: 'Mansione', placeholder: 'Es. Responsabile tecnico' },
      ...contactFields,
    ],
    summary: ({ fields }) => [fields.role, fields.code, fields.phone || fields.email].filter(Boolean),
  },
  {
    kind: 'worker', plural: 'Operai', singular: 'Operaio',
    description: 'Organizza le maestranze, registra le qualifiche e indica il cantiere di assegnazione.',
    titleLabel: 'Nome e cognome', dateLabel: 'In forza dal', site: 'optional',
    statuses: peopleStatuses, defaultStatus: 'active',
    fields: [
      { key: 'code', label: 'Matricola' },
      { key: 'qualification', label: 'Qualifica', placeholder: 'Es. Montatore di ponteggi' },
      ...contactFields,
    ],
    summary: ({ fields }) => [fields.qualification, fields.code, fields.phone || fields.email].filter(Boolean),
  },
  {
    kind: 'crew', plural: 'Squadre esterne', singular: 'Squadra esterna',
    description: 'Tieni a portata di mano le imprese partner, i referenti e le assegnazioni ai cantieri.',
    titleLabel: 'Nome squadra', dateLabel: 'Collaborazione dal', site: 'optional',
    statuses: [
      { value: 'available', label: 'Disponibile' },
      { value: 'engaged', label: 'Impegnata' },
      { value: 'unavailable', label: 'Non disponibile' },
    ],
    defaultStatus: 'available',
    fields: [
      { key: 'company', label: 'Impresa esterna', placeholder: 'Ragione sociale', required: true },
      { key: 'specialty', label: 'Specialità', placeholder: 'Es. Montaggio ponteggi' },
      { key: 'contact', label: 'Referente' },
      { key: 'headcount', label: 'Numero di operatori', type: 'number', decimals: 0, min: 1, max: 999 },
      ...contactFields,
    ],
    summary: ({ fields }) => [fields.company, fields.specialty, fields.contact, fields.headcount ? `${fields.headcount} ${fields.headcount === '1' ? 'operatore' : 'operatori'}` : ''].filter(Boolean),
  },
];
