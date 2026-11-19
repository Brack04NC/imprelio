import { z } from 'zod';
import { normalizeUnit, type ImportedItem } from './estimate-import.ts';

export const priceKinds = ['standard', 'rental', 'extension'] as const;
type PriceKind = typeof priceKinds[number];
export const priceKindLabels: Record<PriceKind, string> = {
  standard: 'Senza mesi inclusi', rental: 'Noleggio incluso', extension: 'Mese aggiuntivo',
};

const identifier = z.uuid();
const text = (max: number) => z.string().trim().max(max);
export const amount = (decimals: number, positive = false) => z.string().trim().transform(value => value.replace(',', '.'))
  .refine(value => new RegExp(`^\\d{1,9}(?:\\.\\d{1,${decimals}})?$`).test(value) && (!positive || Number(value) > 0));

export const rateSchema = z.object({
  id: identifier, label: text(120).min(1), code: text(80), phrase: text(200), unit: text(40).min(1).transform(normalizeUnit),
  kind: z.enum(priceKinds), months: z.number().int().min(1).max(120).nullable(),
  price: amount(2),
}).refine(rule => Boolean(rule.code || normalizePhrase(rule.phrase)), { message: 'Inserisci un codice o una parola da cercare nella voce.' })
  .refine(rule => (rule.kind === 'rental') === (rule.months !== null), { message: 'Indica la durata per il prezzo con noleggio incluso.' });

export const quoteLineTextLimits = { title: 300, description: 4000 } as const;
export const quoteLineTextSchema = z.object({
  title: text(quoteLineTextLimits.title).min(1),
  description: text(quoteLineTextLimits.description),
});
export type QuoteLineText = z.infer<typeof quoteLineTextSchema>;

export const quoteLineSchema = quoteLineTextSchema.extend({
  reference: text(40), code: text(80), page: z.number().int().min(1).max(100),
  unit: text(40).min(1).transform(normalizeUnit), quantity: amount(3, true), price: amount(2),
  sourcePrice: z.union([z.literal(''), amount(3)]), sourceTotal: z.union([z.literal(''), amount(3)]),
  sourceTitle: quoteLineTextSchema.shape.title.optional(),
  sourceDescription: quoteLineTextSchema.shape.description.optional(),
});

export const quoteSchema = z.object({
  id: identifier, title: text(160).min(1), site_id: identifier, source_name: text(250).min(1),
  lines: z.array(quoteLineSchema).min(1).max(350),
});
export type EstimateRate = z.infer<typeof rateSchema>;
export type QuoteInput = z.infer<typeof quoteSchema>;
export type QuoteLine = z.infer<typeof quoteLineSchema>;
export type EstimateQuote = QuoteInput & { created_at: string };
export type QuoteSummary = Omit<EstimateQuote, 'lines'>;

type SourceText = Pick<QuoteLine, 'sourceTitle' | 'sourceDescription'>;

export function reviseQuoteLineText(item: QuoteLineText & SourceText, updated: QuoteLineText): QuoteLineText & SourceText {
  const originalTitle = item.sourceTitle ?? item.title;
  const originalDescription = item.sourceDescription ?? item.description;
  return {
    ...updated,
    sourceTitle: updated.title === originalTitle ? undefined : originalTitle,
    sourceDescription: updated.description === originalDescription ? undefined : originalDescription,
  };
}

export const pricingAction = z.union([
  z.object({ action: z.literal('save_rate'), rate: rateSchema }),
  z.object({ action: z.literal('remove_rate'), id: identifier }),
  z.object({ action: z.literal('save_quote'), quote: quoteSchema }),
]);

function normalizePhrase(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\bponteggi\b/g, 'ponteggio').trim();
}

function normalizeCode(value: string) {
  return value.toUpperCase().replace(/\s+/g, '').replace(/\.+$/, '');
}

