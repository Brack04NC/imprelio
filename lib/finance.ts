import { z } from 'zod';
import { getDemo } from './demo.ts';
import { plusDays } from './domain.ts';

const maxCents = 999_999_999_999n;
const date = z.iso.date().refine(value => value >= '0001-01-01');
const timestamp = z.iso.datetime({ offset: true });
const openingCents = z.string().regex(/^-?\d{1,12}$/);
const positiveCents = z.string().regex(/^[1-9]\d{0,11}$/);
const accountSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(120), opening_date: date, opening_cents: openingCents,
});
const entrySchema = z.object({
  id: z.uuid(), account_id: z.uuid(), site_id: z.uuid().nullable(), record_date: date,
  description: z.string().trim().min(1).max(250), direction: z.enum(['in', 'out']),
  amount_cents: positiveCents, reference: z.string().trim().max(100),
});
const actionSchema = z.discriminatedUnion('action', [
  accountSchema.extend({ action: z.literal('save_account') }).strict(),
  entrySchema.extend({ action: z.literal('save_entry') }).strict(),
  z.strictObject({ action: z.literal('void_entry'), id: z.uuid() }),
]);
const dataSchema = z.object({
  accounts: z.array(accountSchema.extend({ updated_at: timestamp })),
  entries: z.array(entrySchema.extend({ voided: z.boolean(), updated_at: timestamp })),
});

export type FinanceData = z.infer<typeof dataSchema>;
export type FinancialAccount = FinanceData['accounts'][number];
export type FinancialEntry = FinanceData['entries'][number];
export type FinanceAction = z.infer<typeof actionSchema>;

export function validateFinanceAction(raw: unknown): FinanceAction {
  const result = actionSchema.safeParse(raw);
  if (!result.success) throw new Error('Controlla nome, date e importi inseriti.');
  return result.data;
}

export function euroToCents(value: string, signed = false) {
  const match = /^(-?)(\d{1,10})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match || !signed && match[1]) return null;
  const [, sign, euros, fraction = ''] = match;
  const cents = BigInt(euros + fraction.padEnd(2, '0'));
  if (cents > maxCents || !signed && cents === 0n) return null;
  return (sign ? -cents : cents).toString();
}

export function centsToEuroInput(value: string | bigint) {
  const cents = BigInt(value);
  const magnitude = cents < 0n ? -cents : cents;
  return (cents < 0n ? '-' : '') + magnitude / 100n + ',' + String(magnitude % 100n).padStart(2, '0');
}

export function buildStatement(account: FinancialAccount, entries: FinancialEntry[], from: string, to: string) {
  const start = from < account.opening_date ? account.opening_date : from;
  const rows: { entry: FinancialEntry; balance: bigint }[] = [];
  if (start > to) return { from: start, opening: 0n, income: 0n, expenses: 0n, closing: 0n, rows };

  let opening = BigInt(account.opening_cents), income = 0n, expenses = 0n;
  const ordered = entries.filter(entry => entry.account_id === account.id && !entry.voided
      && entry.record_date >= account.opening_date && entry.record_date <= to)
    .sort((a, b) => a.record_date.localeCompare(b.record_date) || a.id.localeCompare(b.id));
  for (const entry of ordered) {
    const amount = BigInt(entry.amount_cents);
    if (entry.record_date < start) {
      opening += entry.direction === 'in' ? amount : -amount;
      continue;
    }
    if (entry.direction === 'in') income += amount;
    else expenses += amount;
    rows.push({ entry, balance: opening + income - expenses });
  }
  return { from: start, opening, income, expenses, closing: opening + income - expenses, rows };
}

export const financeStorageKey = 'imprelio-finance-v1';
const sampleId = (index: number) => '01719eb6-a3ba-43fa-9c2d-' + String(index).padStart(12, '0');

export function financeSamples(today: string): FinanceData {
  const opening_date = today.slice(0, 4) + '-01-01';
  const updated_at = today + 'T09:00:00Z';
  const account_id = sampleId(1);
  return {
    accounts: [{ id: account_id, name: 'Conto operativo demo', opening_date, opening_cents: '300000', updated_at }],
    entries: [
      { id: sampleId(2), account_id, site_id: null, record_date: [opening_date, plusDays(today, -5)].sort()[1],
        description: 'Acconto lavori', direction: 'in', amount_cents: '125000', reference: 'Bonifico demo', voided: false, updated_at },
      { id: sampleId(3), account_id, site_id: null, record_date: today,
        description: 'Pagamento fornitore', direction: 'out', amount_cents: '45000', reference: '', voided: false, updated_at },
    ],
  };
}

export function localFinance(today: string): FinanceData {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(financeStorageKey) ?? 'null');
    const parsed = dataSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  } catch { /* When storage is unavailable, use the demo dataset. */ }
  return financeSamples(today);
}

export function writeLocalFinance(today: string, payload: FinanceAction) {
  const data = localFinance(today);
  const action = validateFinanceAction(payload);
  const updated_at = new Date().toISOString();
  if (action.action === 'save_account') {
    const { action: _, ...fields } = action;
    if (data.accounts.some(account => account.id !== fields.id && account.name.toLocaleLowerCase('it') === fields.name.toLocaleLowerCase('it'))) {
      throw new Error('Esiste già un conto con questo nome.');
    }
    if (data.entries.some(entry => entry.account_id === fields.id && !entry.voided && entry.record_date < fields.opening_date)) {
      throw new Error('La data del saldo iniziale è successiva a un movimento registrato.');
    }
    data.accounts = [{ ...fields, updated_at }, ...data.accounts.filter(account => account.id !== fields.id)];
  } else if (action.action === 'save_entry') {
    const { action: _, ...fields } = action;
    const account = data.accounts.find(item => item.id === fields.account_id);
    if (!account || data.entries.some(item => item.id === fields.id && item.voided)) throw new Error('Conto o movimento non disponibile.');
    if (fields.record_date < account.opening_date) throw new Error('La data del movimento precede il saldo iniziale del conto.');
    if (fields.site_id && !getDemo(today).sites.some(site => site.id === fields.site_id)) throw new Error('Cantiere non disponibile.');
    data.entries = [{ ...fields, updated_at, voided: false }, ...data.entries.filter(entry => entry.id !== fields.id)];
  } else {
    if (!data.entries.some(entry => entry.id === action.id)) throw new Error('Movimento non disponibile.');
    data.entries = data.entries.map(entry => entry.id === action.id && !entry.voided ? { ...entry, voided: true, updated_at } : entry);
  }
  localStorage.setItem(financeStorageKey, JSON.stringify(data));
  return data;
}
