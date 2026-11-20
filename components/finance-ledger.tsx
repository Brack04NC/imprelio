'use client';

import { ArrowDownLeft, ArrowUpRight, Ban, Download, Landmark, Pencil, Plus, Wallet } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatDate, type Identity } from '@/lib/domain';
import { demoKey } from '@/lib/demo';
import { formatEuro } from '@/lib/operation-documents';
import { demoSiteOptions } from '@/lib/operations-demo';
import type { SiteOption } from '@/lib/operation-types';
import {
  buildStatement, centsToEuroInput, euroToCents, financeStorageKey, localFinance, validateFinanceAction, writeLocalFinance,
  type FinanceAction, type FinanceData, type FinancialAccount, type FinancialEntry,
} from '@/lib/finance';
import { downloadCsv } from '@/lib/csv-download';
import { Drawer } from './editor';
import styles from './finance-ledger.module.css';

type Period = { from: string; to: string };
type AccountEditor = { kind: 'account'; id: string; existing: boolean; name: string; opening_date: string; amount: string };
type EntryEditor = {
  kind: 'entry'; id: string; account_id: string; existing: boolean; site_id: string; record_date: string;
  description: string; direction: 'in' | 'out'; amount: string; reference: string;
};
type Editor = AccountEditor | EntryEditor;
const pageSize = 15;

function defaultPeriod(account: FinancialAccount, today: string): Period {
  const monthStart = today.slice(0, 7) + '-01';
  return {
    from: monthStart > account.opening_date ? monthStart : account.opening_date,
    to: today > account.opening_date ? today : account.opening_date,
  };
}

function dateLabel(date: string) {
  return formatDate(date, { day: 'numeric', month: 'short', year: 'numeric' });
}

function periodError(from: string, to: string, opening: string) {
  if (!from || !to) return 'Seleziona le due date dell’estratto.';
  if (from > to) return 'La data finale deve essere uguale o successiva alla data iniziale.';
  if (to < opening) return 'Il periodo selezionato precede l’apertura del conto.';
  return '';
}

