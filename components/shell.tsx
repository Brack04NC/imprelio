'use client';

import Image from 'next/image';
import Link, { useLinkStatus } from 'next/link';
import { Archive, Bell, Building2, CalendarCheck, CalendarDays, Calculator, ChartNoAxesCombined, ChevronDown, ChevronLeft, ChevronRight, HardHat, Hourglass, LayoutDashboard, Menu, Search, ShieldCheck, Trash2, X, LogOut, Users, BriefcaseBusiness, FileText, FileUp, Wallet, Warehouse, PanelTop, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { signOut } from '@/app/login/actions';
import type { Identity } from '@/lib/domain';
import { areas } from '@/lib/operation-types';
import { NotificationBell } from './notification-bell';
import { FeedbackHost } from './feedback-toast';

const modules = [
  { section: 'clienti', label: 'Clienti', href: '/clienti', icon: Building2 },
  { section: 'magazzino', label: areas.magazzino.title, href: '/gestione/magazzino', icon: Warehouse },
  { section: 'personale', label: areas.personale.title, href: '/gestione/personale', icon: Users },
  { section: 'presenze', label: 'Presenze', href: '/gestione/presenze', icon: CalendarCheck },
  { section: 'amministrazione', label: areas.amministrazione.title, href: '/gestione/amministrazione', icon: FileText },
  { section: 'archivio-documenti', label: 'Archivio documenti', href: '/gestione/archivio-documenti', icon: Archive },
  { section: 'computi-metrici', label: areas['computi-metrici'].title, href: '/gestione/computi-metrici', icon: Calculator },
  { section: 'preventivi-computo', label: 'Preventivi da PDF', href: '/gestione/preventivi-computo', icon: FileUp },
  { section: 'statistiche', label: 'Statistiche', href: '/gestione/statistiche', icon: ChartNoAxesCombined },
  { section: 'bilanci', label: 'Bilanci e conti', href: '/gestione/bilanci', icon: Wallet },
  { section: 'cestino', label: 'Cestino', href: '/gestione/cestino', icon: Trash2 },
] as const;
type ShellSection = 'dashboard' | 'cantieri' | 'agenda' | 'notifiche' | 'accessi' | typeof modules[number]['section'];

function NavigationHint({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!pending) { setVisible(false); return; }
    const timer = window.setTimeout(() => setVisible(true), 180);
    return () => window.clearTimeout(timer);
  }, [pending]);
  if (!pending || !visible) return null;
  const host = document.getElementById('navigation-status');
  return <>
    <Hourglass size={17} className="nav-pending-icon" aria-hidden="true"/>
    {host && createPortal(<span className="nav-progress"><Hourglass size={16} aria-hidden="true"/> Apertura {label}…</span>, host)}
  </>;
}

export function orgLink(path: string, identity: Identity) {
  if (identity.orgs.length < 2) return path;
  const hash = path.indexOf('#');
  const url = hash < 0 ? path : path.slice(0, hash);
  return url + (url.includes('?') ? '&' : '?') + 'azienda=' + identity.org.id + (hash < 0 ? '' : path.slice(hash));
}

