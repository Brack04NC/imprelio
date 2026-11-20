'use client';

import type { Identity } from '@/lib/domain';
import { NotificationCenter } from './notification-center';
import { Shell } from './shell';
import { useNotificationFeed } from './use-notification-feed';

export function NotificationsWorkspace({ identity, history }: { identity: Identity; history: boolean }) {
  const { feed, loading, error, refresh } = useNotificationFeed(identity, { enabled: true, includeHistory: history });
  return <Shell identity={identity} section="notifiche">
    <NotificationCenter identity={identity} items={(history ? feed?.history : feed?.items) ?? []}
      unavailable={feed?.unavailable ?? []} history={history} historyUnavailable={feed?.historyUnavailable ?? false}
      onRefresh={refresh} refreshing={loading || (!feed && !error)} error={error}/>
  </Shell>;
}
