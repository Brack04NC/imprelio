'use client';

import Link from 'next/link';
import { ArrowRight, Bell, BellOff, ChevronRight, CircleAlert, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { formatDate, type Identity } from '@/lib/domain';
import { orgLink } from './shell';
import { useNotificationFeed } from './use-notification-feed';
import { notificationPriorities } from './notification-priority';
import tones from './notice-tones.module.css';
import styles from './notification-bell.module.css';

export function NotificationBell({ identity }: { identity: Identity }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { feed, loading, error, refresh } = useNotificationFeed(identity, { enabled: open });

  function close(restore = true) {
    dialog.current?.close();
    setOpen(false);
    if (restore) trigger.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    function position() {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds || !dialog.current) return;
      dialog.current.style.setProperty('--bell-top', `${bounds.bottom + 10}px`);
      dialog.current.style.setProperty('--bell-right', `${Math.max(12, document.documentElement.clientWidth - bounds.right)}px`);
    }
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [open]);

  const active = feed?.items ?? [];
  const preview = active.slice(0, 6);
  const partial = Boolean(feed?.unavailable.length);
  const href = orgLink('/notifiche?vista=cronologia', identity);
  return <>
    <button ref={trigger} type="button" className={`icon-button ${styles.trigger}`} aria-label="Notifiche" title="Notifiche"
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={event => {
        const panel = dialog.current;
        if (!panel || panel.open) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        panel.style.setProperty('--bell-top', `${bounds.bottom + 10}px`);
        panel.style.setProperty('--bell-right', `${Math.max(12, document.documentElement.clientWidth - bounds.right)}px`);
        panel.showModal();
        setOpen(true);
        closeButton.current?.focus();
      }}><Bell size={20} aria-hidden="true"/></button>
    <dialog ref={dialog} id={id} aria-labelledby={id + '-title'} className={styles.dialog} data-notification-dialog=""
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => { if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX >= bounds.right
          || event.clientY < bounds.top || event.clientY >= bounds.bottom) close();
      }}>
      <div className={styles.content}>
        <header className={styles.header}>
          <span className={styles.headerIcon}><Bell size={21} aria-hidden="true"/></span>
          <div><h2 id={id + '-title'}>Notifiche</h2>
            {!!active.length && <p>{preview.length < active.length ? `In evidenza · ${preview.length} di ${active.length} avvisi` :
              active.length === 1 ? '1 avviso attivo' : `${active.length} avvisi attivi`}</p>}
          </div>
          <button ref={closeButton} type="button" className={`icon-button ${styles.close}`} aria-label="Chiudi notifiche" onClick={() => close()}><X size={20}/></button>
        </header>
        <div className={styles.scroll} aria-busy={loading}>
          {error && <div className={`${styles.message} ${tones.danger}`}><CircleAlert size={18} aria-hidden="true"/><p role="alert">{error}</p>
            <button type="button" className="button secondary" onClick={() => void refresh()}>Riprova</button></div>}
          {!feed && !error && <p className={styles.message} role="status">Caricamento…</p>}
          {partial && <p className={`${styles.message} ${tones.warning}`} role="status"><CircleAlert size={18} aria-hidden="true"/>Alcuni avvisi potrebbero mancare.</p>}
          {feed && !active.length && !error && !partial && <p className={styles.message}><BellOff size={18} aria-hidden="true"/>Nessun avviso attivo.</p>}
          {!!active.length && <ul className={styles.items} role="list">
            {preview.map(item => {
              const { icon: Icon, tone, badge } = notificationPriorities[item.priority];
              return <li key={item.id} className={tone} data-priority={item.priority}>
              <Link href={orgLink(item.href, identity)} prefetch={false} onClick={() => close(false)}>
                <span className={styles.badge}><Icon size={14} aria-hidden="true"/>{badge}</span>
                <strong>{item.title}</strong>
                {item.detail && <span className={styles.detail}>{item.detail}</span>}
                <span className={styles.status}>{item.status}{item.date && <> · <time dateTime={item.date}>
                  {formatDate(item.date, { day: 'numeric', month: 'short', year: 'numeric' })}
                </time></>}</span>
                <ChevronRight size={17} className={styles.rowArrow} aria-hidden="true"/>
              </Link>
            </li>;
            })}
          </ul>}
        </div>
        <footer className={styles.footer}>
          <Link href={href} prefetch={false} className="button primary" onClick={() => close(false)}>
            Centro notifiche <ArrowRight size={16} aria-hidden="true"/>
          </Link>
        </footer>
      </div>
    </dialog>
  </>;
}
