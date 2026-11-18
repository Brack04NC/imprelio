export type PdfText = { text: string; x: number; y: number; width: number };
export type PdfPage = { number: number; items: PdfText[] };
export type ImportedItem = {
  reference: string;
  code: string;
  title: string;
  description: string;
  page: number;
  unit: string;
  quantity: string;
  sourcePrice: string;
  sourceTotal: string;
};

const units: Record<string, string> = {
  mq: 'm²', m2: 'm²', 'm²': 'm²', metroquadro: 'm²', metriquadri: 'm²', metriquadrati: 'm²',
  mc: 'm³', m3: 'm³', 'm³': 'm³', metrocubo: 'm³', metricubi: 'm³',
  m: 'm', ml: 'm', mlin: 'm', metrilineari: 'm',
  n: 'pz', nr: 'pz', cad: 'pz', pz: 'pz', pezzi: 'pz', cadauno: 'pz',
  giorno: 'giorni', giorni: 'giorni', giornate: 'giorni', gg: 'giorni',
  h: 'ore', ora: 'ore', ore: 'ore', kg: 'kg', t: 't', q: 'q', l: 'l',
  mese: 'mesi', mesi: 'mesi', corpo: 'a corpo', acorpo: 'a corpo',
  'mq/mese': 'm²/mese', 'm2/mese': 'm²/mese', 'm²/mese': 'm²/mese',
  'mq/mesi': 'm²/mese', 'm2/mesi': 'm²/mese', 'm²/mesi': 'm²/mese',
};

export function normalizeUnit(raw: string) {
  const cleaned = raw.trim().toLowerCase().replace(/[.\s]+/g, '');
  return (Object.hasOwn(units, cleaned) ? units[cleaned] : raw.trim()).toLowerCase();
}

export function unitFromSubtotal(text: string) {
  const tail = /sommano[.\s:]+(.*)/iu.exec(text)?.[1] ?? '';
  const unit = /^(?:m(?:q|[23²³]|\s+[23²³])?\s*\/\s*mes[ei]|m\s+[23²³]|metri\s+(?:quadrati|quadri|cubi|lineari)|a\s+corpo|[\p{L}\d²³/]+)/iu.exec(tail)?.[0] ?? '';
  return normalizeUnit(unit);
}

function parsePdfNumber(raw: string, style: 'it' | 'en') {
  const text = raw.trim().replace(/^€\s*/, '');
  const integerWithGrouping = style === 'it' ? /^(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,3}))?$/ : /^(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,3}))?$/;
  const parts = integerWithGrouping.exec(text);
  if (!parts) return '';
  const whole = parts[2].replace(/[.,]/g, '').replace(/^0+(?=\d)/, '');
  const fraction = parts[3]?.replace(/0+$/, '');
  return parts[1] + whole + (fraction ? '.' + fraction : '');
}

