import { z } from 'zod';
import { quoteSchema, rateSchema } from './estimate-pricing.ts';

export const estimatePricingKey = 'imprelio-estimate-pricing-v1';
const savedPrices = z.object({ rates: z.array(rateSchema), quotes: z.array(quoteSchema.extend({ created_at: z.iso.datetime() })) });

export function localPrices(): z.infer<typeof savedPrices> {
  try {
    const result = savedPrices.safeParse(JSON.parse(localStorage.getItem(estimatePricingKey) ?? 'null'));
    if (result.success) return result.data;
  } catch { /* An unavailable browser store starts empty. */ }
  return { rates: [], quotes: [] };
}
