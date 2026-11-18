import type { Definition, Field, OperationRecord } from './operation-types.ts';

type DocumentKind = 'invoice' | 'order' | 'ddt' | 'estimate';
type Values = Record<string, string>;

const quantityScale = 1000n;
const moneyScale = 100n;
const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const integer = new Intl.NumberFormat('it-IT');

function parseDecimal(value: string | undefined, places: number): bigint | null {
  const parts = /^(\d{1,12})(?:[.,](\d+))?$/.exec(value?.trim() ?? '');
  if (!parts || (parts[2]?.length ?? 0) > places) return null;
  return BigInt(parts[1] + (parts[2] ?? '').padEnd(places, '0'));
}

function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export function documentLineQuantity(kind: DocumentKind, line: Values): bigint | null {
  const quantity = parseDecimal(line.quantity, 3);
  if (quantity === null || quantity === 0n) return null;
  if (kind !== 'estimate') return quantity;

  let product = quantity;
  for (const key of ['length', 'width', 'height']) {
    const dimension = line[key]?.trim();
    const factor = dimension ? parseDecimal(dimension, 3) : quantityScale;
    if (factor === null || factor === 0n) return null;
    product *= factor;
  }

  return roundedDivide(product, quantityScale ** 3n);
}

export function documentLineTotal(kind: Exclude<DocumentKind, 'ddt'>, line: Values): bigint | null {
  const quantity = documentLineQuantity(kind, line);
  const rate = parseDecimal(line.unit_price, 2);
  return quantity === null || rate === null ? null : roundedDivide(quantity * rate, quantityScale);
}

export function documentTotals(kind: Exclude<DocumentKind, 'ddt'>, fields: Values, lines: Values[]) {
  let net = 0n;
  for (const line of lines) {
    const amount = documentLineTotal(kind, line);
    if (amount === null) return null;
    net += amount;
  }

  const rate = kind === 'estimate' ? 0n : parseDecimal(fields.vat, 2);
  if (rate === null || rate > 100n * moneyScale) return null;
  const vat = roundedDivide(net * rate, moneyScale * 100n);
  return { net, vat, total: net + vat };
}

export function formatEuro(cents: bigint) {
  const amount = cents < 0n ? -cents : cents;
  const fraction = String(amount % moneyScale).padStart(2, '0');
  const whole = cents < 0n && amount < moneyScale ? -0 : cents / moneyScale;
  return euro.formatToParts(whole).map(part => part.type === 'fraction' ? fraction : part.value).join('');
}

export function formatQuantity(thousandths: bigint) {
  const amount = thousandths < 0n ? -thousandths : thousandths;
  const fraction = String(amount % quantityScale).padStart(3, '0').replace(/0+$/, '');
  const sign = thousandths < 0n ? '−' : '';
  return sign + integer.format(amount / quantityScale) + (fraction ? ',' + fraction : '');
}

function amounts(kind: Exclude<DocumentKind, 'ddt'>, fields: Values, lines: Values[]) {
  const totals = documentTotals(kind, fields, lines);
  const money = (value: bigint | undefined) => value === undefined ? '—' : formatEuro(value);
  return kind === 'estimate'
    ? [{ label: 'Totale lavori', value: money(totals?.total) }]
    : [
        { label: 'Imponibile', value: money(totals?.net) },
        { label: 'IVA', value: money(totals?.vat) },
        { label: 'Totale', value: money(totals?.total) },
      ];
}

function summaryAmount(record: OperationRecord, kind: Exclude<DocumentKind, 'ddt'>) {
  const totals = documentTotals(kind, record.fields, record.lines);
  return totals ? formatEuro(totals.total) : '';
}

const vatField: Field = { key: 'vat', label: 'Aliquota IVA (%)', type: 'number', initial: '22', decimals: 2, min: 0, max: 100, required: true };
const notes: Field = { key: 'notes', label: 'Note', type: 'textarea' };
const rowFields: Field[] = [
  { key: 'description', label: 'Descrizione', required: true },
  { key: 'unit', label: 'Unità di misura', placeholder: 'pz, m², ore', required: true, initial: 'pz' },
  { key: 'quantity', label: 'Quantità', type: 'number', decimals: 3, min: 0.001, required: true, initial: '1' },
];
const unitPrice: Field = { key: 'unit_price', label: 'Prezzo unitario (€)', type: 'number', decimals: 2, min: 0, required: true };
const pricedRows = [...rowFields, unitPrice];
const dimensionFields: Field[] = [
  { key: 'length', label: 'Lunghezza', type: 'number', decimals: 3, min: 0.001 },
  { key: 'width', label: 'Larghezza', type: 'number', decimals: 3, min: 0.001 },
  { key: 'height', label: 'Altezza / peso unitario', type: 'number', decimals: 3, min: 0.001 },
];

const direction = {
  incoming: 'In entrata', outgoing: 'In uscita',
};

