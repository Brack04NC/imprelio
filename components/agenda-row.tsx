'use client';

import { ArrowUpRight, ClipboardList, Clock3, HardHat, Layers3, Pencil, ScanSearch, Trash2, Wrench } from 'lucide-react';
import { formatDate, jobLabels, kindLabels, type AgendaItem, type Job } from '@/lib/domain';
import { ContextActions, type ContextAction } from './context-actions';
import styles from './agenda-row.module.css';

export const jobIcons = { survey: ScanSearch, assembly: Layers3, adjustment: Wrench, dismantling: HardHat, other: ClipboardList };

export function interventionName(job: Job, siteName: string) {
  return [kindLabels[job.kind], siteName, job.zone].filter(Boolean).join(' · ');
}

export function interventionMenuLabel(job: Job, siteName: string) {
  return [interventionName(job, siteName), formatDate(job.due_date, { day: 'numeric', month: 'short' }), job.time?.slice(0, 5)]
    .filter(Boolean).join(' · ');
}

export function interventionActions({ edit, remove, siteHref, statusAction }: {
  edit: () => void; remove: () => void; siteHref?: string; statusAction?: ContextAction;
}): ContextAction[] {
  const actions: ContextAction[] = [{ label: 'Modifica intervento', icon: Pencil, onSelect: edit }];
  if (statusAction) actions.push(statusAction);
  if (siteHref) actions.push({ label: 'Apri cantiere', icon: ArrowUpRight, href: siteHref });
  actions.push({ label: 'Elimina intervento', icon: Trash2, tone: 'danger', onSelect: remove });
  return actions;
}

export function AgendaRow({ job, showDate, edit, actions }: {
  job: AgendaItem; showDate: boolean; edit: () => void; actions: ContextAction[];
}) {
  const Icon = jobIcons[job.kind];
  return <ContextActions label={interventionMenuLabel(job, job.site.name)} actions={actions}>
    {({ surface, trigger }) => <li {...surface} className={styles.row}>
      <button type="button" className="agenda-row" data-context-primary onClick={edit}>
        <span className={`job-icon job-${job.kind}`}><Icon size={18} aria-hidden="true"/></span>
        <span className="agenda-row-content">
          <strong>{kindLabels[job.kind]}</strong>
          <span>{job.site.name}{job.zone ? ' · ' + job.zone : ''}</span>
          <span className="agenda-when">
            {showDate && <time dateTime={job.due_date}>{formatDate(job.due_date, { day: 'numeric', month: 'short' })}</time>}
            {job.time ? <><Clock3 size={13} aria-hidden="true"/>{job.time.slice(0, 5)}</> : 'Ora da definire'}
            {job.status !== 'scheduled' && <span className={`agenda-${job.status}`}>{jobLabels[job.status]}</span>}
          </span>
        </span>
      </button>
      {trigger}
    </li>}
  </ContextActions>;
}
