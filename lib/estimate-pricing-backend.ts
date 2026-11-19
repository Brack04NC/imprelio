import 'server-only';

import type { database } from './backend';
import type { EstimateRate, QuoteSummary } from './estimate-pricing';

type Database = Awaited<ReturnType<typeof database>>;
const size = 500;

export async function readRates(db: Database, org: string) {
  const rates: EstimateRate[] = [];
  for (let offset = 0; ; offset += size) {
    const { data, error } = await db.from('estimate_rates').select('id,label,code,phrase,unit,kind,months,price')
      .eq('organization_id', org).order('id').range(offset, offset + size - 1);
    if (error) throw error;
    rates.push(...data as EstimateRate[]);
    if (data.length < size) return rates;
  }
}

async function readQuotes(db: Database, org: string, site?: string) {
  const quotes: QuoteSummary[] = [];
  for (let offset = 0; ; offset += size) {
    let query = db.from('estimate_quotes').select('id,site_id,title,source_name,created_at').eq('organization_id', org);
    if (site) query = query.eq('site_id', site);
    const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(offset, offset + size - 1);
    if (error) throw error;
    quotes.push(...data as QuoteSummary[]);
    if (data.length < size) return quotes;
  }
}

export async function readPricing(db: Database, org: string, site?: string) {
  const [rates, quotes] = await Promise.all([readRates(db, org), readQuotes(db, org, site)]);
  return { rates, quotes };
}
