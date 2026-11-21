'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarCheck, CalendarDays, List, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { agendaPeriods, agendaRange, inAgenda, type AgendaView } from '@/lib/agenda';
import { calendarPath, calendarRange, type CalendarSelection } from '@/lib/calendar';
import { requestWorkspace } from '@/lib/client-api';
import { demoAgenda, demoKey, getDemo, getDemoBacking, updateDemo } from '@/lib/demo';
import { formatDate, type Action, type AgendaItem, type Identity, type Site } from '@/lib/domain';
import { isDemoTrashed } from '@/lib/trash-demo';
import { demoTrashKey } from '@/lib/trash-storage';
import { AgendaRow, interventionActions, interventionName } from './agenda-row';
import { CalendarPanel } from './calendar-panel';
import { Editor } from './editor';
import { Shell, orgLink } from './shell';
import { useTrashRemoval } from '@/components/trash-removal';
import { StatusToast } from './feedback-toast';

type SiteChoice = Pick<Site, 'id' | 'name' | 'city'>;
type Editing = AgendaItem | { date: string; time?: string };

const empty = {
  oggi: 'Nessun intervento oggi.',
  settimana: 'Nessun intervento nei prossimi 7 giorni.',
  ritardo: 'Nessun intervento in ritardo.',
  data: 'Nessun intervento per questa data.',
};

