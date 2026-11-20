'use client';

import { ArrowDown, ArrowLeft, ArrowUp, Building2, Calculator, CalendarDays, Check, ClipboardList, FileText,
  HardHat, LayoutGrid, Maximize2, MoveDiagonal2, Plus, RotateCcw, Settings2, Trash2, Truck, Users, Warehouse } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { demoKey } from '@/lib/demo';
import { formatDate, type Identity } from '@/lib/domain';
import { dashboardStorageKey, dashboardWidgetLabels, defaultDashboardWidgets, maxDashboardWidgets,
  parseDashboardWidgets, type DashboardWidget, type DashboardWidgetKind } from '@/lib/home-dashboard';
import type { DashboardData } from '@/lib/home-dashboard-data';
import { readDemoDashboard } from '@/lib/home-dashboard-demo';
import { operationsKey } from '@/lib/operations-demo';
import { demoTrashKey } from '@/lib/trash-storage';
import { Drawer } from './editor';
import { dashboardTargetLabel, dashboardTargetOptions, dashboardTargetPlaceholder, HomeDashboardWidget } from './home-dashboard-widget';
import { Shell } from './shell';
import { useRomeToday } from './use-rome-today';
import styles from './home-dashboard.module.css';

const icons = {
  calendar: CalendarDays, warehouse: Warehouse, estimates: Calculator, 'site-interventions': ClipboardList,
  sites: HardHat, fleet: Truck, clients: Building2, personnel: Users, documents: FileText,
} satisfies Record<DashboardWidgetKind, typeof CalendarDays>;
const kinds = Object.keys(icons) as DashboardWidgetKind[];
const defaultLayout = () => [...defaultDashboardWidgets];
type Dimensions = Pick<DashboardWidget, 'width' | 'height'>;

