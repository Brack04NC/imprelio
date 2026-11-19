'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Check, ClipboardList, FileUp, HardHat, Pencil, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { Drawer, type SitePrefill } from './editor';
import { SiteFromEstimate } from './site-from-estimate';
import { orgLink } from './shell';
import type { Identity } from '@/lib/domain';
import { demoKey } from '@/lib/demo';
import type { SiteOption } from '@/lib/operation-types';
import { demoSiteOptions } from '@/lib/operations-demo';
import { documentLineTotal, formatEuro } from '@/lib/operation-documents';
import { amount, duplicateEstimateCodes, itemBilling, matchEstimateRate, priceKindLabels, priceKinds, pricingAction, quoteLineSchema, quoteLineTextLimits,
  quoteLineTextSchema, quoteSchema, rateSchema, reviseQuoteLineText, sourceAmountDisagrees,
  type EstimateQuote, type EstimateRate, type QuoteInput, type QuoteLine, type QuoteLineText, type QuoteSummary } from '@/lib/estimate-pricing';
import type { ImportedItem } from '@/lib/estimate-import';
import styles from './estimate-pricing.module.css';

const localKey = 'imprelio-estimate-pricing-v1';
const storedSchema = z.object({ rates: z.array(rateSchema), quotes: z.array(quoteSchema.extend({ created_at: z.iso.datetime() })) });
type Store = z.infer<typeof storedSchema>;
type PricingAction = z.infer<typeof pricingAction>;
type DraftItem = ImportedItem & Pick<QuoteLine, 'sourceTitle' | 'sourceDescription'> & {
  selected: boolean; manualPrice: string | null; saved?: boolean; sourceChecked?: boolean;
};
type Draft = { id: string; title: string; site: string; siteDetails?: SitePrefill; createdSite?: string; importIssue?: string;
  fileName: string; items: DraftItem[]; warnings: string[]; warningsReviewed: boolean };
type ReviewRow = { item: DraftItem; price: string; index: number; reason: string; line: QuoteLine | null; total: bigint | null; sourceMismatch: boolean };
const rowsPerPage = 12;

function localPrices(): Store {
  try {
    const result = storedSchema.safeParse(JSON.parse(localStorage.getItem(localKey) ?? 'null'));
    if (result.success) return result.data;
  } catch { /* An unavailable browser store starts empty. */ }
  return { rates: [], quotes: [] };
}

function quoteTotal(line: QuoteLine) {
  return documentLineTotal('estimate', { quantity: line.quantity, unit_price: line.price });
}

function euroOrDash(value: string) {
  if (!value) return '—';
  const rate = documentLineTotal('estimate', { quantity: '1', unit_price: value });
  return rate === null ? value + ' €' : formatEuro(rate);
}

function makeDraft(items: ImportedItem[], fileName: string, site: string, warnings: string[] = [], siteDetails?: SitePrefill): Draft {
  const title = fileName.replace(/\.pdf$/i, '').slice(0, 160);
  return { id: crypto.randomUUID(), title, fileName, site, warnings, warningsReviewed: false,
    siteDetails: siteDetails && { ...siteDetails, name: siteDetails.name || title },
    items: items.map(item => ({ ...item, manualPrice: null, selected: true })) };
}

const newRate = (): EstimateRate => ({ id: crypto.randomUUID(), label: '', code: '', phrase: '', unit: 'm²', kind: 'standard', months: null, price: '' });

const demonstration: ImportedItem = {
  reference: '1', code: 'PON-PRIMO-MESE', page: 1, title: 'Allestimento ponteggio',
  description: 'Montaggio ponteggio con un mese di noleggio incluso.', unit: 'm²', quantity: '1900', sourcePrice: '19', sourceTotal: '36100',
};

