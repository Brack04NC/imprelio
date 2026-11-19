export type EstimateSite = { name: string; city: string; address: string; clientName: string };

type SiteField = keyof EstimateSite;

const labels: { field: SiteField; pattern: RegExp }[] = [
  { field: 'name', pattern: /^(?:oggetto(?:\s+dei lavori)?|(?:nome|titolo|denominazione)\s+(?:del\s+)?cantiere|cantiere|intervento)\s*(?::\s*(.*))?$/iu },
  { field: 'city', pattern: /^(?:(?:comune|citt[àa])(?:\s+(?:del cantiere|dei lavori))?\s*:\s*(.*)|comune\s+di\s+(.*)|(?:comune|citt[àa]))$/iu },
  { field: 'address', pattern: /^(?:(?:indirizzo|ubicazione)\s+(?:del cantiere|dei lavori|dell['’]intervento|dell['’]immobile)|luogo\s+(?:dei lavori|di esecuzione(?: dei lavori)?)|ubicazione)\s*(?::\s*(.*))?$/iu },
  { field: 'clientName', pattern: /^(?:committente|committenza|cliente)\s*(?::\s*(.*))?$/iu },
];

const tableStart = /^(?:indicazione dei lavori\b|numero\s+indicazione dei lavori\b|d['’]ordine\b|n[.°r]{1,2}\s*\d+\b|nome\s+quantit[àa]\b|\d{1,4}\s+(?:allestimento|demolizione|fornitura|smontaggio|scavo)\b)/iu;
const nextSection = /^(?:(?:data(?: del preventivo)?|provincia|regione|preventivi?|indirizzo|codice fiscale|partita iva|telefono|studio tecnico|progettista|destinatario|mittente|sede legale)\s*:|(?:il tecnico|direttore dei lavori)\b|(?:p\.?\s*iva|c\.?\s*f\.?)\s*:?\s*\d)/iu;
const streetName = 'via|viale|vicolo|piazza|piazzale|corso|largo|strada|contrada|localit[àa]';
const streetPrefix = new RegExp(`\\b(?:${streetName})\\s+`, 'giu');
const civicStreet = /^([\p{L}\p{N}][\p{L}\p{N} .'’\-]{0,74}?(?:\s*,\s*|\s+)(?:n\.?\s*)?\d{1,5}(?:\s*\/\s*[\p{L}\d]{1,5}|[a-z])?)(?=$|[,;).]|\s+(?:\(|comune\b|nel\b|in\b|provincia\b|\d{5}\b))/iu;

function clean(text: string) {
  return text.normalize('NFC').replace(/[^\S\n]+/g, ' ').trim();
}

function municipality(text: string) {
  const name = text.replace(/^comune\s+di\s+/iu, '').split(/\s*(?:\(|[,;]|\s[-–—]\s|\bprovincia\s+di\b)/iu)[0].trim();
  return /^[\p{L}][\p{L} .’'\-]{1,69}$/u.test(name) ? name : '';
}

function cityInContext(text: string) {
  const explicit = /(?:^|\b(?:nel|in)\s+)comune\s+di\s+([^,;()]+?)(?=$|\s*[(,;]|\s[-–—]\s)/iu.exec(text)?.[1];
  if (explicit) return municipality(explicit);
  const postal = /(?:^|[,;]\s*|\s)\d{5}\s+([\p{L} .’'\-]+)\s*\([A-Z]{2}\)\s*$/u.exec(text)?.[1];
  return postal ? municipality(postal) : '';
}

function streetInSubject(text: string) {
  const matches = [...text.matchAll(streetPrefix)];
  if (matches.length !== 1) return '';
  const [prefix] = matches[0];
  const street = civicStreet.exec(text.slice(matches[0].index + prefix.length))?.[1];
  return street && /\p{L}/u.test(street) ? prefix + street : '';
}

export function extractEstimateSite(text: string): EstimateSite {
  const fields: Record<SiteField, string[]> = { name: [], city: [], address: [], clientName: [] };
  let active: SiteField | undefined;

  // The cover and table headings are the only sources of metadata. Work rows often
  // contain delivery addresses and customer names that do not identify the site.
  const lines = text.slice(0, 12_000).replace(/\f/g, '\n\n').split(/\r\n?|\n/).slice(0, 100);
  for (const rawLine of lines) {
    const line = clean(rawLine);
    if (tableStart.test(line) || (/\bquantit[àa]\b/iu.test(line) && /\bunitario\b/iu.test(line) && /\btotale\b/iu.test(line))) break;
    if (!line) {
      if (active && fields[active].length) active = undefined;
      continue;
    }

    const label = labels.find(({ pattern }) => pattern.test(line));
    if (label) {
      const match = label.pattern.exec(line);
      active = fields[label.field].length ? undefined : label.field;
      const value = match?.slice(1).find(Boolean)?.trim();
      if (active && value) fields[active].push(value);
      continue;
    }

    if (nextSection.test(line) || /^[\p{L}][\p{L}\p{N} .’'\-]{0,60}:\s*/u.test(line)) {
      active = undefined;
      continue;
    }
    if (active && fields[active].length < 4) fields[active].push(line);
  }

  const name = fields.name.join(' ');
  const statedAddress = fields.address.join(' ');
  const clientName = fields.clientName.join(' ');
  return {
    name: name.slice(0, 120).trim(),
    city: municipality(fields.city.join(' ')) || cityInContext(statedAddress) || cityInContext(name),
    address: (statedAddress || streetInSubject(name)).slice(0, 200).trim(),
    clientName: clientName.slice(0, 140).trim(),
  };
}
