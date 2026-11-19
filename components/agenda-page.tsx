'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarCheck, CalendarDays, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { agendaPeriods, agendaRange, inAgenda, type AgendaView } from '@/lib/agenda';
import { requestWorkspace } from '@/lib/client-api';
import { demoAgenda, demoKey, getDemo, updateDemo } from '@/lib/demo';
import { formatDate, type Action, type AgendaItem, type Identity, type Site } from '@/lib/domain';
import { AgendaRow } from './agenda-row';
import { Editor } from './editor';
import { Shell, orgLink } from './shell';

type SiteChoice = Pick<Site, 'id' | 'name' | 'city'>;

const empty = {
  oggi: 'Nessun intervento oggi.',
  settimana: 'Nessun intervento nei prossimi 7 giorni.',
  ritardo: 'Nessun intervento in ritardo.',
  data: 'Nessun intervento per questa data.',
};

export function AgendaPage({ identity, today, view, items, sites }: {
  identity: Identity; today: string; view: AgendaView; items: AgendaItem[]; sites: SiteChoice[];
}) {
  const router = useRouter();
  const [demo, setDemo] = useState<ReturnType<typeof getDemo> | null>(null);
  const [editing, setEditing] = useState<AgendaItem | 'new' | null>(null);
  const [notice, setNotice] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  const add = useRef<HTMLButtonElement>(null);
  const range = agendaRange(view, today);
  const displayed = demo ? demoAgenda(demo, range) : { items, sites };
  const selectedDay = view.period === 'data' ? view.date : today;
  const dayLabel = (day: string) => formatDate(day, { day: 'numeric', month: 'long', year: 'numeric' });
  const rangeLabel = view.period === 'settimana' && range.from
    ? `${dayLabel(range.from)} – ${dayLabel(range.to)}`
    : view.period === 'ritardo' ? 'Interventi scaduti ancora aperti' : dayLabel(selectedDay);

  useEffect(() => {
    if (!identity.demo) return;
    setDemo(getDemo(today));
    const sync = (event: StorageEvent) => {
      if (event.key === demoKey || event.key === null) setDemo(getDemo(today));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [identity.demo, today]);

  function dateHref(date: string) {
    return orgLink('/agenda?' + new URLSearchParams({ data: date }), identity);
  }

  function chooseDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const date = new FormData(event.currentTarget).get('data');
    if (typeof date === 'string' && date) router.push(dateHref(date));
  }

  function openEditor(job: AgendaItem | 'new') {
    opener.current = document.activeElement as HTMLElement;
    setNotice('');
    setEditing(job);
  }

  function closeEditor() {
    setEditing(null);
    requestAnimationFrame(() => (opener.current?.isConnected ? opener.current : add.current)?.focus());
  }

  async function save(action: Action) {
    if (action.action !== 'job') return;
    if (identity.demo) {
      const next = updateDemo(getDemo(today), action);
      localStorage.setItem(demoKey, JSON.stringify(next));
      setDemo(next);
    } else {
      await requestWorkspace(new URLSearchParams({ azienda: identity.org.id }), undefined, action);
    }
    closeEditor();
    setNotice('Intervento salvato.');
    if (!inAgenda(action, range)) window.location.assign(dateHref(action.due_date));
    else if (!identity.demo) router.refresh();
  }

  return <Shell identity={identity} section="agenda">
    <header className="page-header agenda-page-header">
      <div><h1>Agenda</h1><p>Programma e consulta gli interventi dei cantieri.</p></div>
      {displayed.sites.length > 0 && <button ref={add} className="button primary" onClick={() => openEditor('new')}>
        <Plus size={18}/> Aggiungi intervento
      </button>}
    </header>
    <section className="panel agenda-panel" aria-labelledby="agenda-period">
      <header className="panel-header">
        <div><h2 id="agenda-period">{view.period === 'data' ? 'Data selezionata' : agendaPeriods.find(item => item.id === view.period)?.label}</h2>
          <p>{rangeLabel}</p>
        </div>
        <span className="agenda-heading-icon"><CalendarDays size={20}/></span>
      </header>
      <div className="agenda-tools">
        <nav className="period-control" aria-label="Periodo dell’agenda">
          {agendaPeriods.map(({ id, label }) => <Link key={id} aria-current={view.period === id ? 'page' : undefined}
            href={orgLink(id === 'oggi' ? '/agenda' : '/agenda?periodo=' + id, identity)}>{label}</Link>)}
        </nav>
        <form key={selectedDay} className="agenda-date-form" action="/agenda" onSubmit={chooseDay}>
          {identity.orgs.length > 1 && <input type="hidden" name="azienda" value={identity.org.id}/>}
          <label>Vai a una data <input name="data" type="date" defaultValue={selectedDay} required/></label>
          <button type="submit" className="button secondary">Mostra</button>
        </form>
      </div>
      {displayed.items.length ? <ul className="agenda-items">{displayed.items.map(job =>
        <AgendaRow key={job.id} job={job} showDate={view.period === 'settimana' || view.period === 'ritardo'} edit={() => openEditor(job)}/>
      )}</ul> : <div className="empty agenda-empty">
        <CalendarCheck size={25}/><p>{empty[view.period]}</p>
        {displayed.sites.length === 0 && <Link className="button secondary" href={orgLink('/cantieri?nuovo=1', identity)}>Crea un cantiere per iniziare</Link>}
      </div>}
      {displayed.items.length > 0 && <footer className="agenda-footer">{displayed.items.length} {displayed.items.length === 1 ? 'intervento' : 'interventi'}</footer>}
    </section>
    {editing && <Editor
      editor={editing === 'new' ? { type: 'job', sites: displayed.sites } : { type: 'job', site: editing.site, job: editing }}
      today={range.from ?? today} clients={[]} onClose={closeEditor} save={save}/>}
    {notice && <div className="toast" role="status">{notice}<button type="button" className="button text-button" onClick={() => setNotice('')}>Chiudi</button></div>}
  </Shell>;
}
