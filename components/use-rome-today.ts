'use client';

import { useEffect, useState } from 'react';
import { romeDate } from '@/lib/domain';

export function useRomeToday(initialToday: string, enabled = true) {
  const [today, setToday] = useState(initialToday);

  useEffect(() => {
    if (!enabled) return;
    function update() {
      if (document.visibilityState === 'visible') setToday(romeDate());
    }
    update();
    const interval = window.setInterval(update, 30_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
    };
  }, [enabled, initialToday]);

  return enabled ? today : initialToday;
}
