import { Bell, Clock3, Info, TriangleAlert } from 'lucide-react';
import type { NotificationPriority } from '@/lib/notifications';
import tones from './notice-tones.module.css';

export const notificationPriorities = {
  all: { badge: 'Tutte', label: 'Tutte', icon: Bell, tone: tones.neutral },
  urgent: { badge: 'Urgente', label: 'Urgenti', icon: TriangleAlert, tone: tones.danger },
  soon: { badge: 'Da seguire', label: 'Da seguire', icon: Clock3, tone: tones.warning },
  info: { badge: 'Informativa', label: 'Informative', icon: Info, tone: tones.info },
} satisfies Record<NotificationPriority | 'all', { badge: string; label: string; icon: typeof Bell; tone: string }>;