export function HomeDashboard({ identity, today: serverToday, initial }: { identity: Identity; today: string; initial: DashboardData }) {
  const key = dashboardStorageKey(identity);
  const today = useRomeToday(serverToday, identity.demo);
  const [widgets, setWidgets] = useState(defaultLayout);
  const [data, setData] = useState(initial);
  const [customizing, setCustomizing] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [editor, setEditor] = useState<DashboardWidget | 'new' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const [demoReadError, setDemoReadError] = useState(false);
  const customizeButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const focusTitle = useRef<HTMLHeadingElement>(null);
  const dialogTrigger = useRef<HTMLButtonElement>(null);
  const selected = widgets.find(widget => widget.id === focused);
  const modified = JSON.stringify(widgets) !== JSON.stringify(defaultDashboardWidgets);

  useEffect(() => {
    function load() {
      try {
        const stored = localStorage.getItem(key);
        let layout: DashboardWidget[] | null = null;
        if (stored !== null) {
          try { layout = parseDashboardWidgets(JSON.parse(stored)); } catch { /* Use the default view if the saved layout is damaged. */ }
        }
        setWidgets(layout ?? defaultLayout());
        setStorageWarning(false);
      } catch { setStorageWarning(true); }
    }
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === key) load();
    }
    load();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  useEffect(() => {
    if (!identity.demo) { setData(initial); return; }
    function refresh() {
      try { setData(readDemoDashboard(today)); setDemoReadError(false); }
      catch { setDemoReadError(true); }
    }
    function onStorage(event: StorageEvent) {
      if ([null, demoKey, operationsKey, demoTrashKey].includes(event.key)) refresh();
    }
    refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [identity.demo, initial, today]);

  function saveLayout(next: DashboardWidget[], confirmation: string) {
    setWidgets(next);
    setMessage(confirmation);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setStorageWarning(false);
    } catch { setStorageWarning(true); }
  }

  function openEditor(next: DashboardWidget | 'new', trigger: HTMLButtonElement) {
    dialogTrigger.current = trigger;
    setEditor(next);
  }

  function closeDialog() {
    setEditor(null);
    setConfirmReset(false);
    requestAnimationFrame(() => {
      const trigger = dialogTrigger.current;
      if (trigger?.isConnected && !trigger.disabled) trigger.focus();
      else (addButton.current?.disabled ? customizeButton.current : addButton.current ?? customizeButton.current)?.focus();
    });
  }

  function updateWidget(next: DashboardWidget) {
    const exists = widgets.some(widget => widget.id === next.id);
    if (editor !== 'new' && !exists) {
      setMessage('Il widget è stato rimosso da un’altra scheda.');
      closeDialog();
      return;
    }
    if (!exists && widgets.length >= maxDashboardWidgets) {
      setMessage('La dashboard ha già raggiunto il numero massimo di widget.');
      closeDialog();
      return;
    }
    saveLayout(exists ? widgets.map(widget => widget.id === next.id ? next : widget) : [...widgets, next],
      exists ? 'Widget aggiornato.' : 'Widget aggiunto.');
    closeDialog();
  }

  function move(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= widgets.length) return;
    const next = [...widgets];
    [next[index], next[destination]] = [next[destination], next[index]];
    saveLayout(next, `${dashboardWidgetLabels[next[destination].kind]} spostato in posizione ${destination + 1}.`);
    requestAnimationFrame(() => document.getElementById(`imprelio-widget-settings-${next[destination].id}`)?.focus());
  }

  function expand(widget: DashboardWidget) {
    setFocused(widget.id);
    requestAnimationFrame(() => focusTitle.current?.focus());
  }

  function returnToGrid() {
    setFocused(null);
    requestAnimationFrame(() => document.getElementById(`imprelio-widget-expand-${focused}`)?.focus());
  }

  function changeMode() {
    if (customizing) {
      setCustomizing(false);
      requestAnimationFrame(() => customizeButton.current?.focus());
    } else {
      setCustomizing(true);
      requestAnimationFrame(() => (addButton.current?.disabled ? customizeButton.current : addButton.current)?.focus());
    }
  }

  function renderWidget(widget: DashboardWidget, index: number, expanded = false) {
    const title = dashboardWidgetLabels[widget.kind];
    const Icon = icons[widget.kind];
    const titleId = `imprelio-widget-title-${widget.id}`;
    return <section className={`panel ${styles.card}`} data-widget-kind={widget.kind} data-width={widget.width} data-height={widget.height}
      data-expanded={expanded || undefined} aria-labelledby={titleId} key={widget.id}>
      <header className={styles.cardHeader}>
        <span className={styles.cardIcon}><Icon size={20} aria-hidden="true"/></span>
        <h2 id={titleId} ref={expanded ? focusTitle : undefined} tabIndex={expanded ? -1 : undefined}>{title}</h2>
        {!expanded && <div className={styles.cardActions}>
          {customizing ? <>
            <button type="button" className="icon-button" disabled={index === 0} title="Sposta prima" aria-label={`Sposta prima ${title}`}
              onClick={() => move(index, -1)}><ArrowUp size={17} aria-hidden="true"/></button>
            <button type="button" className="icon-button" disabled={index === widgets.length - 1} title="Sposta dopo" aria-label={`Sposta dopo ${title}`}
              onClick={() => move(index, 1)}><ArrowDown size={17} aria-hidden="true"/></button>
            <button type="button" className="icon-button" id={`imprelio-widget-settings-${widget.id}`} title="Configura widget"
              aria-label={`Configura ${title}`} aria-haspopup="dialog" onClick={event => openEditor(widget, event.currentTarget)}>
              <Settings2 size={18} aria-hidden="true"/>
            </button>
          </> : <button type="button" className="icon-button" id={`imprelio-widget-expand-${widget.id}`} title="Apri widget a tutta larghezza"
            aria-label={`Espandi ${title}`} onClick={() => expand(widget)}><Maximize2 size={18} aria-hidden="true"/></button>}
        </div>}
      </header>
      <div className={styles.widgetBody}><HomeDashboardWidget widget={expanded ? { ...widget, width: 2, height: 2 } : widget}
        data={data} identity={identity} today={today}/></div>
      {customizing && !expanded && <footer className={styles.cardFooter}>
        <span>{widget.width === 2 ? 'Largo' : 'Metà larghezza'} · {widget.height === 2 ? 'Alto' : 'Altezza standard'}</span>
        <ResizeGrip title={title} widget={widget} onOpen={trigger => openEditor(widget, trigger)} onResize={size => {
          saveLayout(widgets.map(item => item.id === widget.id ? { ...item, ...size } : item), `Dimensioni di ${title} aggiornate.`);
        }}/>
      </footer>}
    </section>;
  }

  return <Shell identity={identity} section="dashboard">
    <header className={styles.heading}>
      <div><h1>Dashboard</h1><div className={styles.date}><CalendarDays size={16} aria-hidden="true"/>
        <time dateTime={today}>{formatDate(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</time>
      </div></div>
      {selected ? <button type="button" className="button secondary" onClick={returnToGrid}><ArrowLeft size={17} aria-hidden="true"/> Torna alla dashboard</button>
        : <div className={styles.headingActions}>
          {customizing && <>
            {modified && <button type="button" className="button secondary" aria-haspopup="dialog" onClick={event => {
              dialogTrigger.current = event.currentTarget;
              setConfirmReset(true);
            }}><RotateCcw size={16} aria-hidden="true"/> Ripristina vista</button>}
            <button type="button" className="button primary" ref={addButton} aria-haspopup="dialog" disabled={widgets.length >= maxDashboardWidgets}
              onClick={event => openEditor('new', event.currentTarget)}><Plus size={18} aria-hidden="true"/> Aggiungi widget</button>
          </>}
          <button type="button" ref={customizeButton} className="button secondary" onClick={changeMode}>
            {customizing ? <><Check size={17} aria-hidden="true"/> Fine</> : <><Settings2 size={17} aria-hidden="true"/> Personalizza</>}
          </button>
        </div>}
    </header>
    {storageWarning && <p className={styles.notice} role="status">Il browser non riesce a salvare il layout. Le modifiche restano disponibili finché la pagina è aperta.</p>}
    {demoReadError && <p className={styles.notice} role="status">Aggiornamento dei dati della demo non riuscito. Ricarica la pagina per riprovare.</p>}
    <p className="sr-only" role="status">{message}</p>
    {selected ? <div className={styles.focusView}>{renderWidget(selected, 0, true)}</div>
      : widgets.length ? <div className={styles.grid} data-customizing={customizing || undefined}>
        {widgets.map((widget, index) => renderWidget(widget, index))}
      </div> : <section className={`panel ${styles.empty}`}>
        <LayoutGrid aria-hidden="true" size={23}/><h2>La dashboard è vuota</h2>
        <p>Aggiungi un widget per iniziare.</p>
        {!customizing && <button type="button" className="button primary" aria-haspopup="dialog" onClick={event => openEditor('new', event.currentTarget)}>
          <Plus size={18} aria-hidden="true"/> Aggiungi widget
        </button>}
      </section>}
    {editor !== null && <WidgetEditor key={editor === 'new' ? 'new' : editor.id} widget={editor === 'new' ? null : editor} data={data}
      onSave={updateWidget} onClose={closeDialog} onRemove={editor === 'new' ? undefined : () => {
        saveLayout(widgets.filter(widget => widget.id !== editor.id), 'Widget rimosso.');
        closeDialog();
      }}/>}
    {confirmReset && <Drawer title="Ripristina vista iniziale" onClose={closeDialog}>
      <div className={`drawer-fields ${styles.resetCopy}`}><p>La dashboard tornerà ai quattro widget iniziali. La configurazione personalizzata verrà sostituita.</p></div>
      <footer className="drawer-footer">
        <button type="button" className="button secondary" autoFocus onClick={closeDialog}>Annulla</button>
        <button type="button" className="button primary" onClick={() => { saveLayout(defaultLayout(), 'Vista iniziale ripristinata.'); closeDialog(); }}>Ripristina</button>
      </footer>
    </Drawer>}
  </Shell>;
}

function WidgetEditor({ widget, data, onSave, onClose, onRemove }: { widget: DashboardWidget | null; data: DashboardData;
  onSave: (widget: DashboardWidget) => void; onClose: () => void; onRemove?: () => void }) {
  const [kind, setKind] = useState<DashboardWidgetKind>(widget?.kind ?? 'calendar');
  const [target, setTarget] = useState(widget?.target ?? '');
  const [width, setWidth] = useState<DashboardWidget['width']>(widget?.width ?? 1);
  const [height, setHeight] = useState<DashboardWidget['height']>(widget?.height ?? 1);
  const targetLabel = dashboardTargetLabel(kind);
  const options = dashboardTargetOptions(kind, data);
  const missing = Boolean(target && !options.some(option => option.value === target));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ id: widget?.id ?? crypto.randomUUID(), kind, target: targetLabel && target ? target : null, width, height });
  }

  return <Drawer title={widget ? 'Configura widget' : 'Aggiungi widget'} onClose={onClose}>
    <form className="editor-form" onSubmit={submit}>
      <fieldset className="form-grid drawer-fields">
        <label>Funzione<select autoFocus value={kind} onChange={event => { setKind(event.target.value as DashboardWidgetKind); setTarget(''); }}>
          {kinds.map(value => <option key={value} value={value}>{dashboardWidgetLabels[value]}</option>)}
        </select></label>
        {targetLabel && <label>{targetLabel}<select value={target} onChange={event => setTarget(event.target.value)}>
          <option value="">{dashboardTargetPlaceholder(kind)}</option>
          {missing && <option value={target}>Elemento non disponibile</option>}
          {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>}
        <div className={`form-pair ${styles.dimensions}`}>
          <label>Larghezza<select value={width} onChange={event => setWidth(event.target.value === '2' ? 2 : 1)}>
            <option value="1">Metà larghezza</option><option value="2">Tutta larghezza</option>
          </select></label>
          <label>Altezza<select value={height} onChange={event => setHeight(event.target.value === '2' ? 2 : 1)}>
            <option value="1">Standard</option><option value="2">Doppia</option>
          </select></label>
        </div>
        <p className={styles.editorHint}>Su schermi piccoli i widget occupano tutta la larghezza.</p>
      </fieldset>
      <footer className={`drawer-footer ${styles.editorFooter}`}>
        {onRemove && <button type="button" className={`button secondary ${styles.remove}`} onClick={onRemove}><Trash2 size={16} aria-hidden="true"/> Rimuovi widget</button>}
        <button type="button" className="button secondary" onClick={onClose}>Annulla</button>
        <button type="submit" className="button primary">{widget ? 'Salva widget' : 'Aggiungi widget'}</button>
      </footer>
    </form>
  </Drawer>;
}

