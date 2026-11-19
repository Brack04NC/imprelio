import 'server-only';

import type { database } from './backend';
import type { FinanceAction, FinanceData, FinancialAccount, FinancialEntry } from './finance';

type Database = Awaited<ReturnType<typeof database>>;
const pageSize = 500;

async function readAccounts(db: Database, organization: string) {
  const accounts: FinancialAccount[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('financial_accounts').select('id,name,opening_date,opening_cents,updated_at')
      .eq('organization_id', organization).order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    accounts.push(...data.map(account => ({ ...account, opening_cents: String(account.opening_cents) })));
    if (data.length < pageSize) return accounts;
  }
}

async function readEntries(db: Database, organization: string) {
  const entries: FinancialEntry[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from('financial_entries')
      .select('id,account_id,site_id,record_date,description,direction,amount_cents,reference,voided,updated_at')
      .eq('organization_id', organization).order('id').range(offset, offset + pageSize - 1);
    if (error) throw error;
    entries.push(...data.map(entry => ({ ...entry, direction: entry.direction as FinancialEntry['direction'], amount_cents: String(entry.amount_cents) })));
    if (data.length < pageSize) return entries;
  }
}

export async function readFinance(db: Database, organization: string): Promise<FinanceData> {
  const [accounts, entries] = await Promise.all([readAccounts(db, organization), readEntries(db, organization)]);
  return { accounts, entries };
}

export function isFinanceMigrationMissing(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || code === '42883';
}

export async function writeFinance(db: Database, organization: string, action: FinanceAction) {
  const { data, error } = await db.rpc('imprelio_finance_write', { org: organization, payload: action });
  if (error) throw error;
  return data as FinancialAccount | FinancialEntry;
}
