'use client';

import Link from 'next/link';
import { Building2, CalendarDays, Calculator, ChartNoAxesCombined, ChevronDown, ChevronRight, HardHat, Menu, Search, ShieldCheck, X, LogOut, Users, BriefcaseBusiness, FileText, FileUp, Wallet, Warehouse, PanelTop, ArrowUpRight } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { signOut } from '@/app/login/actions';
import type { Identity } from '@/lib/domain';
import { areas } from '@/lib/operation-types';

const modules = [
  { section: 'clienti', label: 'Clienti', href: '/clienti', icon: Building2 },
  { section: 'magazzino', label: areas.magazzino.title, href: '/gestione/magazzino', icon: Warehouse },
  { section: 'personale', label: areas.personale.title, href: '/gestione/personale', icon: Users },
  { section: 'amministrazione', label: areas.amministrazione.title, href: '/gestione/amministrazione', icon: FileText },
  { section: 'computi-metrici', label: areas['computi-metrici'].title, href: '/gestione/computi-metrici', icon: Calculator },
  { section: 'preventivi-computo', label: 'Preventivi da PDF', href: '/gestione/preventivi-computo', icon: FileUp },
  { section: 'statistiche', label: 'Statistiche', href: '/gestione/statistiche', icon: ChartNoAxesCombined },
  { section: 'bilanci', label: 'Bilanci e conti', href: '/gestione/bilanci', icon: Wallet },
] as const;
type ShellSection = 'cantieri' | 'agenda' | 'accessi' | typeof modules[number]['section'];

export function orgLink(path: string, identity: Identity) {
  if (identity.orgs.length < 2) return path;
  return path + (path.includes('?') ? '&' : '?') + 'azienda=' + identity.org.id;
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
  const overview = orgLink('/cantieri', identity);
  const agenda = orgLink('/agenda', identity);
  const access = orgLink('/accessi', identity);
  const sectionLabel = section === 'cantieri' ? 'Cantieri' : section === 'agenda' ? 'Agenda'
    : section === 'accessi' ? 'Gestione accessi' : modules.find(item => item.section === section)?.label;
  function sidebar() {
    return <>
      <Link href={overview} className="brand" onClick={() => mobile.current?.close()}>
        <span className="brand-icon"><Building2 size={23} strokeWidth={2.1}/></span>
        <span>Imprelio<small>Gestione cantieri</small></span>
      </Link>
      <nav className="nav-main" aria-label="Menu principale">
        <p className="nav-label">OPERATIVITÀ</p>
        <Link href={overview} onClick={() => mobile.current?.close()} aria-current={section === 'cantieri' ? 'page' : undefined} className={'nav-link ' + (section === 'cantieri' ? 'nav-active' : '')}><HardHat size={19} /> Cantieri</Link>
        <Link href={agenda} onClick={() => mobile.current?.close()} aria-current={section === 'agenda' ? 'page' : undefined}
          className={'nav-link ' + (section === 'agenda' ? 'nav-active' : '')}><CalendarDays size={18} /> Agenda</Link>
        {identity.org.role === 'admin' && <Link href={access} onClick={() => mobile.current?.close()} aria-current={section === 'accessi' ? 'page' : undefined} className={'nav-link ' + (section === 'accessi' ? 'nav-active' : '')}><ShieldCheck size={18} /> Gestione accessi</Link>}
        <p className="nav-label roadmap-label">GESTIONE</p>
        {modules.map(({ section: page, label, href, icon: Icon }) => <Link key={page} href={orgLink(href, identity)}
          onClick={() => mobile.current?.close()} aria-current={section === page ? 'page' : undefined}
          className={'nav-link ' + (section === page ? 'nav-active' : '')}><Icon size={18}/> {label}</Link>)}
      </nav>
      <div className="sidebar-footer">
        <div className="org-icon"><BriefcaseBusiness size={17} /></div>
        <div><strong>{identity.org.name}</strong><small>{identity.demo ? 'Spazio dimostrativo' : 'Spazio di lavoro'}</small></div>
      </div>
    </>;
  }
  return <div className="app-shell">
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
          {detail && section === 'cantieri' ? <Link href={overview}>Cantieri</Link> : <strong>{sectionLabel}</strong>}
          {detail && <><ChevronRight size={14}/><strong className="breadcrumb-detail">{detail}</strong></>}
        </div>
        <div className="top-actions">
          <Link ref={searchLink} className="global-search" aria-keyshortcuts="Control+K Meta+K" href={orgLink('/cantieri?cerca=1', identity)} onClick={event => {
            if (onSearch && !event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); onSearch(); }
          }}><Search size={17} aria-hidden="true"/><span className="search-caption">Cerca cantieri</span><kbd aria-hidden="true">{shortcutLabel}</kbd></Link>
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
              {identity.orgs.length > 1 && identity.orgs.map(org => <Link key={org.id} href={'/cantieri?azienda=' + org.id}><ArrowUpRight size={16}/> {org.name}</Link>)}
              {identity.org.role === 'admin' && <Link href={access}><ShieldCheck size={16} /> Gestione accessi</Link>}
              {!identity.demo && <form action={signOut}><button><LogOut size={16} /> Esci</button></form>}
            </div>
          </details>
        </div>
      </header>
      <main id="contenuto" tabIndex={-1} className="content">{children}</main>
    </div>
  </div>;
}
