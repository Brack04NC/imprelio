'use client';

import { Check, CircleAlert, Trash2, X } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import tones from './notice-tones.module.css';
import styles from './feedback-toast.module.css';

const icons = { success: Check, danger: CircleAlert, warning: Trash2 };
type Tone = keyof typeof icons;
const hostId = 'imprelio-feedback';

export function FeedbackHost() {
  return <div id={hostId} className={styles.host}/>;
}

export function ToastRegion({ label, children }: { label?: string; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.getElementById(hostId)), []);
  return host ? createPortal(<section aria-label={label} className={label ? styles.region : 'sr-only'}>{children}</section>, host) : null;
}

export function ToastCard({ tone, text, detail, action, error, announce = false, busy = false, duration, onClose }: {
  tone: Tone; text: string; detail?: string; action?: ReactNode; error?: string; busy?: boolean;
  announce?: boolean; duration?: number; onClose: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const card = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const timedClose = useEffectEvent(onClose);
  const Icon = icons[tone];
  const active = Boolean(text);

  useEffect(() => {
    if (!active) {
      setHovered(false);
      setFocused(false);
      return;
    }
    const changed = () => setHidden(document.hidden);
    changed();
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, [active]);

  useEffect(() => {
    if (!text || !duration || hovered || focused || hidden || busy || error) return;
    const timer = window.setTimeout(timedClose, duration);
    return () => window.clearTimeout(timer);
  }, [text, detail, duration, hovered, focused, hidden, busy, error]);

  function close() {
    if (card.current?.contains(document.activeElement)) {
      const target = previousFocus.current;
      (target?.isConnected && target !== document.body ? target : document.getElementById('contenuto'))?.focus({ preventScroll: true });
    }
    onClose();
  }

  const copy = active && <><strong>{text}</strong>{detail && <span>{detail}</span>}</>;
  return <div ref={card} data-toast={active ? tone : undefined} className={active ? `${styles.card} ${tones[tone]}` : undefined}
    onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true); }} onPointerLeave={() => setHovered(false)}
    onFocus={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        previousFocus.current = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
        setFocused(true);
      }
    }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    {active && <span className={styles.icon} aria-hidden="true"><Icon size={18} strokeWidth={2.5}/></span>}
    <div className={styles.copy}>{announce ? <>
      <div aria-live="polite" aria-atomic="true" role={active && tone !== 'danger' ? 'status' : undefined}>{tone !== 'danger' && copy}</div>
      <div aria-live="assertive" aria-atomic="true" role={active && tone === 'danger' ? 'alert' : undefined}>{tone === 'danger' && copy}</div>
    </> : copy}</div>
    {active && <button type="button" className={styles.close} aria-label="Chiudi avviso" disabled={busy} onClick={close}><X size={18} aria-hidden="true"/></button>}
    {action && <div className={styles.action}>{action}</div>}
    {error && <p className={`form-error ${styles.error}`} role="alert">{error}</p>}
  </div>;
}

export function StatusToast({ text, detail, error = false, onClose }: {
  text?: string; detail?: string; error?: boolean; onClose: () => void;
}) {
  return <ToastRegion label={text ? 'Esito operazione' : undefined}>
    <ToastCard tone={error ? 'danger' : 'success'} announce text={text ?? ''} detail={detail}
      duration={error ? undefined : 3500} onClose={onClose}/>
  </ToastRegion>;
}