function ResizeGrip({ title, widget, onOpen, onResize }: { title: string; widget: DashboardWidget;
  onOpen: (trigger: HTMLButtonElement) => void; onResize: (size: Dimensions) => void }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  function startResize(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    start.current = { x: event.clientX, y: event.clientY };
    moved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function endResize(event: PointerEvent<HTMLButtonElement>) {
    if (!start.current) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    start.current = null;
    const threshold = 38;
    moved.current = Math.abs(dx) >= threshold || Math.abs(dy) >= threshold;
    if (!moved.current) return;
    const columns = window.matchMedia('(min-width: 781px)').matches;
    const width = columns && Math.abs(dx) >= threshold ? dx > 0 ? 2 : 1 : widget.width;
    const height = Math.abs(dy) >= threshold ? dy > 0 ? 2 : 1 : widget.height;
    if (width !== widget.width || height !== widget.height) onResize({ width, height });
  }

  return <button type="button" className={`icon-button ${styles.grip}`} title="Trascina per ridimensionare o premi per scegliere le dimensioni"
    aria-label={`Ridimensiona ${title}`} aria-haspopup="dialog" onPointerDown={startResize} onPointerUp={endResize}
    onPointerCancel={() => { start.current = null; moved.current = false; }} onClick={event => {
      if (event.detail === 0 || !moved.current) onOpen(event.currentTarget);
      moved.current = false;
    }}><MoveDiagonal2 size={18} aria-hidden="true"/></button>;
}