export function EstimatePricing({ identity, initial, sites, today, requestedSite }: {
  identity: Identity; initial: { rates: EstimateRate[]; quotes: QuoteSummary[] }; sites: SiteOption[];
  today: string; requestedSite?: string;
}) {
  const [rates, setRates] = useState(initial.rates);
  const [quotes, setQuotes] = useState(initial.quotes);
  const [savedPage, setSavedPage] = useState(1);
  const [availableSites, setAvailableSites] = useState(sites);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftFilter, setDraftFilter] = useState<'all' | 'review'>('all');
  const [page, setPage] = useState(1);
  const [rateEditor, setRateEditor] = useState<EstimateRate | null>(null);
  const [siteEditor, setSiteEditor] = useState(false);
  const [textEditor, setTextEditor] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const focusBack = useRef<HTMLElement | null>(null);
  const stableSite = availableSites.find(site => site.id === requestedSite)?.id ?? '';
  const draftSite = availableSites.find(site => site.id === draft?.site);
  const listino = useMemo(() => [...rates].sort((a, b) => a.label.localeCompare(b.label, 'it')), [rates]);
  const editingItem = textEditor === null ? undefined : draft?.items[textEditor];

  useEffect(() => {
    if (!identity.demo) return;
    function sync() {
      const stored = localPrices();
      const options = demoSiteOptions(today, true);
      setAvailableSites(options);
      setRates(stored.rates);
      const scoped = options.some(site => site.id === requestedSite) ? requestedSite : undefined;
      setQuotes(stored.quotes.filter(quote => !scoped || quote.site_id === scoped));
    }
    sync();
    const onStorage = (event: StorageEvent) => { if (event.key === localKey || event.key === demoKey || event.key === null) sync(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [identity.demo, requestedSite, today]);

  const review = useMemo(() => {
    const items = draft?.items ?? [];
    const duplicates = duplicateEstimateCodes(items);
    return items.map<ReviewRow>((item, index) => {
      const match = matchEstimateRate(item, rates, duplicates);
      const price = item.manualPrice ?? match.rate?.price ?? '';
      const result = quoteLineSchema.safeParse({
        ...item, price, title: item.title.slice(0, quoteLineTextLimits.title), description: item.description.slice(0, quoteLineTextLimits.description),
        sourceTitle: item.sourceTitle?.slice(0, quoteLineTextLimits.title),
        sourceDescription: item.sourceDescription?.slice(0, quoteLineTextLimits.description),
        sourcePrice: amount(3).safeParse(item.sourcePrice).success ? item.sourcePrice : '',
        sourceTotal: amount(3).safeParse(item.sourceTotal).success ? item.sourceTotal : '',
      });
      const sourceMismatch = !item.sourceChecked && sourceAmountDisagrees(item);
      const reason = sourceMismatch ? 'Quantità e importo del PDF da verificare'
        : !item.unit.trim() ? 'Unità da verificare'
        : !amount(3, true).safeParse(item.quantity).success ? 'Quantità da verificare'
        : item.manualPrice !== null && !result.success ? 'Prezzo da verificare'
        : item.saved ? 'Prezzo salvato' : item.manualPrice !== null ? 'Prezzo manuale' : match.reason;
      const line = result.success && !sourceMismatch ? result.data : null;
      return { item, index, price, reason, sourceMismatch, line, total: line ? quoteTotal(line) : null };
    });
  }, [draft, rates]);

  const included = review.filter(row => row.item.selected);
  const pending = included.filter(row => !row.line);
  const lines = included.flatMap(row => row.line ?? []);
  const total = included.reduce((sum, row) => sum + (row.total ?? 0n), 0n);
  const filtered = draftFilter === 'all' ? review : pending;
  const pages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const currentPage = Math.min(page, pages);
  const ready = Boolean(draftSite && draft?.title.trim() && lines.length && !pending.length
    && (!draft.warnings.length || draft.warningsReviewed));

  function setItem(index: number, patch: Partial<DraftItem>) {
    setDraft(current => current && { ...current, items: current.items.map((item, i) => i === index ? { ...item, ...patch } : item) });
  }

  async function remote(query: URLSearchParams, action?: PricingAction) {
    query.set('azienda', identity.org.id);
    const response = await fetch('/api/prezzi-computo?' + query, {
      cache: 'no-store',
      ...(action ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Operazione non riuscita.');
    return result;
  }

  async function transact<T>(work: () => Promise<T>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { return await work(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Operazione non riuscita.'); }
    finally { lock.current = false; setBusy(false); }
  }

  async function loadPdf(file: File) {
    await transact(async () => {
      setProgress('Apertura del PDF…');
      try {
        const { extractEstimate } = await import('@/lib/estimate-pdf');
        const { items, warnings, siteDetails, importIssue } = await extractEstimate(file, (current, total) => setProgress(`Lettura pagina ${current} di ${total}…`));
        const fileName = file.name.slice(0, 250);
        const site = draft?.fileName === fileName ? draft.site || stableSite : stableSite;
        setDraft({ ...makeDraft(items, fileName, site, warnings, siteDetails), importIssue });
        setDraftFilter('all'); setPage(1);
      } finally { setProgress(''); }
    });
  }

  function openRate(rate: EstimateRate, trigger: HTMLElement) {
    focusBack.current = trigger;
    setRateEditor(rate);
  }
  function closeRate() {
    setRateEditor(null);
    requestAnimationFrame(() => focusBack.current?.isConnected && focusBack.current.focus());
  }

  function closeText() {
    setTextEditor(null);
    requestAnimationFrame(() => focusBack.current?.isConnected && focusBack.current.focus());
  }

  function closeSite() {
    setSiteEditor(false);
    requestAnimationFrame(() => {
      if (focusBack.current?.isConnected) focusBack.current.focus();
      else document.getElementById('estimate-site')?.focus();
    });
  }

  function siteCreated(site: SiteOption) {
    setAvailableSites(previous => [site, ...previous.filter(item => item.id !== site.id)]);
    setDraft(current => current && { ...current, site: site.id, createdSite: site.id });
    setNotice(draft?.importIssue ? 'Cantiere creato dai dati del computo.' : 'Cantiere creato e selezionato per il preventivo.');
    closeSite();
  }

  async function saveRate(rate: EstimateRate) {
    if (identity.demo) {
      const state = localPrices();
      localStorage.setItem(localKey, JSON.stringify({ ...state, rates: [rate, ...state.rates.filter(item => item.id !== rate.id)] }));
    } else await remote(new URLSearchParams(), { action: 'save_rate', rate });
    setRates(current => [rate, ...current.filter(item => item.id !== rate.id)]);
    setNotice('Prezzo salvato nel listino.');
    closeRate();
  }

  async function removeRate(rate: EstimateRate) {
    if (identity.demo) {
      const state = localPrices();
      localStorage.setItem(localKey, JSON.stringify({ ...state, rates: state.rates.filter(item => item.id !== rate.id) }));
    } else await remote(new URLSearchParams(), { action: 'remove_rate', id: rate.id });
    setRates(current => current.filter(item => item.id !== rate.id));
    setNotice('Prezzo rimosso dal listino.');
    closeRate();
  }

  async function saveQuote() {
    if (!draft || !ready) return;
    await transact(async () => {
      const quote: QuoteInput = { id: draft.id, site_id: draft.site, title: draft.title.trim(), source_name: draft.fileName, lines };
      let summary: QuoteSummary;
      if (identity.demo) {
        const stored = localPrices();
        const created_at = stored.quotes.find(item => item.id === quote.id)?.created_at ?? new Date().toISOString();
        const value = { ...quote, created_at };
        localStorage.setItem(localKey, JSON.stringify({ ...stored, quotes: [value, ...stored.quotes.filter(item => item.id !== quote.id)] }));
        summary = { id: value.id, site_id: value.site_id, title: value.title, source_name: value.source_name, created_at };
      } else summary = await remote(new URLSearchParams(), { action: 'save_quote', quote });
      setQuotes(current => [summary, ...current.filter(item => item.id !== quote.id)]);
      setSavedPage(1);
      setNotice('Preventivo salvato.');
    });
  }

  async function openQuote(id: string) {
    await transact(async () => {
      const quote: EstimateQuote | undefined = identity.demo ? localPrices().quotes.find(item => item.id === id)
        : await remote(new URLSearchParams({ id }));
      if (!quote) throw new Error('Preventivo non disponibile.');
      setDraft({ id: quote.id, site: quote.site_id, title: quote.title, fileName: quote.source_name,
        warnings: [], warningsReviewed: true,
        items: quote.lines.map(line => ({ ...line, manualPrice: line.price, selected: true, saved: true, sourceChecked: true })) });
      setDraftFilter('all'); setPage(1);
    });
  }

  function ruleFor(item: DraftItem) {
    const scope = itemBilling(item);
    const kind = scope.kind === 'unknown' ? 'standard' : scope.kind;
    return { ...newRate(), label: item.title.slice(0, 120), code: item.code.slice(0, 80), phrase: (item.sourceTitle ?? item.title).slice(0, 200),
      unit: item.unit, kind, months: kind === 'rental' ? scope.months : null };
  }

  return <>
    <div className={styles.screen}>
      <Link className="button text-button back-link" href={orgLink('/gestione/computi-metrici' + (stableSite ? '?cantiere=' + stableSite : ''), identity)}>
        <ArrowLeft size={16}/> Computi metrici
      </Link>
      <header className="page-header"><div><h1>Preventivi da computo</h1>
        <p>Importa il PDF, applica il tuo listino e verifica le voci prima di salvare.</p></div>
        <label className={`button primary ${styles.upload}`}><FileUp size={18}/> Importa PDF
          <input aria-label="Importa PDF" type="file" accept=".pdf,application/pdf" disabled={busy} onChange={event => {
            const file = event.target.files?.[0];
            if (file) void loadPdf(file);
            event.target.value = '';
          }}/></label>
      </header>
      {progress && <p role="status" className={styles.notice}>{progress}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <details className={`panel ${styles.details}`}>
        <summary><ClipboardList size={18}/> Listino aziendale <span>{rates.length} prezzi</span></summary>
        <div className={styles.panelContent}>
          <p>I prezzi si applicano quando coincidono voce, unità e durata del noleggio.</p>
          <button className="button secondary" onClick={event => openRate(newRate(), event.currentTarget)}><Plus size={17}/> Aggiungi prezzo</button>
          {listino.length > 0 && <ul className={styles.entries}>{listino.map(rate =>
            <li key={rate.id}><div><strong>{rate.label}</strong><small>{[rate.code, rate.phrase, priceKindLabels[rate.kind], rate.months ? rate.months + (rate.months === 1 ? ' mese' : ' mesi') : ''].filter(Boolean).join(' · ')}</small></div>
              <b>{euroOrDash(rate.price)} / {rate.unit}</b>
              <button className="button text-button" aria-label={'Modifica prezzo ' + rate.label} onClick={event => openRate(rate, event.currentTarget)}><Pencil size={15}/><span>Modifica</span></button></li>)}</ul>}
        </div>
      </details>
      {quotes.length > 0 && <details className={`panel ${styles.details}`}><summary><Save size={18}/> Preventivi salvati <span>{quotes.length}</span></summary>
        <ul className={styles.entries}>{quotes.slice((savedPage - 1) * rowsPerPage, savedPage * rowsPerPage).map(quote => <li key={quote.id}><div><strong>{quote.title}</strong>
          <small>{availableSites.find(site => site.id === quote.site_id)?.name ?? quote.source_name}</small></div>
          <button className="button secondary" disabled={busy} aria-label={'Apri preventivo ' + quote.title} onClick={() => void openQuote(quote.id)}>Apri</button></li>)}</ul>
        {quotes.length > rowsPerPage && <div className={styles.historyPages}>
          <button className="button secondary" disabled={savedPage === 1} onClick={() => setSavedPage(savedPage - 1)}>Precedenti</button>
          <button className="button secondary" disabled={savedPage * rowsPerPage >= quotes.length} onClick={() => setSavedPage(savedPage + 1)}>Successivi</button>
        </div>}
      </details>}
      {!draft ? <section className={`empty panel ${styles.empty}`}>
        <FileUp size={30}/><strong>Carica il computo del cantiere</strong>
        <p>Usa un PDF con testo selezionabile. Il documento viene letto nel browser.</p>
        {identity.demo && <button className="button secondary" onClick={() => {
          setDraft(makeDraft([demonstration], 'Esempio ponteggio.pdf', stableSite || availableSites[0]?.id || ''));
          setPage(1); setDraftFilter('all'); setError('');
        }}>Prova l’esempio da 1.900 m²</button>}
      </section> : <section className={`panel ${styles.work}`} aria-labelledby="draft-heading">
        <div className={styles.workHead}><div><h2 id="draft-heading">{draft.importIssue ? 'Dati del cantiere' : 'Revisione del preventivo'}</h2>
          <p>{draft.fileName}{!draft.importIssue && ` · ${review.length} ${review.length === 1 ? 'voce importata' : 'voci importate'}`}</p></div>
          {!draft.importIssue && <div className={styles.grandTotal}><span>{pending.length ? 'Totale parziale' : 'Totale lavori'}</span><strong>{formatEuro(total)}</strong><small>IVA esclusa</small></div>}
        </div>
        {draft.importIssue && <p className={styles.warning}>{draft.importIssue} Puoi creare il cantiere dai dati della testata.</p>}
        {draft.warnings.length > 0 && <div className={styles.warning}>
          {draft.warnings.map(warning => <p key={warning}>{warning}</p>)}
          <label><input type="checkbox" checked={draft.warningsReviewed} onChange={event => setDraft({ ...draft, warningsReviewed: event.target.checked })}/>
            Ho verificato che le voci importate coprono il preventivo.</label>
        </div>}
        {!draft.importIssue && <div className={`form-grid ${styles.draftFields}`}>
          <label>Titolo preventivo<input maxLength={160} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label>
          <label>Cantiere<select id="estimate-site" aria-label="Cantiere" value={draft.site} onChange={event => setDraft({ ...draft, site: event.target.value })}>
            <option value="">Seleziona il cantiere</option>{availableSites.map(site => <option key={site.id} value={site.id}>{site.name} · {site.client || site.city}</option>)}
          </select></label>
        </div>}
        {draft.siteDetails && <div className={styles.siteActions}>
          {draft.createdSite ? <Link className="button text-button" href={orgLink('/cantieri/' + draft.createdSite, identity)}>
            Apri il cantiere creato <ArrowUpRight size={16}/>
          </Link> : <button type="button" className="button secondary" disabled={busy} onClick={event => {
            focusBack.current = event.currentTarget;
            setNotice('');
            setSiteEditor(true);
          }}><HardHat size={17}/> Crea cantiere dal computo</button>}
        </div>}
        {!draft.importIssue && <><div className={styles.toolbar}>
          <button className="button secondary" aria-pressed={draftFilter === 'all'} onClick={() => { setDraftFilter('all'); setPage(1); }}>Tutte ({review.length})</button>
          <button className="button secondary" aria-pressed={draftFilter === 'review'} onClick={() => { setDraftFilter('review'); setPage(1); }}>Da verificare ({pending.length})</button>
          {pending.length > 0 && lines.length > 0 && <button type="button" className="button text-button" onClick={() => {
            const excluded = new Set(pending.map(row => row.index));
            setDraft(current => current && { ...current, items: current.items.map((item, index) => excluded.has(index) ? { ...item, selected: false } : item) });
          }}>Escludi voci da verificare</button>}
          <span>{included.length} incluse</span>
        </div>
        <div className={styles.review}>
          {filtered.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage).map(row => {
            const { item, index } = row;
            const scope = itemBilling(item);
            const term = scope.kind === 'rental' ? (scope.months === 1 ? '1 mese incluso' : scope.months + ' mesi inclusi')
              : scope.kind === 'extension' ? 'Mese aggiuntivo' : scope.kind === 'unknown' ? 'Durata da verificare' : '';
            return <article key={index} className={styles.row} data-included={item.selected}>
              <div className={styles.rowIntro}><label className={styles.include}><input type="checkbox" checked={item.selected}
                aria-label={'Includi voce ' + item.reference} onChange={event => setItem(index, { selected: event.target.checked })}/></label>
                <div><small>Voce {item.reference} · Pag. {item.page}{item.code && ' · ' + item.code}</small>
                  <h3>{item.title}</h3>{term && <span className={styles.term}>{term}</span>}
                  {item.description && item.description !== item.title && <details className={styles.original}><summary>Descrizione della voce</summary><p>{item.description}</p></details>}
                </div></div>
              <div className={styles.rowFields}>
                <label>Quantità<input aria-label={'Quantità voce ' + item.reference} inputMode="decimal" maxLength={14} value={item.quantity}
                  onChange={event => setItem(index, { quantity: event.target.value, sourceChecked: false })}/></label>
                <label>Unità<input aria-label={'Unità voce ' + item.reference} maxLength={40} value={item.unit}
                  onChange={event => setItem(index, { unit: event.target.value })}/></label>
                <label>Prezzo tuo (€)<input aria-label={'Prezzo voce ' + item.reference} inputMode="decimal" maxLength={12} value={row.price}
                  placeholder="Da inserire" onChange={event => setItem(index, { manualPrice: event.target.value, saved: false })}/></label>
                <div className={styles.rowAmount}><small>Importo</small><strong>{row.total === null ? '—' : formatEuro(row.total)}</strong></div>
              </div>
              <div className={styles.rowFoot}>
                <span className={item.selected && !row.line ? styles.unmatched : styles.matched}>{item.selected ? row.reason : 'Esclusa'}</span>
                {item.sourcePrice && <small>Prezzo unitario PDF {euroOrDash(item.sourcePrice)}</small>}
                {item.sourceTotal && (!item.sourcePrice || row.sourceMismatch) && <small>Importo PDF {euroOrDash(item.sourceTotal)}</small>}
                {row.sourceMismatch && <button className="button text-button" type="button"
                  onClick={() => setItem(index, { sourceChecked: true })}>Conferma quantità</button>}
                {item.manualPrice !== null && <button className="button text-button" type="button" onClick={() => setItem(index, { manualPrice: null, saved: false })}>Usa listino</button>}
                <button className="button text-button" type="button" disabled={busy} aria-label={'Modifica testo voce ' + item.reference}
                  onClick={event => { focusBack.current = event.currentTarget; setTextEditor(index); }}><Pencil size={15}/> Modifica testo</button>
                <button className="button text-button" type="button" aria-label={'Crea prezzo per voce ' + item.reference} onClick={event => {
                  const rate = { ...ruleFor(item), price: row.price };
                  openRate(rate, event.currentTarget);
                }}>Aggiungi al listino</button>
              </div>
            </article>;
          })}
          {!filtered.length && <p className={styles.complete}><Check size={18}/> Tutte le voci incluse hanno un prezzo.</p>}
        </div>
        {pages > 1 && <div className={styles.pagination}><span>Pagina {currentPage} di {pages}</span>
          <button className="button secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Indietro</button>
          <button className="button secondary" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Avanti</button></div>}
        <footer className={styles.actions}>
          {pending.length > 0 && <p>Completa i prezzi o escludi le voci che non vuoi offrire.</p>}
          {!draftSite && <p>Seleziona il cantiere per salvare.</p>}
          {!included.length && <p>Includi almeno una voce nel preventivo.</p>}
          <button type="button" className="button secondary" disabled={!ready || busy} onClick={() => window.print()}><Printer size={17}/> Stampa o salva PDF</button>
          <button type="button" className="button primary" disabled={!ready || busy} onClick={() => void saveQuote()}><Save size={17}/> Salva preventivo</button>
        </footer></>}
      </section>}
      {siteEditor && draft?.siteDetails && <SiteFromEstimate prefill={draft.siteDetails} identity={identity} today={today} onClose={closeSite} onCreated={siteCreated}/>}
      {textEditor !== null && editingItem && <LineTextEditor item={editingItem} onClose={closeText} onApply={updated => {
        setItem(textEditor, reviseQuoteLineText(editingItem, updated));
        closeText();
      }}/>}
      {rateEditor && <RateEditor key={rateEditor.id} rate={rateEditor} existing={rates.some(rate => rate.id === rateEditor.id)} onClose={closeRate}
        onSave={saveRate} onRemove={removeRate}/>}
    </div>
    {draft && ready && draftSite && <PrintQuote draft={draft} site={draftSite} org={identity.org.name} lines={lines} total={total}/>}
  </>;
}

function LineTextEditor({ item, onClose, onApply }: { item: DraftItem; onClose: () => void; onApply: (value: QuoteLineText) => void }) {
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = quoteLineTextSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!text.success) {
      setError('Inserisci un titolo per la voce e controlla la lunghezza dei testi.');
      return;
    }
    onApply(text.data);
  }
  return <Drawer title={`Modifica voce ${item.reference}`} onClose={onClose}>
    <form className="editor-form" onSubmit={submit}>
      <fieldset className="form-grid drawer-fields">
        <label>Titolo voce<input name="title" autoFocus required maxLength={quoteLineTextLimits.title}
          defaultValue={item.title.slice(0, quoteLineTextLimits.title)}/></label>
        <label>Descrizione voce<textarea name="description" rows={8} maxLength={quoteLineTextLimits.description}
          defaultValue={item.description.slice(0, quoteLineTextLimits.description)}/></label>
        <p className={styles.rateHint}>Il preventivo usa questi testi. Il listino continua a basarsi sulla voce originale.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </fieldset>
      <footer className="drawer-footer">
        <button type="button" className="button secondary" onClick={onClose}>Annulla</button>
        <button type="submit" className="button primary">Applica modifiche</button>
      </footer>
    </form>
  </Drawer>;
}

function RateEditor({ rate, existing, onSave, onRemove, onClose }: {
  rate: EstimateRate; existing: boolean; onSave: (value: EstimateRate) => Promise<void>;
  onRemove: (value: EstimateRate) => Promise<void>; onClose: () => void;
}) {
  const [fields, setFields] = useState(rate);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = rateSchema.safeParse(fields);
    if (!parsed.success) {
      const detail = parsed.error.issues.find(issue => issue.code === 'custom' && !issue.path.length)?.message;
      setError(detail ?? 'Controlla nome, unità, durata e prezzo.');
      return;
    }
    await perform(() => onSave(parsed.data));
  }

  async function perform(fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await fn(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Salvataggio non riuscito.'); }
    finally { setBusy(false); inFlight.current = false; }
  }

  const entries = [
    { key: 'label', label: 'Nome lavorazione', required: true, max: 120 },
    { key: 'code', label: 'Codice nel computo', max: 80 },
    { key: 'phrase', label: 'Parole nel titolo della voce', max: 200 },
    { key: 'unit', label: 'Unità di misura', required: true, max: 40 },
  ] as const;
  return <Drawer title={existing ? 'Modifica prezzo' : 'Aggiungi prezzo al listino'} onClose={onClose} busy={busy}>
    <form className="editor-form" onSubmit={submit}>
      <fieldset className="form-grid drawer-fields" disabled={busy}>
        {entries.map(input => <label key={input.key}>{input.label}<input required={'required' in input} autoFocus={input.key === 'label'}
          maxLength={input.max} value={fields[input.key]} onChange={event => setFields({ ...fields, [input.key]: event.target.value })}/></label>)}
        <label>Tipo di prezzo<select aria-label="Tipo di prezzo" value={fields.kind} onChange={event => {
          const kind = event.target.value as EstimateRate['kind'];
          setFields({ ...fields, kind, months: kind === 'rental' ? 1 : null });
        }}>{priceKinds.map(kind => <option key={kind} value={kind}>{priceKindLabels[kind]}</option>)}</select></label>
        {fields.kind === 'rental' && <label>Mesi di noleggio inclusi<input type="number" min={1} max={120} step={1} required
          value={fields.months ?? ''} onChange={event => setFields({ ...fields, months: event.target.value ? Number(event.target.value) : null })}/></label>}
        <label>Prezzo unitario (€)<input inputMode="decimal" maxLength={12} required value={fields.price}
          onChange={event => setFields({ ...fields, price: event.target.value })}/></label>
        <p className={styles.rateHint}>Inserisci un codice o le parole da cercare. Compila entrambi se il codice si ripete in più lavorazioni.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </fieldset>
      <footer className="drawer-footer">
        {existing && <button className="button text-button" type="button" disabled={busy} onClick={() => void perform(() => onRemove(rate))}><Trash2 size={17}/> Rimuovi prezzo</button>}
        <button className="button secondary" type="button" disabled={busy} onClick={onClose}>Annulla</button>
        <button className="button primary" disabled={busy}>Salva prezzo</button>
      </footer>
    </form>
  </Drawer>;
}

function PrintQuote({ draft, site, org, lines, total }: { draft: Draft; site: SiteOption; org: string; lines: QuoteLine[]; total: bigint }) {
  return <section className={styles.print}>
    <header><p>{org}</p><h1>{draft.title}</h1><p>{site.name} · {site.city}{site.client && ' · ' + site.client}</p>
      <small>Computo di partenza {draft.fileName}</small></header>
    <table><thead><tr><th>Voce</th><th>Descrizione</th><th>U.M.</th><th>Quantità</th><th>Prezzo</th><th>Importo</th></tr></thead>
      <tbody>{lines.map((line, index) => <tr key={index}><td>{line.reference}{line.code && <small>{line.code}</small>}</td>
        <td><b>{line.title}</b>{line.description && line.description !== line.title && <small className={styles.printDescription}>{line.description}</small>}</td><td>{line.unit}</td>
        <td>{line.quantity.replace('.', ',')}</td><td>{euroOrDash(line.price)}</td><td>{formatEuro(quoteTotal(line)!)}</td></tr>)}</tbody></table>
    <p className={styles.printTotal}><b>Totale lavori {formatEuro(total)}</b> · IVA esclusa</p>
  </section>;
}
