'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, ArrowUpRight, Building2, CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, CircleAlert, ClipboardList, Clock3, HardHat, MapPin, Pencil, Plus, Search, SlidersHorizontal, UserRound, X, Check, Layers3, MoveUpRight, Wrench, ScanSearch } from 'lucide-react';
import { demoKey, demoWorkspace, getDemo, updateDemo } from '@/lib/demo';
import { formatDate, jobLabels, kindLabels, PAGE_SIZE, parseWorkspaceParams, siteLabels, siteStates, type Action, type AgendaItem, type Identity, type Job, type Row, type Site, type Workspace } from '@/lib/domain';
import { requestWorkspace } from '@/lib/client-api';
import { Shell, orgLink } from './shell';
import { Editor } from './editor';
import { OperationLinks } from './operation-links';

type EditorState = { type: 'site'; site?: Site; clientId?: string } | { type: 'job'; site: Pick<Site, 'id' | 'name'>; job?: Job };
type AgendaPeriod = 'today' | 'week' | 'overdue';

const periodLabels: Record<AgendaPeriod, string> = { today: 'Oggi', week: 'Prossimi 7 gg', overdue: 'In ritardo' };
const emptyPeriod: Record<AgendaPeriod, string> = { today: 'Nessun intervento oggi.', week: 'Nessun intervento nei prossimi 7 giorni.', overdue: 'Nessun intervento in ritardo.' };
const jobIcons = { survey: ScanSearch, assembly: Layers3, adjustment: Wrench, dismantling: HardHat, other: ClipboardList };

function Badge({ label, tone }: { label: string; tone: string }) {
  return <span className={`badge badge-${tone}`}><i aria-hidden="true"/>{label}</span>;
}