export function AgendaPage({ identity, today, view, calendar, items, sites }: {
  identity: Identity; today: string; view: AgendaView; calendar: CalendarSelection | null; items: AgendaItem[]; sites: SiteChoice[];
}) {
  const router = useRouter();
  const [demo, setDemo] = useState<ReturnType<typeof getDemo> | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  const add = useRef<HTMLButtonElement>(null);
  const range = calendar ? calendarRange(calendar) : agendaRange(view, today);
  const displayed = demo ? demoAgenda(demo, range) : { items, sites };
  const selectedDay = calendar?.date ?? (view.period === 'data' ? view.date : today);
  const editedJob = editing && 'site' in editing ? editing : null;
  const trash = useTrashRemoval(identity, {
    kind: 'intervention', onChange: () => {
      if (identity.demo) setDemo(getDemo(today));
      else router.refresh();
    },
  });
  const dayLabel = (day: string) => formatDate(day, { day: 'numeric', month: 'long', year: 'numeric' });
  const rangeLabel = view.period === 'settimana' && range.from
    ? `${dayLabel(range.from)} – ${dayLabel(range.to)}`
    : view.period === 'ritardo' ? 'Interventi scaduti ancora aperti' : dayLabel(selectedDay);

  useEffect(() => {
    if (!identity.demo) return;
    setDemo(getDemo(today));
    const sync = (event: StorageEvent) => {
      if (event.key === demoKey || event.key === demoTrashKey || event.key === null) setDemo(getDemo(today));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [identity.demo, today]);

  useEffect(() => {
    if (!editing && opener.current?.isConnected === false && document.activeElement === document.body) {
      opener.current = null;
      add.current?.focus();
    }
  });

  function dateHref(date: string) {
    return orgLink('/agenda?' + new URLSearchParams({ data: date }), identity);
  }

  function chooseDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const date = new FormData(event.currentTarget).get('data');
    if (typeof date === 'string' && date) router.push(dateHref(date));
  }

  function openEditor(job: Editing) {
    opener.current = document.activeElement as HTMLElement;
    setNotice('');
    setEditing(job);
  }

  function closeEditor(focusAdd = false) {
    setEditing(null);
    const target = opener.current;
    requestAnimationFrame(() => (!focusAdd && target?.isConnected && target !== document.body ? target : add.current)?.focus());
  }

  function removeIntervention(job: AgendaItem, returnFocus = document.activeElement as HTMLElement | null) {
    opener.current = returnFocus;
    setEditing(null);
    setNotice('');
    trash.request(job.id, interventionName(job, job.site.name), returnFocus);
  }

  function actionsFor(job: AgendaItem) {
    return interventionActions({ edit: () => openEditor(job), remove: () => removeIntervention(job),
      siteHref: orgLink('/cantieri/' + job.site.id, identity) });
  }

  async function save(action: Action) {
    if (action.action !== 'job') return;
    if (identity.demo) {
      if (isDemoTrashed('intervention', action.id)) throw new Error('L’intervento è nel cestino. Ripristinalo prima di modificarlo.');
      const next = updateDemo(getDemoBacking(today), action);
      localStorage.setItem(demoKey, JSON.stringify(next));
      setDemo(getDemo(today));
    } else {
      await requestWorkspace(new URLSearchParams({ azienda: identity.org.id }), undefined, action);
    }
    const staysInView = inAgenda(action, range);
    closeEditor(!staysInView);
    setNotice('Intervento salvato.');
    if (!staysInView) router.push(calendar
      ? orgLink(calendarPath(calendar.view, action.due_date), identity) : dateHref(action.due_date), { scroll: false });
    else if (!identity.demo) router.refresh();
  }

  return <Shell identity={identity} section="agenda" detail={calendar ? 'Calendario' : undefined}>
    <header className="page-header agenda-page-header">
      <div><h1>{calendar ? 'Calendario' : 'Agenda'}</h1><p>Programma e consulta gli interventi dei cantieri.</p></div>
      {displayed.sites.length > 0 && <button ref={add} className="button primary" onClick={() => openEditor({ date: calendar?.date ?? range.from ?? today })}>
        <Plus size={18}/> Aggiungi intervento
      </button>}
    </header>
    <nav className="agenda-mode" aria-label="Visualizzazione degli interventi">
      <Link href={calendar && selectedDay !== today ? dateHref(selectedDay) : orgLink('/agenda', identity)}
        className="button secondary" aria-current={calendar ? undefined : 'page'}><List size={17}/> Lista</Link>
      <Link href={orgLink(calendarPath(calendar?.view ?? 'mese', selectedDay), identity)}
        className="button secondary" aria-current={calendar ? 'page' : undefined}><CalendarDays size={17}/> Calendario</Link>
    </nav>
    {calendar ? <>
      {displayed.sites.length === 0 && <Link className="button secondary agenda-create-site" href={orgLink('/cantieri?nuovo=1', identity)}>Crea un cantiere per iniziare</Link>}
      <CalendarPanel selection={calendar} today={today} identity={identity} items={displayed.items} canCreate={displayed.sites.length > 0}
        onEdit={openEditor} onCreate={(date, time) => openEditor({ date, time })} actionsFor={actionsFor}/>
    </> : <section className="panel agenda-panel" aria-labelledby="agenda-period">
      <header className="panel-header">
        <div><h2 id="agenda-period">{view.period === 'data' ? 'Data selezionata' : agendaPeriods.find(item => item.id === view.period)?.label}</h2>
          <p role="status">{rangeLabel}</p>
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
        <AgendaRow key={job.id} job={job} showDate={view.period === 'settimana' || view.period === 'ritardo'}
          edit={() => openEditor(job)} actions={actionsFor(job)}/>
      )}</ul> : <div className="empty agenda-empty">
        <CalendarCheck size={25}/><p>{empty[view.period]}</p>
        {displayed.sites.length === 0 && <Link className="button secondary" href={orgLink('/cantieri?nuovo=1', identity)}>Crea un cantiere per iniziare</Link>}
      </div>}
      {displayed.items.length > 0 && <footer className="agenda-footer">{displayed.items.length} {displayed.items.length === 1 ? 'intervento' : 'interventi'}</footer>}
    </section>}
    {editing && <Editor
      editor={'site' in editing ? { type: 'job', site: editing.site, job: editing } : { type: 'job', sites: displayed.sites }}
      today={'date' in editing ? editing.date : selectedDay} defaultTime={'date' in editing ? editing.time : undefined}
      clients={[]} onClose={closeEditor} save={save} onDelete={editedJob ? () => removeIntervention(editedJob, opener.current) : undefined}/>}
    {trash.feedback}
    <StatusToast text={notice} onClose={() => setNotice('')}/>
  </Shell>;
}
