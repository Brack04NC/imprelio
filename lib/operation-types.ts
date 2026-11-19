export const operationKinds = ['article', 'movement', 'employee', 'worker', 'crew', 'invoice', 'order', 'ddt', 'estimate'] as const;
export type OperationKind = typeof operationKinds[number];
export type Values = Record<string, string>;
export type Option = { value: string; label: string };
export type Field = {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'date' | 'email' | 'tel' | 'number' | 'select' | 'article';
  required?: boolean;
  initial?: string;
  decimals?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  options?: Option[];
  when?: { key: string; value: string };
};
export type OperationRecord = {
  id: string;
  kind: OperationKind;
  site_id: string | null;
  title: string;
  status: string;
  record_date: string | null;
  fields: Values;
  lines: Values[];
  archived: boolean;
  updated_at: string;
};
export type Definition = {
  kind: OperationKind;
  plural: string;
  singular: string;
  description: string;
  titleLabel: string;
  dateLabel?: string;
  dateRequired?: boolean;
  site: 'none' | 'optional' | 'required';
  statuses: Option[];
  defaultStatus: string;
  fields: Field[];
  lineFields?: Field[];
  minLines?: number;
  summary?: (record: OperationRecord, records: OperationRecord[], stock: ReadonlyMap<string, bigint>) => string[];
  totals?: (fields: Values, lines: Values[]) => { label: string; value: string }[];
};
export type OperationWrite =
  | { action: 'save' } & Omit<OperationRecord, 'archived' | 'updated_at'>
  | { action: 'archive' | 'restore'; id: string; kind: OperationKind };
export type SiteOption = { id: string; name: string; city: string; client: string };

export const areas = {
  magazzino: { title: 'Magazzino', kinds: ['article', 'movement'], description: 'Materiali, attrezzature, veicoli e movimenti di carico e scarico.' },
  personale: { title: 'Personale e squadre', kinds: ['employee', 'worker', 'crew'], description: 'Dipendenti, operai e squadre interne ed esterne assegnati ai lavori.' },
  amministrazione: { title: 'Documenti', kinds: ['invoice', 'order', 'ddt'], description: 'Fatture, ordini e documenti di trasporto collegati ai cantieri.' },
  'computi-metrici': { title: 'Computi metrici', kinds: ['estimate'], description: 'Misure, quantità, prezzi unitari e importi per cantiere.' },
} satisfies Record<string, { title: string; kinds: OperationKind[]; description: string }>;

export type OperationArea = keyof typeof areas;