function DateLabel({ date, full = false }: { date: string; full?: boolean }) {
  return <time dateTime={date}>{formatDate(date, full ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' })}</time>;
}

function SiteAnchor({ href, onOpen, children, className }: { href: string; onOpen: (href: string) => void; children: ReactNode; className?: string }) {
  function click(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(href);
  }
  return <a href={href} onClick={click} className={className}>{children}</a>;
}

export function Dashboard({ identity, initial, today }: { identity: Identity; initial: Workspace; today: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const params = search.toString();
  const queryTerm = search.get('q') ?? '';
  const queryState = search.get('stato') ?? '';
  const queryPage = search.get('pagina') ?? '';
  const selected = pathname.split('/')[2] ?? search.get('cantiere');
  const newSiteRequested = !selected && search.get('nuovo') === '1';
  const preferredClient = search.get('cliente');
  const filters = useMemo(() => parseWorkspaceParams(
    new URLSearchParams({ q: queryTerm, stato: queryState, pagina: queryPage }), selected,
  ), [queryTerm, queryState, queryPage, selected]);
  const [workspace, setWorkspace] = useState(initial);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [readError, setReadError] = useState('');
  const [pendingJob, setPendingJob] = useState('');
  const jobRequest = useRef(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const startingKey = useRef(JSON.stringify(filters));
  const input = useRef<HTMLInputElement>(null);
  const agenda = useRef<HTMLElement>(null);
  const sites = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<'search' | 'agenda' | 'sites' | 'detail' | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const pendingRefresh = useRef(false);
  const period: AgendaPeriod = search.get('periodo') === 'ritardo' ? 'overdue' : search.get('periodo') === 'settimana' ? 'week' : 'today';
  const overview = '/cantieri';
  const current = workspace.current?.site.id === filters.siteId ? workspace.current : null;

  useEffect(() => {
    if (identity.demo) {
      setWorkspace(demoWorkspace(getDemo(today), filters, today));
      const sync = (event: StorageEvent) => {
        if (event.key === demoKey) setWorkspace(demoWorkspace(getDemo(today), filters, today));
      };
      window.addEventListener('storage', sync);
      return () => window.removeEventListener('storage', sync);
    }
    const key = JSON.stringify(filters);
    if (startingKey.current === key && revision === 0) return;
    startingKey.current = '';
    const controller = new AbortController();
    setLoading(true);
    setReadError('');
    const timeout = window.setTimeout(() => {
      const query = new URLSearchParams({ azienda: identity.org.id, q: filters.q, stato: filters.status, pagina: String(filters.page) });
      if (filters.siteId) query.set('cantiere', filters.siteId);
      requestWorkspace<Workspace>(query, controller.signal).then(data => {
        if (!controller.signal.aborted) setWorkspace(data);
      }).catch(error => {
        if (!controller.signal.aborted) setReadError(error.message);
      }).finally(() => {
        if (!controller.signal.aborted) { setLoading(false); pendingRefresh.current = false; }
      });
    }, filters.q ? 180 : 0);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [filters, identity.org.id, identity.demo, today, revision]);

  useEffect(() => {
    if (notice && !notice.error) {
      const timeout = window.setTimeout(() => setNotice(null), 3500);
      return () => window.clearTimeout(timeout);
    }
  }, [notice]);

  function makeUrl(path: string, updates: Record<string, string | null> = {}) {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(updates)) value ? next.set(key, value) : next.delete(key);
    if (identity.orgs.length > 1) next.set('azienda', identity.org.id);
    if (path === overview) next.delete('cantiere');
    return path + (next.size ? '?' + next : '');
  }

  function setView(view: 'agenda' | 'sites', focus?: 'search' | 'sites' | 'agenda', extra: Record<string, string | null> = {}) {
    pendingFocus.current = focus ?? null;
    window.history.pushState(null, '', makeUrl(overview, { vista: view === 'sites' ? 'elenco' : 'agenda', ...extra, cerca: null }));
  }

  function focusSearch() {
    if (!filters.siteId && input.current && input.current.offsetParent !== null) {
      input.current.focus();
      return;
    }
    setView('sites', 'search');
  }

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !editor) {
        event.preventDefault();
        focusSearch();
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });

  useEffect(() => {
    if (!newSiteRequested) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('nuovo') !== '1') return;
    url.searchParams.delete('nuovo');
    url.searchParams.delete('cliente');
    window.history.replaceState(null, '', url.pathname + url.search);
    restoreFocus.current = document.activeElement as HTMLElement | null;
    setEditor({ type: 'site', clientId: preferredClient ?? undefined });
  }, [newSiteRequested, preferredClient]);

  useEffect(() => {
    if (search.get('cerca') === '1') {
      pendingFocus.current = 'search';
      window.history.replaceState(null, '', makeUrl(overview, { vista: 'elenco', cerca: null }));
    }
    const key = pendingFocus.current;
    const target = key === 'search' ? input.current : key === 'agenda' ? agenda.current : key === 'sites' ? sites.current : key === 'detail' ? heading.current : null;
    if (target && target.offsetParent !== null) { target.focus(); pendingFocus.current = null; }
  });

  function siteHref(id: string) {
    const next = new URLSearchParams(params);
    next.delete('cerca');
    if (identity.orgs.length > 1) next.set('azienda', identity.org.id);
    return overview + '/' + id + (next.size ? '?' + next : '');
  }
  function openSite(href: string) {
    pendingFocus.current = 'detail';
    window.history.pushState(null, '', href);
    window.scrollTo(0, 0);
  }
  function openEditor(value: EditorState) {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    setEditor(value);
  }
  function closeEditor() {
    setEditor(null);
    requestAnimationFrame(() => restoreFocus.current?.isConnected && restoreFocus.current.focus());
  }

  async function persist(action: Action) {
    if (identity.demo) {
      const next = updateDemo(getDemo(today), action);
      localStorage.setItem(demoKey, JSON.stringify(next));
      setWorkspace(demoWorkspace(next, filters, today));
    } else {
      await requestWorkspace(new URLSearchParams({ azienda: identity.org.id }), undefined, action);
      pendingRefresh.current = true;
      setRevision(value => value + 1);
    }
  }

  async function save(action: Action) {
    await persist(action);
    setNotice({ text: action.action === 'site' ? 'Cantiere salvato.' : 'Intervento salvato.', error: false });
    closeEditor();
    if (action.action === 'site' && !editor?.site && !filters.siteId) openSite(siteHref(action.id));
  }

  async function toggleJob(job: Job) {
    if (jobRequest.current || pendingRefresh.current) return;
    jobRequest.current = true;
    setPendingJob(job.id);
    try {
      const completed = job.status !== 'done';
      await persist({ action: 'jobStatus', id: job.id, site_id: job.site_id, status: completed ? 'done' : 'scheduled' });
      setNotice({ text: completed ? 'Intervento completato.' : 'Intervento riaperto.', error: false });
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : 'Aggiornamento non riuscito.', error: true }); }
    finally { jobRequest.current = false; setPendingJob(''); }
  }

  const agendaItems = workspace.agenda.filter(job => period === 'overdue' ? job.due_date < today : period === 'week' ? job.due_date > today : job.due_date === today);
  const pageCount = Math.max(1, Math.ceil(workspace.total / PAGE_SIZE));
  const [draft, setDraft] = useState(search.get('q') ?? '');
  useEffect(() => { setDraft(new URLSearchParams(params).get('q') ?? ''); }, [params]);

  function changeSearch(value: string) {
    setDraft(value);
    window.history.replaceState(null, '', makeUrl(overview, { q: value, pagina: null }));
  }
  function filter(status: string) {
    window.history.pushState(null, '', makeUrl(overview, { stato: status === 'all' ? null : status, pagina: null }));
  }
  const showingSites = search.get('vista') === 'elenco';

  return <Shell identity={identity} section="cantieri" detail={current?.site.name} onSearch={focusSearch} onAgenda={() => setView('agenda', 'agenda')}>
    {readError && <div className="load-error" role="alert">{readError}<button className="button secondary" onClick={() => setRevision(value => value + 1)}>Riprova</button></div>}
    {filters.siteId ? current ? <>
      <SiteAnchor className="button text-button back-link" href={overview + (params ? '?' + params : '')} onOpen={href => { window.history.pushState(null, '', href); }}><ArrowLeft size={17}/> Tutti i cantieri</SiteAnchor>
      <section className="site-summary panel">
        <div className="site-heading">
          <span className="site-mark big"><Building2 size={25}/></span>
          <div><span className="site-code">{current.site.code}</span><h1 ref={heading} tabIndex={-1}>{current.site.name}</h1></div>
          <Badge label={siteLabels[current.site.status]} tone={current.site.status} />
          <button className="button secondary" onClick={() => openEditor({ type: 'site', site: current.site })}><Pencil size={16}/> Modifica cantiere</button>
        </div>
        <dl className="site-data">
          <div><dt><MapPin size={16}/> Indirizzo</dt><dd>{[current.site.address, current.site.city].filter(Boolean).join(', ')}</dd></div>
          <div><dt><Building2 size={16}/> Cliente</dt><dd>{current.site.client_id
            ? <Link className="site-client-link" href={orgLink('/clienti?cliente=' + current.site.client_id, identity)}>{current.site.client} <ArrowUpRight size={15}/></Link>
            : 'Da assegnare'}</dd></div>
          <div><dt><UserRound size={16}/> Responsabile</dt><dd>{current.site.manager || 'Da assegnare'}</dd></div>
        </dl>
      </section>
      <section className="panel detail-agenda">
        <header className="panel-header"><div><h2>Interventi</h2><p>Programma i lavori per zona e aggiorna lo stato.</p></div>
          <button className="button primary" onClick={() => openEditor({ type: 'job', site: current.site })}><Plus size={19}/> Aggiungi intervento</button>
        </header>
        {current.jobs.length ? <ul className="detail-jobs">{current.jobs.map(job => {
          const Icon = jobIcons[job.kind];
          return <li key={job.id}>
            <span className={`job-icon job-${job.kind}`}><Icon size={19}/></span>
            <div className="detail-job-main"><strong>{kindLabels[job.kind]}{job.zone && ' · ' + job.zone}</strong>
              <small><CalendarDays size={14}/> <DateLabel date={job.due_date} full/>{job.time && ' · ' + job.time.slice(0, 5)}</small>
              {job.notes && <p>{job.notes}</p>}
            </div>
            <Badge label={job.status !== 'done' && job.due_date < today ? 'In ritardo' : jobLabels[job.status]} tone={job.status !== 'done' && job.due_date < today ? 'late' : job.status}/>
            <div className="job-actions">
              <button className="icon-button" aria-label={`Modifica ${kindLabels[job.kind]}${job.zone ? ', ' + job.zone : ''}`} onClick={() => openEditor({ type: 'job', site: current.site, job })}><Pencil size={17}/></button>
              <button className="button secondary" disabled={Boolean(pendingJob) || loading} onClick={() => toggleJob(job)}>{job.status === 'done' ? 'Riapri' : <><Check size={16}/> Completa</>}</button>
            </div>
          </li>;
        })}</ul> : <div className="empty"><CalendarDays size={26}/><strong>Nessun intervento programmato</strong><p>Aggiungi un sopralluogo, un montaggio o un altro lavoro.</p></div>}
      </section>
      <OperationLinks identity={identity} site={current.site}/>
    </> : <div className="panel empty" role="status">
      {loading || (!identity.demo && workspace === initial && !readError) ? 'Caricamento cantiere…' : 'Cantiere non disponibile.'}
      <SiteAnchor href={overview} onOpen={href => window.history.pushState(null, '', href)} className="button secondary">Torna ai cantieri</SiteAnchor>
    </div> : <>
      <section className="hero" aria-labelledby="dashboard-title">
        <div className="hero-copy">
          <div className="hero-date"><CalendarDays size={16}/><DateLabel date={today} full/></div>
          <h1 id="dashboard-title">Cantieri</h1>
          <p>Pianifica i lavori e segui i tuoi cantieri.</p>
        </div>
        <button className="button hero-button" onClick={() => openEditor({ type: 'site' })}><Plus size={20}/> Nuovo cantiere</button>
      </section>
      <div className="metrics" aria-label="Riepilogo lavori">
        {[
          { label: 'Cantieri attivi', value: workspace.counts.active, icon: HardHat, color: 'blue', click: () => setView('sites', 'sites', { stato: 'active', pagina: null, q: null }) },
          { label: 'Interventi oggi', value: workspace.counts.today, icon: CalendarCheck, color: 'green', click: () => setView('agenda', 'agenda', { periodo: null }) },
          { label: 'Prossimi 7 giorni', value: workspace.counts.week, icon: CalendarDays, color: 'violet', click: () => setView('agenda', 'agenda', { periodo: 'settimana' }) },
          { label: 'In ritardo', value: workspace.counts.overdue, icon: CircleAlert, color: 'orange', click: () => setView('agenda', 'agenda', { periodo: 'ritardo' }) },
        ].map(({ label, value, icon: Icon, color, click }) => <button key={label} className="metric" onClick={click}><span className={`metric-icon tone-${color}`}><Icon size={21}/></span><span className="metric-text"><strong>{value}</strong><small>{label}</small></span><ArrowUpRight size={17} className="metric-arrow" /></button>)}
      </div>
      <nav className="mobile-views" aria-label="Vista operativa">
        <button aria-pressed={!showingSites} onClick={() => setView('agenda')}><CalendarDays size={17}/> Agenda</button>
        <button aria-pressed={showingSites} onClick={() => setView('sites')}><HardHat size={17}/> Cantieri</button>
      </nav>
      <div className={`dashboard-grid ${showingSites ? 'view-sites' : 'view-agenda'}`}>
        <section className="panel sites-panel" ref={sites} tabIndex={-1} aria-labelledby="sites-title">
          <header className="panel-header"><div><h2 id="sites-title">Elenco cantieri</h2><p>{workspace.total} {workspace.total === 1 ? 'cantiere' : 'cantieri'}</p></div></header>
          <div className="table-tools">
            <div className="search-field"><Search size={18}/><input name="q" aria-label="Cerca per nome, cliente o comune" placeholder="Cerca per nome, cliente o comune…" autoComplete="off" maxLength={120} ref={input} value={draft} onChange={event => changeSearch(event.target.value)}/>
              {draft && <button className="icon-button inline" aria-label="Azzera ricerca" onClick={() => { changeSearch(''); input.current?.focus(); }}><X size={16}/></button>}
            </div>
            <div className="filter-field"><SlidersHorizontal size={17}/><select aria-label="Filtra per stato" value={filters.status} onChange={event => filter(event.target.value)}><option value="all">Tutti gli stati</option>{siteStates.map(status => <option key={status} value={status}>{siteLabels[status]}</option>)}</select></div>
          </div>
          <div aria-busy={loading}>
            {workspace.rows.length ? <table className="site-table">
              <thead><tr><th scope="col">Cantiere</th><th scope="col">Cliente</th><th scope="col">Stato</th><th scope="col">Prossimo</th><th scope="col"><span className="sr-only">Apri cantiere</span></th></tr></thead>
              <tbody>{workspace.rows.map(row => <SiteRow key={row.id} row={row} href={siteHref(row.id)} openSite={openSite} today={today}/>)}</tbody>
            </table> : <div className="empty"><HardHat size={26}/><strong>{filters.q || filters.status !== 'all' ? 'Nessun risultato' : 'Nessun cantiere'}</strong><p>{filters.q || filters.status !== 'all' ? 'Prova a cambiare ricerca o filtro.' : 'Crea un cantiere per programmare i lavori.'}</p>
              {(filters.q || filters.status !== 'all') && <button className="button secondary" onClick={() => window.history.pushState(null, '', makeUrl(overview, { q: null, stato: null, pagina: null }))}>Azzera filtri</button>}
            </div>}
          </div>
          <footer className="table-footer">
            <span>{workspace.total ? `${(workspace.page - 1) * PAGE_SIZE + 1}–${Math.min(workspace.page * PAGE_SIZE, workspace.total)} di ${workspace.total}` : '0 cantieri'}</span>
            <div className="pagination"><button className="icon-button" disabled={workspace.page <= 1 || loading} aria-label="Pagina precedente" onClick={() => window.history.pushState(null, '', makeUrl(overview, { pagina: String(workspace.page - 1) }))}><ChevronLeft size={18}/></button><span>{workspace.page} / {pageCount}</span><button className="icon-button" disabled={workspace.page >= pageCount || loading} aria-label="Pagina successiva" onClick={() => window.history.pushState(null, '', makeUrl(overview, { pagina: String(workspace.page + 1) }))}><ChevronRight size={18}/></button></div>
          </footer>
        </section>
        <section className="panel agenda-panel" ref={agenda} tabIndex={-1} aria-labelledby="agenda-title">
          <header className="panel-header"><div><h2 id="agenda-title">Agenda</h2><p>{formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div><span className="agenda-heading-icon"><CalendarDays size={20}/></span></header>
          <div className="period-control" role="group" aria-label="Periodo dell’agenda">
            {(Object.keys(periodLabels) as AgendaPeriod[]).map(key => <button key={key} aria-pressed={period === key} onClick={() => window.history.pushState(null, '', makeUrl(overview, { periodo: key === 'today' ? null : key === 'overdue' ? 'ritardo' : 'settimana' }))}>{periodLabels[key]}</button>)}
          </div>
          {agendaItems.length ? <ul className="agenda-items">{agendaItems.map(job => <AgendaRow key={job.id} job={job} period={period} edit={() => openEditor({ type: 'job', site: job.site, job })} />)}</ul>
            : <div className="empty agenda-empty"><CalendarCheck size={25}/><p>{emptyPeriod[period]}</p></div>}
          {agendaItems.length > 0 && <div className="agenda-footer"><Clock3 size={15}/>{agendaItems.length} {agendaItems.length === 1 ? 'intervento' : 'interventi'}</div>}
        </section>
      </div>
      <OperationLinks identity={identity}/>
    </>}
    {editor && <Editor editor={editor} clients={workspace.clients} today={today} onClose={closeEditor} save={save}/>}
    {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleAlert size={19}/> : <Check size={19}/>} {notice.text}<button className="icon-button" onClick={() => setNotice(null)} aria-label="Chiudi avviso"><X size={17}/></button></div>}
  </Shell>;
}