export const documentDefinitions = [
  {
    kind: 'invoice', plural: 'Fatture', singular: 'Fattura', titleLabel: 'Numero fattura',
    description: 'Registra fatture emesse e ricevute, scadenze e pagamenti.',
    site: 'optional', dateLabel: 'Data fattura', dateRequired: true,
    defaultStatus: 'draft', statuses: [
      { value: 'draft', label: 'Bozza' }, { value: 'open', label: 'Da saldare' }, { value: 'paid', label: 'Saldata' },
    ],
    fields: [
      { key: 'direction', label: 'Tipo fattura', type: 'select', required: true, initial: 'outgoing', options: [
        { value: 'outgoing', label: 'Emessa' }, { value: 'incoming', label: 'Ricevuta' },
      ] },
      { key: 'party', label: 'Cliente o fornitore', required: true },
      { key: 'due_date', label: 'Scadenza pagamento', type: 'date' },
      { key: 'paid_date', label: 'Data pagamento', type: 'date' },
      vatField, notes,
    ],
    lineFields: pricedRows, minLines: 1,
    summary: record => [record.fields.direction === 'incoming' ? 'Ricevuta' : 'Emessa', record.fields.party, summaryAmount(record, 'invoice')],
    totals: (fields, lines) => amounts('invoice', fields, lines),
  },
  {
    kind: 'order', plural: 'Ordini', singular: 'Ordine', titleLabel: 'Numero ordine',
    description: 'Gestisci gli ordini ai fornitori e le date di consegna previste.',
    site: 'optional', dateLabel: 'Data ordine', dateRequired: true,
    defaultStatus: 'draft', statuses: [
      { value: 'draft', label: 'Bozza' }, { value: 'sent', label: 'Inviato' },
      { value: 'confirmed', label: 'Confermato' }, { value: 'delivered', label: 'Consegnato' }, { value: 'cancelled', label: 'Annullato' },
    ],
    fields: [
      { key: 'supplier', label: 'Fornitore', required: true },
      { key: 'expected_date', label: 'Consegna prevista', type: 'date' },
      { key: 'destination', label: 'Luogo di consegna' },
      vatField, notes,
    ],
    lineFields: pricedRows, minLines: 1,
    summary: record => [record.fields.supplier, summaryAmount(record, 'order')],
    totals: (fields, lines) => amounts('order', fields, lines),
  },
  {
    kind: 'ddt', plural: 'DDT', singular: 'DDT', titleLabel: 'Numero DDT',
    description: 'Registra i documenti di trasporto e la merce in entrata o in uscita.',
    site: 'optional', dateLabel: 'Data documento', dateRequired: true,
    defaultStatus: 'draft', statuses: [
      { value: 'draft', label: 'Bozza' }, { value: 'in_transit', label: 'In transito' },
      { value: 'delivered', label: 'Consegnato' }, { value: 'cancelled', label: 'Annullato' },
    ],
    fields: [
      { key: 'direction', label: 'Direzione', type: 'select', required: true, initial: 'outgoing', options: [
        { value: 'outgoing', label: direction.outgoing }, { value: 'incoming', label: direction.incoming },
      ] },
      { key: 'sender', label: 'Mittente', required: true },
      { key: 'recipient', label: 'Destinatario', required: true },
      { key: 'destination', label: 'Luogo di consegna', required: true },
      { key: 'reason', label: 'Causale del trasporto', placeholder: 'Vendita, noleggio, reso o trasferimento', required: true },
      { key: 'carrier', label: 'Trasportatore' },
      { key: 'packages', label: 'Numero colli', type: 'number', decimals: 0, min: 0 }, notes,
    ],
    lineFields: rowFields, minLines: 1,
    summary: record => [record.fields.direction === 'incoming' ? direction.incoming : direction.outgoing, `${record.fields.sender} → ${record.fields.recipient}`],
  },
  {
    kind: 'estimate', plural: 'Computi metrici', singular: 'Computo metrico', titleLabel: 'Titolo computo',
    description: 'Misura le singole lavorazioni e calcola gli importi a partire dai prezzi unitari.',
    site: 'required', dateLabel: 'Data computo', dateRequired: true,
    defaultStatus: 'draft', statuses: [
      { value: 'draft', label: 'Bozza' }, { value: 'review', label: 'In revisione' }, { value: 'approved', label: 'Approvato' },
    ],
    fields: [{ key: 'revision', label: 'Revisione', placeholder: 'Es. 01' }, notes],
    lineFields: [
      { key: 'code', label: 'Codice voce' }, ...rowFields.slice(0, 2),
      { ...rowFields[2], label: 'Quantità / parti uguali' }, ...dimensionFields, unitPrice,
    ],
    minLines: 1,
    summary: record => [record.fields.revision ? `Rev. ${record.fields.revision}` : '', summaryAmount(record, 'estimate')],
    totals: (fields, lines) => amounts('estimate', fields, lines),
  },
] satisfies Definition[];