export function Shell({ identity, section, detail, onSearch, children }: {
  identity: Identity; section: ShellSection; detail?: string;
  onSearch?: () => void; children: ReactNode;
}) {
  const mobile = useRef<HTMLDialogElement>(null);
  const desktopNav = useRef<HTMLElement>(null);
  const searchLink = useRef<HTMLAnchorElement>(null);
  const profile = useRef<HTMLDetailsElement>(null);
  const [shortcutLabel, setShortcutLabel] = useState('Ctrl K');
  useEffect(() => {
    if (/Mac|iPhone|iPad/i.test(navigator.platform)) setShortcutLabel('⌘ K');
    function shortcut(event: KeyboardEvent) {
      if ((!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 'k' || event.shiftKey || event.altKey
        || event.defaultPrevented || event.isComposing || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      searchLink.current?.click();
    }
    const desktop = window.matchMedia('(min-width: 1061px)');
    function closeMobileMenu() {
      if (desktop.matches && mobile.current?.open) {
        mobile.current.close();
        desktopNav.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
      }
    }
    function dismissProfile(event: PointerEvent) {
      if (profile.current?.open && event.target instanceof Node && !profile.current.contains(event.target)) profile.current.open = false;
    }
    window.addEventListener('keydown', shortcut);
    desktop.addEventListener('change', closeMobileMenu);
    document.addEventListener('pointerdown', dismissProfile);
    return () => {
      window.removeEventListener('keydown', shortcut);
      desktop.removeEventListener('change', closeMobileMenu);
      document.removeEventListener('pointerdown', dismissProfile);
    };
  }, []);
  const initials = identity.name.split(/[ ._-]+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'IM';
  const home = orgLink('/', identity);
  const overview = orgLink('/cantieri', identity);
  const agenda = orgLink('/agenda', identity);
  const notifications = orgLink('/notifiche', identity);
  const access = orgLink('/accessi', identity);
  const sectionModule = modules.find(item => item.section === section);
  const parentHref = section === 'cantieri' ? overview : section === 'agenda' ? agenda : sectionModule && orgLink(sectionModule.href, identity);
  const sectionLabel = section === 'dashboard' ? 'Dashboard' : section === 'cantieri' ? 'Cantieri' : section === 'agenda' ? 'Agenda'
    : section === 'notifiche' ? 'Notifiche' : section === 'accessi' ? 'Gestione accessi' : sectionModule?.label;
  function navLink(page: ShellSection, label: string, href: string, Icon: LucideIcon) {
    return <Link key={page} href={href} prefetch={false} onNavigate={() => mobile.current?.close()}
      aria-current={section === page ? 'page' : undefined} className={'nav-link ' + (section === page ? 'nav-active' : '')}>
      <Icon size={18} aria-hidden="true"/> {label}<NavigationHint label={label}/>
    </Link>;
  }
  function sidebar() {
    return <>
      <Link href={home} prefetch={false} className="brand" onNavigate={() => mobile.current?.close()}>
        <Image src="/brand/imprelio-simbolo-originale.png" alt="" width={44} height={44} className="brand-icon" unoptimized/>
        <span>Imprelio<small>Gestione cantieri</small></span>
      </Link>
      <nav className="nav-main" aria-label="Menu principale">
        <p className="nav-label">OPERATIVITÀ</p>
        {navLink('dashboard', 'Dashboard', home, LayoutDashboard)}
        {navLink('cantieri', 'Cantieri', overview, HardHat)}
        {navLink('agenda', 'Agenda', agenda, CalendarDays)}
        {navLink('notifiche', 'Notifiche', notifications, Bell)}
        {identity.org.role === 'admin' && navLink('accessi', 'Gestione accessi', access, ShieldCheck)}
        <p className="nav-label roadmap-label">GESTIONE</p>
        {modules.map(item => navLink(item.section, item.label, orgLink(item.href, identity), item.icon))}
      </nav>
      <div className="sidebar-footer">
        <div className="org-icon"><BriefcaseBusiness size={17} /></div>
        <div><strong>{identity.org.name}</strong><small>{identity.demo ? 'Spazio dimostrativo' : 'Spazio di lavoro'}</small></div>
      </div>
    </>;
  }
  return <div className="app-shell">
    <div id="navigation-status" role="status" aria-atomic="true"/>
    <a className="skip" href="#contenuto">Vai al contenuto</a>
    <aside ref={desktopNav} className="sidebar">{sidebar()}</aside>
    <dialog ref={mobile} className="mobile-nav" aria-label="Navigazione" onClick={event => {
      if (event.target === event.currentTarget) event.currentTarget.close();
    }}>
      <div className="mobile-nav-content">
        <button className="icon-button nav-close" onClick={() => mobile.current?.close()} aria-label="Chiudi menu"><X size={20}/></button>
        {sidebar()}
      </div>
    </dialog>
    <div className="app-body">
      <header className="topbar">
        <div className="breadcrumbs">
          <button className="icon-button menu-trigger" onClick={() => mobile.current?.showModal()} aria-haspopup="dialog" aria-label="Apri menu"><Menu size={21}/></button>
          <PanelTop size={16} className="breadcrumb-icon" aria-hidden="true"/>
          <span className="breadcrumb-root">Area di lavoro</span><ChevronRight size={14} className="breadcrumb-root" />
          {detail && parentHref ? <Link href={parentHref} prefetch={false} className="breadcrumb-parent">
            <ChevronLeft size={14} className="breadcrumb-back" aria-hidden="true"/><span>{sectionLabel}</span>
          </Link> : <strong>{sectionLabel}</strong>}
          {detail && <><ChevronRight size={14} className="breadcrumb-separator" aria-hidden="true"/><strong className="breadcrumb-detail">{detail}</strong></>}
        </div>
        <div className="top-actions">
          <Link ref={searchLink} prefetch={false} className="global-search" aria-keyshortcuts="Control+K Meta+K" href={orgLink('/cantieri?cerca=1', identity)} onClick={event => {
            if (onSearch && !event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); onSearch(); }
          }}><Search size={17} aria-hidden="true"/><span className="search-caption">Cerca cantieri</span><kbd aria-hidden="true">{shortcutLabel}</kbd></Link>
          <NotificationBell key={identity.org.id} identity={identity}/>
          <details ref={profile} className="profile" onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
          }} onKeyDown={event => {
            if (event.key === 'Escape' && event.currentTarget.open) {
              event.currentTarget.open = false;
              event.currentTarget.querySelector('summary')?.focus();
            }
          }}>
            <summary><span className="avatar" aria-hidden="true">{initials}</span><span className="profile-name">{identity.name}</span><span className="sr-only"> · Profilo e azienda</span><ChevronDown size={13} className="profile-chevron" aria-hidden="true"/></summary>
            <div className="profile-menu">
              <strong>{identity.name}</strong>
              <small>{identity.demo ? 'Profilo dimostrativo' : identity.email}</small>
              {identity.orgs.length > 1 && identity.orgs.map(org => <Link key={org.id} prefetch={false} href={'/?azienda=' + org.id}><ArrowUpRight size={16}/> {org.name}</Link>)}
              {identity.org.role === 'admin' && <Link href={access} prefetch={false}><ShieldCheck size={16} /> Gestione accessi</Link>}
              {!identity.demo && <form action={signOut}><button><LogOut size={16} /> Esci</button></form>}
            </div>
          </details>
        </div>
      </header>
      <main id="contenuto" tabIndex={-1} className="content">{children}</main>
      <FeedbackHost/>
    </div>
  </div>;
}