function SiteRow({ row, href, openSite, today }: { row: Row; href: string; openSite: (href: string) => void; today: string }) {
  return <tr>
    <td><SiteAnchor className="site-link" href={href} onOpen={openSite}><span className="site-mark"><Building2 size={17}/></span><span><strong>{row.name}</strong><small>{row.city} <span aria-hidden="true">·</span> {row.code}</small></span><ArrowRight size={17} className="mobile-row-arrow"/></SiteAnchor></td>
    <td className="row-client">{row.client || '—'}</td>
    <td><Badge label={siteLabels[row.status]} tone={row.status}/></td>
    <td className="row-date">{row.nextJob ? (row.nextJob.due_date === today ? 'Oggi' : <DateLabel date={row.nextJob.due_date}/>) : '—'}</td>
    <td className="row-end"><span aria-hidden="true"><ChevronRight size={17}/></span></td>
  </tr>;
}

function AgendaRow({ job, period, edit }: { job: AgendaItem; period: AgendaPeriod; edit: () => void }) {
  const Icon = jobIcons[job.kind];
  return <li><button className="agenda-row" onClick={edit}>
    <span className={`job-icon job-${job.kind}`}><Icon size={18}/></span>
    <span className="agenda-row-content"><strong>{kindLabels[job.kind]}</strong>
      <span>{job.site.name}{job.zone ? ' · ' + job.zone : ''}</span>
      <span className="agenda-when">{period !== 'today' && <DateLabel date={job.due_date}/>}
        {job.time && <><Clock3 size={13}/>{job.time.slice(0, 5)}</>}
        {period === 'today' && !job.time && 'Ora da definire'}
        {(job.status === 'done' || job.status === 'progress') && <span className={job.status === 'done' ? 'agenda-done' : 'agenda-progress'}>{jobLabels[job.status]}</span>}
      </span>
    </span><MoveUpRight className="agenda-arrow" size={16}/>
  </button></li>;
}
