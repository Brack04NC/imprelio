'use client';

import { Ellipsis, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './context-actions.module.css';

export type ContextAction = { label: string; icon?: LucideIcon; tone?: 'danger'; disabled?: boolean } & (
  { onSelect: () => void; href?: never } | { href: string; onSelect?: never }
);

type Surface = Pick<HTMLAttributes<HTMLElement>, 'onClickCapture' | 'onContextMenu' | 'onKeyDown' | 'onPointerDown'> & {
  'data-context-actions': '';
};
type Position = { x: number; y: number; anchorTop?: number };
type Press = { cancel: () => void; open: () => void; opened: boolean };
const holdMs = 550;
const movePx = 10;
const inset = 8;
const nativeControls = 'a, button, input, textarea, select, summary, [role="link"], [role="button"], [contenteditable]:not([contenteditable="false"]), [data-context-native]';

function isActionTarget(target: EventTarget | null, surface: HTMLElement) {
  if (!(target instanceof Element) || target.closest('[data-context-actions]') !== surface) return false;
  if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-context-native]')) return false;
  const control = target.closest(nativeControls);
  return !control || !surface.contains(control) || control.hasAttribute('data-context-primary');
}

function selectionIn(surface: HTMLElement) {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.anchorNode && surface.contains(selection.anchorNode));
}

function below(element: HTMLElement): Position {
  const rect = element.getBoundingClientRect();
  return { x: rect.right, y: rect.bottom + 5, anchorTop: rect.top };
}

function enabledItems(menu: HTMLElement) {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])')];
}

