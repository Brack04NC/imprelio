'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { romeDate, type Identity } from '@/lib/domain';
import type { NotificationFeed } from '@/lib/notifications';

export function useNotificationFeed(identity: Identity, { enabled, includeHistory = false }: { enabled: boolean; includeHistory?: boolean }) {
  const organization = identity.org.id;
  const scope = JSON.stringify([organization, identity.email, identity.demo, includeHistory]);
  const [snapshot, setSnapshot] = useState<{ scope: string; feed: NotificationFeed } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    request.current?.abort();
    const current = new AbortController();
    request.current = current;
    setLoading(true);
    setError('');
    try {
      let feed: NotificationFeed;
      if (identity.demo) {
        const { readDemoNotificationFeed } = await import('@/lib/notifications-demo');
        feed = await readDemoNotificationFeed(romeDate(), organization, current.signal, includeHistory);
      } else {
        const filters = new URLSearchParams({ azienda: organization });
        if (includeHistory) filters.set('vista', 'cronologia');
        const response = await fetch('/api/notifiche?' + filters, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: current.signal, cache: 'no-store',
        });
        if (!response.ok) throw new Error('Impossibile aggiornare le notifiche.');
        feed = await response.json() as NotificationFeed;
      }
      if (!current.signal.aborted) setSnapshot({ scope, feed });
    } catch {
      if (!current.signal.aborted) setError('Impossibile aggiornare le notifiche.');
    } finally {
      if (request.current === current) {
        setLoading(false);
        request.current = null;
      }
    }
  }, [enabled, identity.demo, includeHistory, organization, scope]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let day = romeDate();
    void refresh();
    async function storage(event: StorageEvent) {
      if (!identity.demo) return;
      const { notificationDemoStorageKeys } = await import('@/lib/notifications-demo');
      if (active && notificationDemoStorageKeys.has(event.key)) void refresh();
    }
    function visible() {
      if (document.visibilityState !== 'visible') return;
      day = romeDate();
      void refresh();
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && romeDate() !== day) visible();
    }, 30_000);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      window.clearInterval(timer);
      request.current?.abort();
      request.current = null;
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [enabled, identity.demo, refresh]);

  return { feed: snapshot?.scope === scope ? snapshot.feed : null, loading: enabled && loading, error, refresh };
}