export function FinanceLedger({ identity, initial, sites, today }: {
  identity: Identity; initial: FinanceData; sites: SiteOption[]; today: string;
}) {
  const [data, setData] = useState(initial);
  const [availableSites, setAvailableSites] = useState(sites);
  const [accountId, setAccountId] = useState(initial.accounts[0]?.id ?? '');
  const [period, setPeriod] = useState<({ accountId: string } & Period) | null>(null);
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const focusBack = useRef<HTMLElement | null>(null);
  const addMovement = useRef<HTMLButtonElement>(null);
  const addAccount = useRef<HTMLButtonElement>(null);
  const cancelVoid = useRef<HTMLButtonElement>(null);
  const requestVoid = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!identity.demo) { setData(initial); setAvailableSites(sites); return; }
    function sync() { setData(localFinance(today)); setAvailableSites(demoSiteOptions(today, true)); }
    sync();
    const onStorage = (event: StorageEvent) => { if (event.key === financeStorageKey || event.key === demoKey || event.key === null) sync(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [identity.demo, initial, sites, today]);

  useEffect(() => { if (confirmVoid) cancelVoid.current?.focus(); }, [confirmVoid]);

  const account = data.accounts.find(item => item.id === accountId) ?? data.accounts[0];
  const editedAccount = editor?.kind === 'entry' ? data.accounts.find(item => item.id === editor.account_id) : undefined;
  const { from, to } = account ? period?.accountId === account.id ? period : defaultPeriod(account, today) : { from: '', to: '' };
  const filterError = account ? periodError(from, to, account.opening_date) : '';
  const statement = useMemo(() => account && !filterError ? buildStatement(account, data.entries, from, to) : null,
    [account, data.entries, filterError, from, to]);
  const voidedEntries = useMemo(() => !statement ? [] : data.entries.filter(entry => entry.voided
    && entry.account_id === account?.id && from <= entry.record_date && entry.record_date <= to)
    .sort((a, b) => a.record_date.localeCompare(b.record_date) || a.id.localeCompare(b.id)),
  [account?.id, data.entries, from, statement, to]);
  const sitesById = useMemo(() => new Map(availableSites.map(site => [site.id, site.name])), [availableSites]);
  const pages = Math.max(1, Math.ceil((statement?.rows.length ?? 0) / pageSize));
  const currentPage = Math.min(page, pages);

  function changePeriod(field: keyof Period, value: string) {
    if (!account) return;
    setPeriod({ accountId: account.id, from, to, [field]: value });
    setPage(1); setNotice('');
  }

  function openEditor(next: Editor) {
    focusBack.current = document.activeElement as HTMLElement | null;
    setError(''); setConfirmVoid(false); setEditor(next);
  }

  function openAccount(selected?: FinancialAccount) {
    openEditor({ kind: 'account', id: selected?.id ?? crypto.randomUUID(), existing: Boolean(selected),
      name: selected?.name ?? '', opening_date: selected?.opening_date ?? today,
      amount: selected ? centsToEuroInput(selected.opening_cents) : '0,00' });
  }

  function openEntry(entry?: FinancialEntry) {
    if (!account) return;
    const earliest = statement?.from ?? account.opening_date;
    const suggestedDate = today < earliest ? earliest : statement && today > to ? to : today;
    openEditor({ kind: 'entry', id: entry?.id ?? crypto.randomUUID(), account_id: account.id, existing: Boolean(entry),
      site_id: entry?.site_id ?? '', record_date: entry?.record_date ?? suggestedDate,
      description: entry?.description ?? '', direction: entry?.direction ?? 'in', amount: entry ? centsToEuroInput(entry.amount_cents) : '',
      reference: entry?.reference ?? '' });
  }

  function closeEditor() {
    setEditor(null); setConfirmVoid(false); setError('');
    requestAnimationFrame(() => {
      if (focusBack.current?.isConnected) focusBack.current.focus();
      else (addMovement.current ?? addAccount.current)?.focus();
    });
  }

  async function persist(action: FinanceAction) {
    if (identity.demo) { setData(writeLocalFinance(today, action)); return; }
    const response = await fetch('/api/contabilita?' + new URLSearchParams({ azienda: identity.org.id }), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action),
    });
    const result = await response.json().catch(() => null) as { data?: FinancialAccount | FinancialEntry; error?: string } | null;
    if (!response.ok || !result?.data) throw new Error(result?.error || 'Salvataggio non riuscito. Riprova.');
    const saved = result.data;
    if ('opening_cents' in saved) setData(current => ({
      ...current, accounts: [...current.accounts.filter(item => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'it')),
    }));
    else setData(current => ({ ...current, entries: [...current.entries.filter(item => item.id !== saved.id), saved] }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      if (editor.kind === 'entry' && confirmVoid) {
        await persist(validateFinanceAction({ action: 'void_entry', id: editor.id }));
        setNotice('Movimento annullato.');
      } else if (editor.kind === 'account') {
        const cents = euroToCents(editor.amount, true);
        if (cents === null) throw new Error('Inserisci un saldo iniziale valido con al massimo due decimali.');
        await persist(validateFinanceAction({ action: 'save_account', id: editor.id, name: editor.name,
          opening_date: editor.opening_date, opening_cents: cents }));
        setAccountId(editor.id); setPeriod(null); setPage(1);
        setNotice(editor.existing ? 'Conto aggiornato.' : 'Conto creato.');
      } else {
        const cents = euroToCents(editor.amount);
        if (cents === null) throw new Error('Inserisci un importo positivo con al massimo due decimali.');
        if (editedAccount && editor.record_date < editedAccount.opening_date)
          throw new Error('La data del movimento precede l’apertura del conto.');
        await persist(validateFinanceAction({ action: 'save_entry', id: editor.id, account_id: editor.account_id,
          site_id: editor.site_id || null, record_date: editor.record_date, description: editor.description,
          direction: editor.direction, amount_cents: cents, reference: editor.reference }));
        const outside = editor.record_date < from || editor.record_date > to;
        setNotice(outside ? 'Movimento salvato. La data è fuori dal periodo visualizzato.' : 'Movimento salvato.');
      }
      closeEditor();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Operazione non riuscita. Riprova.');
    } finally { setBusy(false); inFlight.current = false; }
  }

  function exportStatement() {
    if (!account || !statement) return;
    const name = account.name.toLocaleLowerCase('it').replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/g, '') || 'conto';
    downloadCsv('estratto-conto-' + name + '-' + from + '-' + to + '.csv', [
      ['Data', 'Descrizione', 'Cantiere', 'Riferimento', 'Entrate EUR', 'Uscite EUR', 'Saldo EUR'],
      [statement.from, 'Saldo iniziale', '', '', '', '', centsToEuroInput(statement.opening)],
      ...statement.rows.map(({ entry, balance }) => [
        entry.record_date, entry.description, entry.site_id ? sitesById.get(entry.site_id) ?? '' : '', entry.reference,
        entry.direction === 'in' ? centsToEuroInput(entry.amount_cents) : '',
        entry.direction === 'out' ? centsToEuroInput(entry.amount_cents) : '',
        centsToEuroInput(balance),
      ]),
      [to, 'Saldo finale', '', '', centsToEuroInput(statement.income), centsToEuroInput(statement.expenses), centsToEuroInput(statement.closing)],
    ]);
  }

  const title = confirmVoid ? 'Annulla movimento' : editor?.kind === 'account' ? (editor.existing ? 'Modifica conto' : 'Nuovo conto')
    : editor?.existing ? 'Modifica movimento' : 'Nuovo movimento';

  return <>
    <header className={`page-header ${styles.ledgerHeader}`}>
      <h2>Estratto conto</h2>
      <div className={styles.headerActions}>
        <button ref={addAccount} type="button" className={`button ${account ? 'secondary' : 'primary'}`} onClick={() => openAccount()}>
          <Landmark size={17}/> Nuovo conto</button>
        {account && <button ref={addMovement} type="button" className="button primary" onClick={() => openEntry()}>
          <Plus size={18}/> Nuovo movimento</button>}
      </div>
    </header>
    {notice && <p className="access-notice" role="status">{notice}</p>}
    {account ? <>
      <section className={`panel form-grid ${styles.filters}`} aria-label="Periodo e conto">
        <div className={styles.accountSelect}>
          <label><span id="statement-account-label">Conto</span><select aria-labelledby="statement-account-label" value={account.id}
            onChange={event => { setAccountId(event.target.value); setPeriod(null); setPage(1); setNotice(''); }}>
            {data.accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <button type="button" className="icon-button" aria-label="Modifica conto" title="Modifica conto" onClick={() => openAccount(account)}>
            <Pencil size={17}/>
          </button>
        </div>
        <label>Dal<input type="date" max={to || undefined} value={from} onChange={event => changePeriod('from', event.target.value)}
          aria-invalid={filterError ? true : undefined} aria-describedby={filterError ? 'statement-filter-error' : undefined}/></label>
        <label>Al<input type="date" min={from || undefined} value={to} onChange={event => changePeriod('to', event.target.value)}
          aria-invalid={filterError ? true : undefined} aria-describedby={filterError ? 'statement-filter-error' : undefined}/></label>
        <button type="button" className="button secondary" disabled={!statement} onClick={exportStatement}>
          <Download size={17}/> Esporta CSV</button>
        {filterError && <p className={styles.filterError} id="statement-filter-error" role="status">{filterError}</p>}
      </section>
      {statement && <>
        <dl className={styles.totals} aria-label="Riepilogo del periodo">
          {[
            { label: 'Saldo iniziale', amount: statement.opening, icon: Wallet, tone: styles.base },
            { label: 'Entrate', amount: statement.income, icon: ArrowDownLeft, tone: styles.income },
            { label: 'Uscite', amount: statement.expenses, icon: ArrowUpRight, tone: styles.expense },
            { label: 'Saldo finale', amount: statement.closing, icon: Wallet, tone: styles.final },
          ].map(({ label, amount, icon: Icon, tone }) => <div className={`panel ${styles.total} ${tone}`} key={label}>
            <dt><Icon size={17}/>{label}</dt><dd>{formatEuro(amount)}</dd>
          </div>)}
        </dl>
        <section className="panel" aria-labelledby="finance-entries-heading">
          <header className={styles.statementHeader}><h3 id="finance-entries-heading">Movimenti</h3>
            <span>{statement.rows.length} {statement.rows.length === 1 ? 'movimento' : 'movimenti'}</span></header>
          {statement.rows.length ? <table className={styles.table} role="table" aria-label="Movimenti del periodo">
            <thead role="rowgroup"><tr role="row"><th scope="col">Data</th><th scope="col">Descrizione</th>
              <th scope="col" className={styles.number}>Importo</th><th scope="col" className={styles.number}>Saldo progressivo</th><th scope="col"><span className="sr-only">Azioni</span></th></tr></thead>
            <tbody role="rowgroup">
              {statement.rows.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(({ entry, balance }) => {
                const site = entry.site_id && sitesById.get(entry.site_id);
                return <tr key={entry.id} role="row">
                  <td role="cell" className={styles.dateCell}><time dateTime={entry.record_date}>{dateLabel(entry.record_date)}</time></td>
                  <td role="cell" className={styles.descriptionCell}><strong>{entry.description}</strong>
                    {(site || entry.reference) && <small>{[site, entry.reference].filter(Boolean).join(' · ')}</small>}</td>
                  <td role="cell" className={`${styles.number} ${styles.amountCell} ${entry.direction === 'in' ? styles.incomeValue : styles.expenseValue}`}>
                    <span className={styles.mobileLabel}>{entry.direction === 'in' ? 'Entrata' : 'Uscita'}</span>
                    {entry.direction === 'in' ? '+' : '−'}{formatEuro(BigInt(entry.amount_cents))}</td>
                  <td role="cell" className={`${styles.number} ${styles.balanceCell}`}><span className={styles.mobileLabel}>Saldo</span>{formatEuro(balance)}</td>
                  <td role="cell" className={styles.actionCell}><button type="button" className="icon-button" onClick={() => openEntry(entry)}
                    aria-label={`Modifica movimento ${entry.description}`} title="Modifica movimento"><Pencil size={17}/></button></td>
                </tr>;
              })}
            </tbody>
          </table> : <div className="empty"><Wallet size={23}/><strong>Nessun movimento nel periodo</strong>
            <p>Puoi aggiungere un movimento o cambiare le date.</p></div>}
          {pages > 1 && <div className={styles.pagination}>
            <button type="button" className="button secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Precedente</button>
            <span>Pagina {currentPage} di {pages}</span>
            <button type="button" className="button secondary" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Successiva</button>
          </div>}
          {voidedEntries.length > 0 && <details className={styles.voided}>
            <summary>Movimenti annullati ({voidedEntries.length})</summary>
            <ul>{voidedEntries.map(entry => <li key={entry.id}><strong>{entry.description}</strong>
              <span><time dateTime={entry.record_date}>{dateLabel(entry.record_date)}</time> · {formatEuro(BigInt(entry.amount_cents))}</span></li>)}</ul>
          </details>}
        </section>
      </>}
    </> : <section className="panel empty"><Landmark size={25}/><strong>Nessun conto</strong>
      <p>Crea un conto per iniziare a registrare entrate e uscite.</p></section>}
    {editor && <Drawer title={title} busy={busy} onClose={closeEditor}>
      <form className="editor-form" onSubmit={save}>
        <fieldset className="drawer-fields form-grid" disabled={busy}>
          {confirmVoid ? <p className={styles.hint}>Il movimento verrà escluso dal saldo e resterà consultabile tra i movimenti annullati.</p>
          : editor.kind === 'account' ? <>
            <label>Nome conto<input autoFocus required maxLength={120} value={editor.name} placeholder="Es. Conto principale"
              onChange={event => setEditor({ ...editor, name: event.target.value })}/></label>
            <label>Data di apertura<input required type="date" value={editor.opening_date}
              onChange={event => setEditor({ ...editor, opening_date: event.target.value })}/></label>
            <label>Saldo iniziale in euro<input required inputMode="decimal" maxLength={17} value={editor.amount}
              onChange={event => setEditor({ ...editor, amount: event.target.value })}/></label>
          </> : <>
            <p className="editor-context">{editedAccount?.name}</p>
            <label>Descrizione<input autoFocus required maxLength={250} value={editor.description}
              onChange={event => setEditor({ ...editor, description: event.target.value })}/></label>
            <div className={`form-pair ${styles.movementPair}`}>
              <label><span id="finance-direction-label">Tipo</span><select aria-labelledby="finance-direction-label" value={editor.direction}
                onChange={event => setEditor({ ...editor, direction: event.target.value === 'out' ? 'out' : 'in' })}>
                <option value="in">Entrata</option><option value="out">Uscita</option></select></label>
              <label>Importo in euro<input required inputMode="decimal" maxLength={16} value={editor.amount} placeholder="0,00"
                onChange={event => setEditor({ ...editor, amount: event.target.value })}/></label>
            </div>
            <label>Data del movimento<input required type="date" min={editedAccount?.opening_date} value={editor.record_date}
              onChange={event => setEditor({ ...editor, record_date: event.target.value })}/></label>
            <label><span id="finance-site-label">Cantiere</span><select aria-labelledby="finance-site-label" value={editor.site_id}
              onChange={event => setEditor({ ...editor, site_id: event.target.value })}>
              <option value="">Nessun cantiere</option>
              {availableSites.map(site => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}
            </select></label>
            <label>Riferimento<input maxLength={100} value={editor.reference} placeholder="Es. Fattura n. 24"
              onChange={event => setEditor({ ...editor, reference: event.target.value })}/></label>
          </>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </fieldset>
        <footer className={`drawer-footer ${styles.drawerFooter}`}>
          {editor.kind === 'entry' && editor.existing && !confirmVoid && <button ref={requestVoid} type="button" className={`button secondary ${styles.remove}`}
            disabled={busy} onClick={() => { setConfirmVoid(true); setError(''); }}><Ban size={16}/> Annulla movimento</button>}
          <button ref={cancelVoid} type="button" className="button secondary" disabled={busy}
            onClick={confirmVoid ? () => {
              setConfirmVoid(false);
              setError('');
              requestAnimationFrame(() => requestVoid.current?.focus());
            } : closeEditor}>{confirmVoid ? 'Indietro' : 'Annulla'}</button>
          <button type="submit" className={`button ${confirmVoid ? styles.danger : 'primary'}`} disabled={busy}>
            {busy ? 'Attendi…' : confirmVoid ? 'Conferma annullamento' : editor.kind === 'account' ? 'Salva conto' : 'Salva movimento'}</button>
        </footer>
      </form>
    </Drawer>}
  </>;
}