export function ContextActions({ label, actions, compact = false, children }: {
  label: string;
  actions: ContextAction[];
  compact?: boolean;
  children: (controls: { surface: Surface; trigger: ReactNode }) => ReactNode;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);
  const [position, setPosition] = useState<Position | null>(null);
  const available = actions.some(action => !action.disabled);
  const name = `Azioni per ${label}`;

  function open(at: Position, anchor?: HTMLElement) {
    returnFocus.current = anchor ?? button.current;
    setPosition(at);
  }

  function close(restore = false) {
    setPosition(null);
    if (restore) (returnFocus.current?.isConnected ? returnFocus.current : button.current)?.focus({ preventScroll: true });
  }

  useEffect(() => () => press.current?.cancel(), []);

  useLayoutEffect(() => {
    const panel = menu.current;
    if (!position || !panel) return;
    const visual = window.visualViewport;
    const top = visual?.offsetTop ?? 0;
    const left = visual?.offsetLeft ?? 0;
    const width = visual?.width ?? document.documentElement.clientWidth;
    const height = visual?.height ?? document.documentElement.clientHeight;
    const right = left + width - inset;
    const bottom = top + height - inset;
    const maxWidth = Math.max(0, width - 2 * inset);
    panel.style.minWidth = `${Math.min(186, maxWidth)}px`;
    panel.style.maxWidth = `${maxWidth}px`;
    panel.style.maxHeight = `${Math.max(0, height - 2 * inset)}px`;
    const bounds = panel.getBoundingClientRect();
    const x = position.anchorTop === undefined ? position.x : position.x - bounds.width;
    const y = position.anchorTop !== undefined && position.y + bounds.height > bottom
      ? position.anchorTop - bounds.height - 5 : position.y;
    panel.style.left = `${Math.max(left + inset, Math.min(x, right - bounds.width))}px`;
    panel.style.top = `${Math.max(top + inset, Math.min(y, bottom - bounds.height))}px`;
    enabledItems(panel)[0]?.focus({ preventScroll: true });
  }, [position]);

  useEffect(() => {
    if (!position) return;
    function outside(event: Event) {
      if (!(event.target instanceof Node) || menu.current?.contains(event.target) || button.current?.contains(event.target)) return;
      const origin = button.current?.closest('[data-context-actions]');
      // Touch release can refocus the pressed element before dispatching its click.
      if (event.type === 'focusin' && suppressClick.current && origin?.contains(event.target)) {
        queueMicrotask(() => { if (menu.current) enabledItems(menu.current)[0]?.focus({ preventScroll: true }); });
        return;
      }
      setPosition(null);
    }
    function moveViewport(event: Event) {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) setPosition(null);
    }
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    window.addEventListener('scroll', moveViewport, true);
    window.addEventListener('resize', moveViewport);
    const viewport = window.visualViewport;
    viewport?.addEventListener('scroll', moveViewport);
    viewport?.addEventListener('resize', moveViewport);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('scroll', moveViewport, true);
      window.removeEventListener('resize', moveViewport);
      viewport?.removeEventListener('scroll', moveViewport);
      viewport?.removeEventListener('resize', moveViewport);
    };
  }, [position]);

  function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    const items = enabledItems(event.currentTarget);
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = (current + 1) % items.length; break;
      case 'ArrowUp': next = current <= 0 ? items.length - 1 : current - 1; break;
      case 'Home': next = 0; break;
      case 'End': next = items.length - 1; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    items[next]?.focus();
  }

  function cancelPressClick(event: MouseEvent<HTMLElement>) {
    if (!suppressClick.current || event.detail === 0) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
    if (menu.current) enabledItems(menu.current)[0]?.focus({ preventScroll: true });
  }

  const surface: Surface = {
    'data-context-actions': '',
    onContextMenu(event) {
      if (!available || event.defaultPrevented || !isActionTarget(event.target, event.currentTarget) || selectionIn(event.currentTarget)) return;
      event.preventDefault();
      event.stopPropagation();
      const pointerType = (event.nativeEvent as PointerEvent).pointerType;
      if (pointerType === 'touch' || press.current) {
        press.current?.open();
        return;
      }
      suppressClick.current = false;
      if (event.clientX || event.clientY) open({ x: event.clientX, y: event.clientY });
      else if (event.target instanceof HTMLElement) open(below(event.target), event.target);
    },
    onKeyDown(event) {
      if (!available || event.defaultPrevented || !(event.target instanceof HTMLElement) || !isActionTarget(event.target, event.currentTarget)) return;
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick.current = false;
      open(below(event.target), event.target);
    },
    onPointerDown(event) {
      suppressClick.current = false;
      press.current?.cancel();
      if (!available || !event.isPrimary || event.button !== 0 || (event.pointerType !== 'touch' && event.pointerType !== 'pen')
        || !isActionTarget(event.target, event.currentTarget) || selectionIn(event.currentTarget)) return;
      const { clientX: x, clientY: y, pointerId } = event;
      const target = event.currentTarget;
      const current: Press = {
        opened: false,
        open() {
          if (current.opened || !target.isConnected) return;
          current.opened = true;
          suppressClick.current = true;
          open({ x, y });
        },
        cancel() {
          window.clearTimeout(timer);
          document.removeEventListener('pointermove', move, true);
          document.removeEventListener('pointerup', release, true);
          document.removeEventListener('pointercancel', release, true);
          document.removeEventListener('pointerdown', anotherPress, true);
          window.removeEventListener('scroll', current.cancel, true);
          window.removeEventListener('blur', current.cancel);
          if (press.current === current) press.current = null;
        },
      };
      function move(pointer: PointerEvent) {
        if (pointer.pointerId === pointerId && Math.hypot(pointer.clientX - x, pointer.clientY - y) > movePx) current.cancel();
      }
      function release(pointer: PointerEvent) {
        if (pointer.pointerId === pointerId) current.cancel();
      }
      function anotherPress(pointer: PointerEvent) {
        if (pointer.pointerId !== pointerId) current.cancel();
      }
      press.current = current;
      const timer = window.setTimeout(current.open, holdMs);
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', release, true);
      document.addEventListener('pointercancel', release, true);
      document.addEventListener('pointerdown', anotherPress, true);
      window.addEventListener('scroll', current.cancel, true);
      window.addEventListener('blur', current.cancel);
    },
    onClickCapture: cancelPressClick,
  };

  const trigger = <button type="button" ref={button} className={`icon-button ${styles.trigger}${compact ? ` ${styles.compact}` : ''}`}
    data-context-primary="" aria-label={name} aria-haspopup="menu" aria-expanded={Boolean(position && available)}
    aria-controls={position && available ? id : undefined} title={name} disabled={!available}
    onClick={event => { if (position) close(true); else open(below(event.currentTarget), event.currentTarget); }}>
    <Ellipsis size={compact ? 15 : 20} aria-hidden="true"/>
  </button>;

  return <>{children({ surface, trigger })}
    {position && available && createPortal(<div className={styles.menu} id={id} ref={menu} role="menu" aria-label={name} onKeyDown={menuKeys}
      onClickCapture={cancelPressClick} onPointerDownCapture={() => { suppressClick.current = false; }}>
      {actions.map((action, index) => {
        const Icon = action.icon;
        const text = <>{Icon && <Icon size={16} aria-hidden="true"/>}<span>{action.label}</span></>;
        const common = { className: styles.item, 'data-tone': action.tone, role: 'menuitem', tabIndex: -1 };
        return action.href && !action.disabled
          ? <a {...common} key={index} href={action.href} onClick={() => close(true)}>{text}</a>
          : <button {...common} key={index} type="button" disabled={action.disabled} onClick={() => { close(true); action.onSelect?.(); }}>{text}</button>;
      })}
    </div>, document.body)}
  </>;
}
