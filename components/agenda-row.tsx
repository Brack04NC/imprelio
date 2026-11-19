'use client';

import { ClipboardList, Clock3, HardHat, Layers3, MoveUpRight, ScanSearch, Wrench } from 'lucide-react';
import { formatDate, jobLabels, kindLabels, type AgendaItem } from '@/lib/domain';

export const jobIcons = { survey: ScanSearch, assembly: Layers3, adjustment: Wrench, dismantling: HardHat, other: ClipboardList };

export function AgendaRow({ job, showDate, edit }: { job: AgendaItem; showDate: boolean; edit: () => void }) {
  const Icon = jobIcons[job.kind];
  return <li><button className="agenda-row" onClick={edit}>
    <span className={`job-icon job-${job.kind}`}><Icon size={18}/></span>
    <span className="agenda-row-content">
      <strong>{kindLabels[job.kind]}</strong>
      <span>{job.site.name}{job.zone ? ' · ' + job.zone : ''}</span>
      <span className="agenda-when">
        {showDate && <time dateTime={job.due_date}>{formatDate(job.due_date, { day: 'numeric', month: 'short' })}</time>}
        {job.time ? <><Clock3 size={13}/>{job.time.slice(0, 5)}</> : 'Ora da definire'}
        {job.status !== 'scheduled' && <span className={`agenda-${job.status}`}>{jobLabels[job.status]}</span>}
      </span>
    </span><MoveUpRight className="agenda-arrow" size={16}/>
  </button></li>;
}
