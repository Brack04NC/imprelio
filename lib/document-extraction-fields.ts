import { documentFieldLimits, type DocumentExtraction, type DocumentKind } from './document-intake.ts';

const headers = {
  invoice: /\b(?:fattura(?:\s+elettronica|\s+commerciale|\s+proforma)?|invoice)\b/iu,
  quote: /\b(?:preventiv[oi]|offerta\s+(?:economica|commerciale)|quotation|estimate\s+quote)\b/iu,
  estimate: /\b(?:computo\s+metrico(?:\s+estimativo)?|CME|bill\s+of\s+quantities)\b/iu,
} as const;

const kindEntries = Object.entries(headers) as [Exclude<DocumentKind, 'other'>, RegExp][];
const datePattern = /(?<!\d)(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{1,2}\s+[a-z]+\s+\d{4})(?!\d)/iu;
const months = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const numberPattern = /^[\p{L}\d][\p{L}\d./_-]{0,99}/u;
const amountPattern = /(?<![\p{L}\d])[-+]?(?:\d{1,3}(?:[ .,'’]\d{3})+|\d+)(?:[.,]\d{1,2})?(?![\p{L}\d.,])/gu;
const currencyPattern = /€|\b(?:EUR|CHF|USD|GBP|CAD|AUD|JPY)\b|US\$|£/giu;

function truncate(value: string, max: number) {
  return value.slice(0, max).replace(/[\ud800-\udbff]$/, '').trimEnd();
}

function normalizedText(raw: string) {
  return raw.replace(/\r\n?/g, '\n').replace(/\f/g, '\n\n')
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .split('\n').map(line => line.replace(/\s+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function transcript(text: string) {
  if (text.length <= documentFieldLimits.text) return text;
  const separator = '\n\n[… testo intermedio omesso …]\n\n';
  const first = truncate(text, Math.floor(documentFieldLimits.text / 2));
  const last = text.slice(-(documentFieldLimits.text - first.length - separator.length)).replace(/^[\udc00-\udfff]/, '');
  return first + separator + last;
}

function single(values: string[]) {
  const unique = [...new Set(values.map(value => value.trim()).filter(Boolean))];
  return unique.length === 1 ? unique[0] : '';
}

function labeled(lines: string[], pattern: RegExp) {
  return lines.flatMap((line, index) => {
    const match = pattern.exec(line);
    if (!match) return [];
    const value = match[1]?.trim();
    if (value) return [value];
    return line.endsWith(':') && lines[index + 1] ? [lines[index + 1]] : [];
  });
}

function normalizedDate(value: string) {
  const match = datePattern.exec(value.trim());
  const candidate = match?.index === 0 ? match[0] : '';
  if (!candidate) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(candidate);
  const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(candidate);
  const written = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i.exec(candidate);
  const year = Number(iso?.[1] ?? local?.[3] ?? written?.[3]);
  const month = iso || local ? Number(iso?.[2] ?? local?.[2]) : months.indexOf(written?.[2].toLowerCase() ?? '') + 1;
  const day = Number(iso?.[3] ?? local?.[1] ?? written?.[1]);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCDate() === day && date.getUTCMonth() === month - 1 ? date.toISOString().slice(0, 10) : '';
}

function normalizedAmount(raw: string) {
  const value = raw.replace(/[ '’]/g, '').replace(/^\+/, '');
  const separator = Math.max(value.lastIndexOf('.'), value.lastIndexOf(','));
  const trailing = separator < 0 ? '' : value.slice(separator + 1);
  const decimals = trailing.length > 0 && trailing.length <= 2;
  const whole = (decimals ? value.slice(0, separator) : value).replace(/[.,]/g, '').replace(/^(-?)0+(?=\d)/, '$1');
  return /^-?\d{1,12}$/.test(whole) ? `${whole}.${decimals ? trailing.padEnd(2, '0') : '00'}` : '';
}

function currencies(value: string) {
  return Array.from(value.matchAll(currencyPattern), ([raw]) => raw === '€' ? 'EUR' : raw === '£' ? 'GBP' : raw.toUpperCase() === 'US$' ? 'USD' : raw.toUpperCase());
}

function documentType(lines: string[], fileName: string) {
  const candidates = lines.slice(0, 24).filter(line => !/\b(?:riferimento|rif\.|riferita|riferito|relativa|relativo|vedi|allegat[oa]|scadenza)\b/i.test(line));
  for (const line of [...candidates, fileName.replace(/[_-]/g, ' ')]) {
    const matches = kindEntries.flatMap(([kind, pattern]) => {
      const match = pattern.exec(line);
      return match ? [{ kind, start: match.index }] : [];
    }).sort((first, second) => first.start - second.start);
    if (matches.length) return matches[0].kind;
  }
  return 'other';
}

export function parseDocumentText(raw: string, fileName: string): DocumentExtraction {
  const completeText = normalizedText(raw);
  const text = transcript(completeText);
  const lines = text.split('\n').filter(Boolean);
  const kind = documentType(lines, fileName);
  const kindLine = kind === 'other' ? [] : lines.slice(0, 24).filter(line => headers[kind].test(line));
  const title = truncate(labeled(lines.slice(0, 30), /^(?:oggetto|titolo|subject)\s*:\s*(.*)$/iu)[0]
    || kindLine[0] || (kind === 'other' ? lines.find(line => /\p{L}/u.test(line)) : '') || '', documentFieldLimits.title);
  const explicitNumber = labeled(lines, /^(?:numero\s+(?:(?:della?\s+)?(?:fattura|preventivo|documento)|computo)|(?:fattura(?:\s+elettronica|\s+commerciale|\s+proforma)?|preventiv[oi]|invoice|quotation)\s+(?:n(?:umero|o)?[.°º]?|#)|numero\s*:)\s*[:.\-]?\s*(.*)$/iu);
  const inlineNumber = kindLine.flatMap(line => {
    const value = /\b(?:fattura(?:\s+elettronica|\s+commerciale|\s+proforma)?|preventiv[oi]|invoice|quotation|computo(?:\s+metrico(?:\s+estimativo)?)?)\s+(?:n(?:umero|o)?[.°º]?|#)\s*[:.\-]?\s*(.*)$/iu.exec(line)?.[1];
    return value ? [value] : [];
  });
  const number = single([...explicitNumber, ...inlineNumber].map(value => {
    const candidate = numberPattern.exec(value)?.[0].replace(/[.]+$/, '') ?? '';
    return /\d/.test(candidate) && !datePattern.test(candidate) ? candidate : '';
  }));
  const dueDate = /^(?:data\s*(?:(?:del(?:la)?\s+)?(?:documento|fattura|emissione|preventivo|computo)|emessa\s+il)?|invoice\s+date|issue\s+date)(?:\s*[:.\-]\s*|\s+)(.*)$/iu;
  const explicitDate = labeled(lines, dueDate).map(normalizedDate);
  const inlineDate = kindLine.flatMap(line => {
    const value = /\b(?:del|data|dated|issued(?:\s+on)?)\s*[:.\-]?\s+([^\n]+)$/iu.exec(line)?.[1];
    return value ? [normalizedDate(value)] : [];
  });
  const date = single([...explicitDate, ...inlineDate]);

  const issuer = truncate(single(labeled(lines.slice(0, 42), /^(?:fornitore|emittente|mittente|cedente(?:\s*\/\s*prestatore)?|prestatore|supplier|from)\s*:\s*(.*)$/iu)), documentFieldLimits.issuer);
  const recipient = truncate(single(labeled(lines.slice(0, 42), /^(?:(?:cliente|destinatario|committente|intestatario|cessionario(?:\s*\/\s*committente)?|customer|bill\s+to)\s*:\s*|spett(?:\.?le|abile)[.\s]+)(.*)$/iu)), documentFieldLimits.recipient);
  const labeledTotals = labeled(lines, /^(?:totale\s+(?:documento|fattura|complessivo|generale|preventivo|computo)|importo\s+totale|grand\s+total|total\s+(?:amount|invoice))(?=\s|:|€|\d|$)\s*[:.]?\s*(.*)$/iu);
  const monetaryLines = labeledTotals.length > 0 ? labeledTotals
    : labeled(lines.slice(-22), /^(?:totale|total)\s*(?:[:=]|(?=[€£$\d-]))\s*(.*)$/iu);
  const total = single(monetaryLines.flatMap(line => {
    const amounts = Array.from(line.matchAll(amountPattern), ([value]) => normalizedAmount(value));
    return [single(amounts)];
  }));
  const currency = single(monetaryLines.flatMap(currencies)) || single(currencies(text));
  const fields = { title, number, date, issuer, recipient, total, currency, text };
  const identified = kind === 'invoice' ? number && date && total : (kind === 'quote' || kind === 'estimate') && title && total;
  const status = !/\p{L}|\d/u.test(completeText) ? 'unreadable'
    : identified && text === completeText ? 'extracted' : 'review';
  return { kind, fields, status };
}