type Billing = { kind: PriceKind | 'unknown'; months: number | null };
export function itemBilling(item: Pick<ImportedItem, 'title' | 'description' | 'unit'> & SourceText): Billing {
  const extra = /\b(?:mes[ei]\s+(?:successiv\w*|aggiuntiv\w*|ulterior\w*)|(?:successiv\w*|aggiuntiv\w*|ulterior\w*)\s+mes[ei])\b/;
  const title = normalizePhrase(item.sourceTitle ?? item.title);
  if (extra.test(title) || normalizeUnit(item.unit) === 'm²/mese') return { kind: 'extension', months: null };
  const description = normalizePhrase(item.sourceDescription ?? item.description);
  const mentionsRent = /\b(?:nol[eo]\w*|affitt\w*|canone)\b/.test(description);
  if (/\b(?:da|tra|fra) \d+ (?:a|e) \d+ mes[ei]\b|\b(?:piu|meno) di (?:un|\d+) mes[ei]\b/.test(description) ||
      /\b(?:senza|esclus\w+) (?:il )?(?:nol[eo]\w*|affitt\w*)\b|\b(?:nol[eo]\w*|affitt\w*) (?:\w+ ){0,3}(?:esclus\w+|a parte|non inclus\w+)\b/.test(description)) return { kind: 'unknown', months: null };
  const months = new Set<number>();
  for (const found of description.matchAll(/\b(\d{1,3})\s+mes[ei]\b/g)) months.add(Number(found[1]));
  if (/\b(?:primo mese|mese iniziale|un mese|una mensilita|1 mese)\b/.test(description)) months.add(1);
  if (extra.test(description)) return { kind: months.size ? 'unknown' : 'extension', months: null };
  if (months.size === 1 && mentionsRent) return { kind: 'rental', months: [...months][0] };
  if (months.size > 1 || /\b(?:mese|mesi|mensilita|mensile)\b/.test(description)) return { kind: 'unknown', months: null };
  if (/\bponteggio\b/.test(title) && /\b(?:nol\w+|affitto)\b/.test(description)) return { kind: 'unknown', months: null };
  return { kind: 'standard', months: null };
}

export function sourceAmountDisagrees(item: Pick<ImportedItem, 'quantity' | 'sourcePrice' | 'sourceTotal'>) {
  function thousandths(value: string) {
    const parsed = amount(3).safeParse(value);
    if (!parsed.success) return null;
    const [whole, fraction = ''] = parsed.data.split('.');
    return BigInt(whole + fraction.padEnd(3, '0'));
  }
  const quantity = thousandths(item.quantity);
  const price = thousandths(item.sourcePrice);
  const total = thousandths(item.sourceTotal);
  if (quantity === null || price === null || total === null) return false;
  return (quantity * price + 5000n) / 10000n !== (total + 5n) / 10n;
}

export function duplicateEstimateCodes(items: ImportedItem[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    const code = normalizeCode(item.code);
    if (!code) continue;
    if (seen.has(code)) duplicates.add(code);
    seen.add(code);
  }
  return duplicates;
}

export function matchEstimateRate(item: ImportedItem & SourceText, rules: EstimateRate[], duplicateCodes = new Set<string>()) {
  const unit = normalizeUnit(item.unit);
  const title = ' ' + normalizePhrase(item.sourceTitle ?? item.title) + ' ';
  const code = normalizeCode(item.code);
  const billing = itemBilling(item);
  if (!unit || billing.kind === 'unknown') return { rate: null, reason: !unit ? 'Unità da verificare' : 'Durata da verificare' };
  const matches = rules.flatMap(rate => {
    if (unit !== rate.unit || billing.kind !== rate.kind || billing.months !== rate.months) return [];
    const rateCode = normalizeCode(rate.code);
    const phrase = normalizePhrase(rate.phrase);
    if (rateCode && (rateCode !== code || duplicateCodes.has(code) && !phrase)) return [];
    if (phrase && !title.includes(' ' + phrase + ' ')) return [];
    if (!rateCode && !phrase) return [];
    return [{ rate, score: (rateCode ? 1000 : 0) + (phrase ? phrase.length : 0) }];
  }).sort((a, b) => b.score - a.score);
  if (!matches.length) return { rate: null, reason: code && duplicateCodes.has(code) ? 'Codice ripetuto. Verifica la voce.' : 'Voce senza corrispondenza' };
  if (matches[1]?.score === matches[0].score) return { rate: null, reason: 'Più prezzi compatibili. Scegli quello corretto.' };
  return { rate: matches[0].rate, reason: 'Prezzo da listino' };
}
