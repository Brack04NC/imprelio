import { z } from 'zod';

export const documentKinds = ['invoice', 'quote', 'estimate', 'other'] as const;
export const documentKindSchema = z.enum(documentKinds);
export type DocumentKind = z.infer<typeof documentKindSchema>;
export const documentKindLabels: Record<DocumentKind, string> = {
  invoice: 'Fattura', quote: 'Preventivo', estimate: 'Computo metrico', other: 'Altro documento',
};

export const documentMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const documentMimeSchema = z.enum(documentMimeTypes);
export type DocumentMime = z.infer<typeof documentMimeSchema>;
export const documentMaxBytes = 25 * 1024 * 1024;

const extensions: Record<string, DocumentMime | undefined> = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};

export function documentMimeForName(name: string): DocumentMime | undefined {
  const extension = /\.[a-z]+$/i.exec(name.trim())?.[0].toLowerCase();
  return extension ? extensions[extension] : undefined;
}

export function documentFileName(name: string) {
  const base = name.normalize('NFC').split(/[/\\]/).pop()?.replace(/[\x00-\x1f\x7f]/g, '').trim() ?? '';
  const extension = /\.[a-z]+$/i.exec(base)?.[0] ?? '';
  const stem = (extension ? base.slice(0, -extension.length) : base).trim() || 'Documento';
  return stem.slice(0, 250 - extension.length) + extension;
}

export const documentFieldLimits = { title: 250, number: 100, issuer: 250, recipient: 250, text: 24_000 } as const;
const text = (size: number) => z.string().trim().max(size).refine(value => !value.includes('\0'));

export const documentFieldsSchema = z.strictObject({
  title: text(documentFieldLimits.title),
  number: text(documentFieldLimits.number),
  date: z.union([z.literal(''), z.iso.date().refine(value => value >= '0001-01-01')]),
  issuer: text(documentFieldLimits.issuer),
  recipient: text(documentFieldLimits.recipient),
  total: z.string().trim().transform(value => value.replace(',', '.')).refine(value => value === '' || /^-?\d{1,12}(?:\.\d{1,2})?$/.test(value)),
  currency: z.string().trim().toUpperCase().regex(/^(?:[A-Z]{3})?$/),
  text: text(documentFieldLimits.text),
});
export type DocumentFields = z.infer<typeof documentFieldsSchema>;

export function blankDocumentFields(): DocumentFields {
  return { title: '', number: '', date: '', issuer: '', recipient: '', total: '', currency: '', text: '' };
}

export const documentExtractionSchema = z.strictObject({
  kind: documentKindSchema,
  status: z.enum(['extracted', 'review', 'unreadable']),
  fields: documentFieldsSchema,
});
export type DocumentExtraction = z.infer<typeof documentExtractionSchema>;

export const documentEntrySchema = z.strictObject({
  id: z.uuid(),
  kind: documentKindSchema,
  file_name: z.string().min(1).max(250),
  mime_type: documentMimeSchema,
  size_bytes: z.number().int().min(1).max(documentMaxBytes),
  site_id: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  source: z.enum(['intake', 'estimate-pdf']),
  extraction: documentExtractionSchema,
});
export type DocumentEntry = z.infer<typeof documentEntrySchema>;

export function documentIntakeHref(kind?: DocumentKind, site?: string) {
  const query = new URLSearchParams({ importa: '1' });
  if (kind) query.set('tipo', kind);
  if (site) query.set('cantiere', site);
  return `/gestione/archivio-documenti?${query}`;
}