type Row = { y: number; items: PdfText[] };
function textRows(items: PdfText[]) {
  const rows: Row[] = [];
  for (const item of items.filter(item => item.text.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const last = rows.at(-1);
    if (last && Math.abs(last.y - item.y) <= 3.5) last.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows;
}

function rowText(items: PdfText[]) {
  return items.map(item => item.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function formatOf(page: PdfPage) {
  const heading = (value: RegExp) => page.items.find(item => value.test(item.text.trim()));
  const quantity = heading(/^quantit[àa]$/i);
  const price = heading(/^unitario$/i);
  const total = heading(/^totale$/i);
  if (!quantity || !price || !total || quantity.x >= price.x || price.x >= total.x) return null;
  if (heading(/^d['’]ordine$/i) || heading(/^INDICAZIONE DEI LAVORI$/i)) return { style: 'it' as const, quantity, price, total };
  if (heading(/^nome$/i)) return { style: 'en' as const, quantity, price, total };
  return null;
}

function numberIn(items: PdfText[], min: number, max: number, style: 'it' | 'en') {
  const candidates = items.filter(item => item.x >= min && item.x < max)
    .map(item => parsePdfNumber(item.text, style)).filter(Boolean);
  return candidates.length === 1 ? candidates[0] : '';
}

type Draft = ImportedItem & { body: string[] };
function makeDraft(page: number, reference: string, code = '', title = ''): Draft {
  return { page, reference, code, title, description: '', unit: '', quantity: '', sourcePrice: '', sourceTotal: '', body: [] };
}

export function readEstimatePages(pages: PdfPage[]): ImportedItem[] {
  const entries: ImportedItem[] = [];
  let active: Draft | undefined;
  function flush() {
    if (!active) return;
    const { body, ...item } = active;
    item.description = body.join(' ').replace(/\s+/g, ' ').trim();
    item.title ||= item.description.slice(0, 140) || 'Voce ' + item.reference;
    item.description ||= item.title;
    if (!item.unit) item.unit = unitFromSubtotal(item.description);
    entries.push(item);
    active = undefined;
  }

  for (const page of pages) {
    const format = formatOf(page);
    if (!format) continue;
    const { style, quantity, price, total } = format;
    const quantityMin = quantity.x - 14;
    const priceMin = price.x - 6;
    const totalMin = total.x - (style === 'it' ? 22 : 12);
    const rows = textRows(page.items).filter(row => row.y > 55 && row.y < Math.min(price.y, quantity.y) - 3);

    for (const row of rows) {
      const subtotal = row.items.find(item => /^sommano\b/i.test(item.text.trim()));
      const leftItems = style === 'it'
        ? row.items.filter(item => item.x < quantity.x - 160)
        : row.items.filter(item => item.x < quantityMin);
      const left = rowText(leftItems);
      const full = rowText(row.items);
      if (style === 'it') {
        const newItem = /^nr\.?\s*(\d+)\s*(.*)$/i.exec(left);
        if (newItem) {
          flush();
          const rawCode = newItem[2].trim();
          active = /^[\w.\/-]{2,60}$/.test(rawCode)
            ? makeDraft(page.number, newItem[1], rawCode)
            : makeDraft(page.number, newItem[1], '', rawCode);
          if (active.title) active.body.push(active.title);
          continue;
        }
        if (!active) continue;
        if (subtotal || /^sommano\b/i.test(full)) {
          active.unit = unitFromSubtotal(subtotal?.text ?? full) || unitFromSubtotal(full);
          active.quantity = numberIn(row.items, quantityMin, priceMin, style);
          active.sourcePrice = numberIn(row.items, priceMin, totalMin, style);
          active.sourceTotal = numberIn(row.items, totalMin, Infinity, style);
          flush();
        } else if (left && !/^(?:a riportare|riporto|computo metrico estimativo|pagina \d+)$/i.test(left)) {
          active.body.push(left);
          active.title ||= left;
        }
      } else {
        const newItem = /^(\d{1,4})\s+([\p{L}].*)$/u.exec(left);
        if (newItem) {
          flush();
          active = makeDraft(page.number, newItem[1], '', newItem[2]);
        }
        if (!active) continue;
        if (/^totale (?:generale|parziale)/i.test(full)) { flush(); continue; }
        if (left) active.body.push(left);
        active.quantity ||= numberIn(row.items, quantityMin, priceMin, style);
        active.sourcePrice ||= numberIn(row.items, priceMin, price.x + 50, style);
        active.sourceTotal ||= numberIn(row.items, totalMin, Infinity, style);
      }
    }
    if (style === 'en') flush();
  }
  flush();
  return entries;
}

export function estimateImportWarnings(pages: PdfPage[], items: ImportedItem[]) {
  const firstTable = pages.findIndex(page => formatOf(page) !== null);
  if (firstTable < 0) return [];
  const unrecognized = pages.slice(firstTable).filter(page => !formatOf(page)).map(page => page.number);
  const warnings = unrecognized.length ? ['Pagine senza tabella riconosciuta: ' + unrecognized.join(', ') + '.'] : [];
  const references = items.map(item => Number(item.reference));
  if (references.every((value, index) => Number.isSafeInteger(value) && (index === 0 || value > references[index - 1])) &&
      references.some((value, index) => index > 0 && value > references[index - 1] + 1)) {
    warnings.push('La numerazione delle voci ha delle interruzioni. Confrontala con il PDF.');
  }
  return warnings;
}
